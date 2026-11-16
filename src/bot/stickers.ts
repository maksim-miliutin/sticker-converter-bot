import { Composer, GrammyError, InputFile, type Context } from "grammy";
import type { InlineKeyboardButton, InlineKeyboardMarkup, InputSticker } from "grammy/types";

import type { Sticker } from "../images/sticker.ts";
import type { PackStore, StickerPack } from "../store/packs.ts";
import { texts } from "../texts.ts";
import { packName } from "./pack-name.ts";
import type { Owned, Pending } from "./pending.ts";

// A sticker uploaded to Telegram and waiting for its emoji and pack.
export interface StickerDraft extends Owned
{
	readonly fileId: string;
	readonly emoji?: string;
}

type ReadyDraft = StickerDraft & { readonly emoji: string };

export const emojis = ["😀", "😂", "😍", "😎", "🥰", "😢", "😡", "👍", "❤️", "🔥"] as const;

export interface StickerDependencies
{
	readonly drafts: Pending<StickerDraft>;
	readonly packs: PackStore;
	// Known only after getMe; every set name must end in _by_<it>.
	readonly botUsername: () => string;
	readonly titleTtlMs: number;
}

export interface StickerFlow
{
	readonly composer: Composer<Context>;
	// Uploads a finished sticker, shows it and offers to add it to a pack.
	readonly deliver: (ctx: Context, sticker: Sticker) => Promise<void>;
	readonly packsText: (owner: number) => string;
	// Drops the owner's drafts and a pending title question; true if there was any.
	readonly forget: (owner: number) => boolean;
}

const addPattern = /^stk:([A-Za-z0-9_-]{16}):add$/;
const emojiPattern = /^emo:([A-Za-z0-9_-]{16}):(\d)$/;
const packPattern = /^pk:([A-Za-z0-9_-]{16}):(new|\d{1,12})$/;

const link = (pack: Pick<StickerPack, "name">): string => `https://t.me/addstickers/${pack.name}`;

function rows(buttons: InlineKeyboardButton[], perRow: number): InlineKeyboardButton[][]
{
	const result: InlineKeyboardButton[][] = [];
	for (let index = 0; index < buttons.length; index += perRow)
	{
		result.push(buttons.slice(index, index + perRow));
	}

	return result;
}

function emojiKeyboard(token: string): InlineKeyboardMarkup
{
	return { inline_keyboard: rows(emojis.map((emoji, index) => ({ text: emoji, callback_data: `emo:${token}:${String(index)}` })), 5) };
}

function packKeyboard(token: string, packs: readonly StickerPack[]): InlineKeyboardMarkup
{
	const existing = packs.map((pack) => [{ text: pack.title, callback_data: `pk:${token}:${String(pack.id)}` }]);

	return { inline_keyboard: [...existing, [{ text: texts.newPack, callback_data: `pk:${token}:new` }]] };
}

function inputSticker(draft: ReadyDraft): InputSticker
{
	return { sticker: draft.fileId, format: "static", emoji_list: [draft.emoji] };
}

function failedWith(error: unknown, text: string): boolean
{
	return error instanceof GrammyError && error.description.includes(text);
}

