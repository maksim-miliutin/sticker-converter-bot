import { Composer, type Context } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";

import { inspectImage, type ImageFormat, type ImageInfo, type ImageProblem } from "../images/inspect.ts";
import { makeSticker, type Sticker } from "../images/sticker.ts";
import type { Logger } from "../logger.ts";
import type { Download } from "../telegram-files.ts";
import { texts } from "../texts.ts";
import type { Pending, PendingImage } from "./pending.ts";

export interface FileLimits
{
	readonly maxFileBytes: number;
	readonly maxPixels: number;
}

export interface IntakeDependencies
{
	readonly pending: Pending<PendingImage>;
	readonly download: (fileId: string) => Promise<Download>;
	readonly limits: FileLimits;
	readonly logger: Logger;
	readonly deliverSticker: (ctx: Context, sticker: Sticker) => Promise<void>;
}

// Telegram fills mime_type from the file name, so it only decides what is refused
// before downloading; what is accepted is decided by the bytes later.
const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const choice = /^img:([A-Za-z0-9_-]{16}):(sticker|convert|cancel)$/;

const formatNames: Record<ImageFormat, string> = { jpeg: "JPEG", png: "PNG", webp: "WEBP" };
const decimal = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

function formatSize(bytes: number): string
{
	if (bytes < 1024 * 1024)
	{
		return `${String(Math.max(1, Math.round(bytes / 1024)))} КБ`;
	}

	return `${decimal.format(bytes / 1024 / 1024)} МБ`;
}

export function describeImage(image: ImageInfo): string
{
	const name = formatNames[image.format] + (image.hasAlpha ? " с прозрачностью" : "");

	return `${name}, ${String(image.width)}×${String(image.height)}, ${formatSize(image.bytes)}`;
}

function problemText(problem: ImageProblem, limits: FileLimits): string
{
	switch (problem)
	{
		case "unsupported-format":
			return texts.unsupportedFormat;
		case "animated":
			return texts.animated;
		case "too-many-pixels":
			return texts.tooManyPixels(limits.maxPixels / 1_000_000);
		case "corrupted":
			return texts.corrupted;
	}
}

function choiceKeyboard(token: string): InlineKeyboardMarkup
{
	return {
		inline_keyboard: [
			[{ text: texts.actionSticker, callback_data: `img:${token}:sticker` }],
			[{ text: texts.actionConvert, callback_data: `img:${token}:convert` }],
			[{ text: texts.actionCancel, callback_data: `img:${token}:cancel` }],
		],
	};
}

// Receiving an image: refuse what is visibly wrong, otherwise ask what to do and
// remember the file. Nothing is downloaded until the user picks an action.
export function imageIntake(deps: IntakeDependencies): Composer<Context>
{
	const intake = new Composer<Context>();
	const megabytes = deps.limits.maxFileBytes / 1024 / 1024;

	async function offer(ctx: Context, fileId: string, size: number | undefined, fromPhoto: boolean): Promise<void>
	{
		const owner = ctx.from?.id;
		const messageId = ctx.msg?.message_id;
		if (owner === undefined || messageId === undefined)
		{
			return;
		}

		const reply_parameters = { message_id: messageId };
		if (size !== undefined && size > deps.limits.maxFileBytes)
		{
			await ctx.reply(texts.tooLarge(megabytes), { reply_parameters });
			return;
		}

		const token = deps.pending.add({ owner, fileId, fromPhoto });
		const text = fromPhoto ? `${texts.chooseAction}\n\n${texts.photoHint}` : texts.chooseAction;
		await ctx.reply(text, { reply_markup: choiceKeyboard(token), reply_parameters });
	}

	intake.on("message:photo", async (ctx) =>
	{
		// Telegram lists a photo in several sizes, smallest first.
		const largest = ctx.message.photo.at(-1);
		if (largest !== undefined)
		{
			await offer(ctx, largest.file_id, largest.file_size, true);
		}
	});

	intake.on("message:document", async (ctx) =>
	{
		const document = ctx.message.document;
		if (document.mime_type !== undefined && !acceptedTypes.has(document.mime_type))
		{
			await ctx.reply(texts.unsupportedFormat, { reply_parameters: { message_id: ctx.message.message_id } });
			return;
		}

		await offer(ctx, document.file_id, document.file_size, false);
	});

	intake.callbackQuery(choice, async (ctx) =>
	{
		const [, token = "", action] = ctx.match;
		const image = deps.pending.take(token, ctx.from.id);
		if (image === undefined)
		{
			await ctx.answerCallbackQuery({ text: texts.staleButton });
			return;
		}

		await ctx.answerCallbackQuery();

		if (action !== "sticker" && action !== "convert")
		{
			await ctx.editMessageText(texts.imageCancelled);
			return;
		}

		await ctx.editMessageText(action === "sticker" ? texts.making : texts.checking);
		const fetched = await fetchImage(image.fileId, deps);
		if (!fetched.ok)
		{
			await ctx.editMessageText(fetched.text);
			return;
		}

		if (action === "convert")
		{
			await ctx.editMessageText(texts.imageAccepted(describeImage(fetched.image)));
			return;
		}

		const sticker = await makeSticker(fetched.bytes, deps.limits.maxPixels);
		if (sticker === undefined)
		{
			await ctx.editMessageText(texts.stickerTooHeavy);
			return;
		}

		await deps.deliverSticker(ctx, sticker);
		await ctx.editMessageText(texts.stickerReady(sticker.width, sticker.height, Math.max(1, Math.round(sticker.bytes.length / 1024))));
	});

	return intake;
}

type Fetched =
	| { readonly ok: true; readonly bytes: Buffer; readonly image: ImageInfo }
	| { readonly ok: false; readonly text: string };

// Downloads and inspects; on failure returns the message to show instead.
async function fetchImage(fileId: string, deps: IntakeDependencies): Promise<Fetched>
{
	const download = await deps.download(fileId);
	if (!download.ok)
	{
		if (download.problem === "too-large")
		{
			return { ok: false, text: texts.tooLarge(deps.limits.maxFileBytes / 1024 / 1024) };
		}

		deps.logger.warn({ reason: download.reason }, "image download failed");

		return { ok: false, text: texts.downloadFailed };
	}

	const inspection = await inspectImage(download.bytes, { maxPixels: deps.limits.maxPixels });
	if (!inspection.ok)
	{
		return { ok: false, text: problemText(inspection.problem, deps.limits) };
	}

	return { ok: true, bytes: download.bytes, image: inspection.image };
}