// After "Make a sticker": emoji, then pack, then either the title of a new pack or
// the existing one. Each press takes its draft out of the store and puts the next
// stage back under a new token, so a repeated press or a redelivered update finds
// nothing and cannot add the same sticker twice.
export function stickerFlow(deps: StickerDependencies): StickerFlow
{
	const composer = new Composer<Context>();
	const titles = new Map<number, { readonly draft: ReadyDraft; readonly expiresAt: number }>();

	async function deliver(ctx: Context, sticker: Sticker): Promise<void>
	{
		const owner = ctx.from?.id;
		const chat = ctx.chat?.id;
		if (owner === undefined || chat === undefined)
		{
			return;
		}

		const file = await ctx.api.uploadStickerFile(owner, "static", new InputFile(sticker.bytes, "sticker.webp"));
		const token = deps.drafts.add({ owner, fileId: file.file_id });
		await ctx.api.sendSticker(chat, file.file_id, {
			reply_markup: { inline_keyboard: [[{ text: texts.addToPack, callback_data: `stk:${token}:add` }]] },
		});
	}

	function packsText(owner: number): string
	{
		const packs = deps.packs.list(owner);
		if (packs.length === 0)
		{
			return texts.packsEmpty;
		}

		return texts.packsList(packs.map((pack, index) => `${String(index + 1)}. «${pack.title}» — ${link(pack)}`).join("\n"));
	}

	function forget(owner: number): boolean
	{
		const hadTitle = titles.delete(owner);

		return deps.drafts.clear(owner) || hadTitle;
	}

	composer.callbackQuery(addPattern, async (ctx) =>
	{
		const draft = deps.drafts.take(ctx.match[1] ?? "", ctx.from.id);
		if (draft === undefined)
		{
			await ctx.answerCallbackQuery({ text: texts.staleButton });
			return;
		}

		await ctx.answerCallbackQuery();
		await ctx.reply(texts.chooseEmoji, { reply_markup: emojiKeyboard(deps.drafts.add(draft)) });
	});

	composer.callbackQuery(emojiPattern, async (ctx) =>
	{
		const emoji = emojis[Number(ctx.match[2])];
		const draft = emoji === undefined ? undefined : deps.drafts.take(ctx.match[1] ?? "", ctx.from.id);
		if (draft === undefined || emoji === undefined)
		{
			await ctx.answerCallbackQuery({ text: texts.staleButton });
			return;
		}

		await ctx.answerCallbackQuery();
		const token = deps.drafts.add({ ...draft, emoji });
		await ctx.editMessageText(texts.choosePack(emoji), { reply_markup: packKeyboard(token, deps.packs.list(ctx.from.id)) });
	});

	composer.callbackQuery(packPattern, async (ctx) =>
	{
		const owner = ctx.from.id;
		const draft = deps.drafts.take(ctx.match[1] ?? "", owner);
		const target = ctx.match[2] ?? "";
		// The pack is looked up together with its owner: an id from forged callback
		// data finds nothing unless it is the presser's own pack.
		const pack = target === "new" ? undefined : deps.packs.find(Number(target), owner);
		if (draft?.emoji === undefined || (target !== "new" && pack === undefined))
		{
			await ctx.answerCallbackQuery({ text: texts.staleButton });
			return;
		}

		await ctx.answerCallbackQuery();
		const ready: ReadyDraft = { ...draft, emoji: draft.emoji };

		if (pack === undefined)
		{
			titles.set(owner, { draft: ready, expiresAt: Date.now() + deps.titleTtlMs });
			await ctx.editMessageText(texts.askTitle);
			return;
		}

		try
		{
			await ctx.api.addStickerToSet(owner, pack.name, inputSticker(ready));
		}
		catch (error)
		{
			if (failedWith(error, "STICKERSET_INVALID"))
			{
				deps.packs.remove(pack.id);
				await ctx.editMessageText(texts.packMissing(pack.title));
				return;
			}

			if (failedWith(error, "STICKERS_TOO_MUCH"))
			{
				await ctx.editMessageText(texts.packFull);
				return;
			}

			throw error;
		}

		await ctx.editMessageText(texts.stickerAdded(pack.title, link(pack)));
	});

	composer.on("message:text", async (ctx, next) =>
	{
		const owner = ctx.from.id;
		const request = titles.get(owner);
		if (request === undefined || request.expiresAt <= Date.now() || ctx.message.text.startsWith("/"))
		{
			await next();
			return;
		}

		const title = ctx.message.text.trim();
		if (title.length === 0 || title.length > 64)
		{
			await ctx.reply(texts.badTitle);
			return;
		}

		titles.delete(owner);

		// The pack is recorded only after Telegram created it, so a failure leaves
		// nothing behind that /packs would show as ready.
		for (let attempt = 0; attempt < 3; attempt++)
		{
			const name = packName(deps.botUsername());
			try
			{
				await ctx.api.createNewStickerSet(owner, name, title, [inputSticker(request.draft)]);
			}
			catch (error)
			{
				if (failedWith(error, "already occupied"))
				{
					continue;
				}

				throw error;
			}

			deps.packs.add(owner, name, title);
			await ctx.reply(texts.packCreated(title, link({ name })));
			return;
		}

		await ctx.reply(texts.packNameBusy);
	});

	return { composer, deliver, packsText, forget };
}
