import { describe, expect, it } from "vitest";

import { createBot } from "../src/bot/create-bot.ts";
import { createLogger } from "../src/logger.ts";
import { PackStore } from "../src/store/packs.ts";
import { texts } from "../src/texts.ts";
import { solid } from "./support/images.ts";
import { botInfo, buttonsOf, callbackUpdate, documentUpdate, recordCalls, textUpdate, type ApiCall, type Failure } from "./support/telegram.ts";

const token = "123456789:AAHfake-token_for-tests-only0123456789";
const anna = 1001;
const boris = 2002;

interface Env
{
	bot: ReturnType<typeof createBot>;
	calls: ApiCall[];
	packs: PackStore;
}

function setup(failures: Readonly<Record<string, Failure>> = {}): Env
{
	const packs = new PackStore(":memory:");
	const bot = createBot({
		token,
		logger: createLogger({ level: "silent", secrets: [token] }),
		botInfo,
		packs,
		retry: { attempts: 1, delayMs: 0 },
		download: async () => ({ ok: true, bytes: await solid(300, 200, "png") }),
	});

	return { bot, calls: recordCalls(bot, failures), packs };
}

const press = (env: Env, data: string, fromId?: number): Promise<void> =>
	env.bot.handleUpdate(callbackUpdate(data, fromId === undefined ? {} : { fromId }));

const last = (env: Env, method: string): ApiCall | undefined => env.calls.filter((call) => call.method === method).at(-1);

// Sends an image, presses "Make a sticker" and returns the add button's data.
async function madeSticker(env: Env): Promise<string>
{
	await env.bot.handleUpdate(documentUpdate({ fileId: "doc-1", mimeType: "image/png", bytes: 5_000 }));
	const [sticker = ""] = buttonsOf(last(env, "sendMessage"));
	await press(env, sticker);

	return buttonsOf(last(env, "sendSticker"))[0] ?? "";
}

// Goes on to the emoji and returns the pack buttons offered.
async function atPackChoice(env: Env): Promise<string[]>
{
	await press(env, await madeSticker(env));
	const [firstEmoji = ""] = buttonsOf(last(env, "sendMessage"));
	await press(env, firstEmoji);

	return buttonsOf(last(env, "editMessageText"));
}

const expectedSticker = { sticker: "uploaded-1", format: "static", emoji_list: ["😀"] };

describe("making a sticker", () =>
{
	it("uploads it once for Telegram, shows it with an add button and reports its size", async () =>
	{
		const env = setup();

		await madeSticker(env);

		const after = env.calls.slice(1).map((call) => call.method);
		expect(after).toEqual(["answerCallbackQuery", "editMessageText", "uploadStickerFile", "sendSticker", "editMessageText"]);
		expect(last(env, "uploadStickerFile")?.payload).toMatchObject({ user_id: anna, sticker_format: "static" });
		expect(last(env, "sendSticker")?.payload).toMatchObject({ chat_id: anna, sticker: "uploaded-1" });
		expect(buttonsOf(last(env, "sendSticker"))).toEqual([expect.stringMatching(/^stk:[\w-]{16}:add$/)]);
		expect(last(env, "editMessageText")?.payload.text).toMatch(/^Стикер готов: 512×341, \d+ КБ\./);
	});
});

describe("adding a sticker to a pack", () =>
{
	it("asks for an emoji, then offers the user's own packs and a new one", async () =>
	{
		const env = setup();
		const own = env.packs.add(anna, "sown0001_by_sticker_test_bot", "Мои");
		env.packs.add(boris, "sbor0001_by_sticker_test_bot", "Чужие");

		await press(env, await madeSticker(env));
		expect(last(env, "sendMessage")?.payload.text).toBe(texts.chooseEmoji);
		expect(buttonsOf(last(env, "sendMessage"))).toHaveLength(10);

		const [firstEmoji = ""] = buttonsOf(last(env, "sendMessage"));
		await press(env, firstEmoji);

		expect(last(env, "editMessageText")?.payload.text).toBe(texts.choosePack("😀"));
		expect(buttonsOf(last(env, "editMessageText"))).toEqual([
			expect.stringMatching(new RegExp(`^pk:[\\w-]{16}:${String(own.id)}$`)),
			expect.stringMatching(/^pk:[\w-]{16}:new$/),
		]);
	});

	it("creates a new pack with the title the user sends, and records it only then", async () =>
	{
		const env = setup();
		const [create = ""] = await atPackChoice(env);

		await press(env, create);
		expect(last(env, "editMessageText")?.payload.text).toBe(texts.askTitle);
		expect(env.packs.list(anna)).toEqual([]);

		await env.bot.handleUpdate(textUpdate("Мои котики"));

		const created = last(env, "createNewStickerSet")?.payload;
		expect(created).toMatchObject({ user_id: anna, title: "Мои котики", stickers: [expectedSticker] });
		expect(created?.name).toMatch(/^s[a-z0-9]{7}_by_sticker_test_bot$/);
		expect(env.packs.list(anna)).toMatchObject([{ name: created?.name, title: "Мои котики" }]);
		expect(last(env, "sendMessage")?.payload.text).toBe(texts.packCreated("Мои котики", `https://t.me/addstickers/${String(created?.name)}`));
	});

	it("tries another name when Telegram says the name is taken, and never reports a false success", async () =>
	{
		const env = setup({ createNewStickerSet: { error_code: 400, description: "Bad Request: sticker set name is already occupied" } });
		const [create = ""] = await atPackChoice(env);
		await press(env, create);

		await env.bot.handleUpdate(textUpdate("Котики"));

		const names = env.calls.filter((call) => call.method === "createNewStickerSet").map((call) => call.payload.name);
		expect(names).toHaveLength(3);
		expect(new Set(names).size).toBe(3);
		expect(last(env, "sendMessage")?.payload.text).toBe(texts.packNameBusy);
		expect(env.packs.list(anna)).toEqual([]);
	});

	it("records nothing when Telegram refuses to create the pack", async () =>
	{
		const env = setup({ createNewStickerSet: { error_code: 400, description: "Bad Request: STICKER_PNG_DIMENSIONS" } });
		const [create = ""] = await atPackChoice(env);
		await press(env, create);

		await env.bot.handleUpdate(textUpdate("Котики"));

		expect(env.packs.list(anna)).toEqual([]);
		expect(last(env, "sendMessage")?.payload.text).toBe(texts.failed);
	});

	it("asks again for a title longer than 64 characters", async () =>
	{
		const env = setup();
		const [create = ""] = await atPackChoice(env);
		await press(env, create);

		await env.bot.handleUpdate(textUpdate("я".repeat(65)));
		expect(last(env, "sendMessage")?.payload.text).toBe(texts.badTitle);

		await env.bot.handleUpdate(textUpdate("я".repeat(64)));
		expect(env.packs.list(anna)).toHaveLength(1);
	});

	it("adds to an existing pack of the user", async () =>
	{
		const env = setup();
		const pack = env.packs.add(anna, "sown0001_by_sticker_test_bot", "Мои");
		const [existing = ""] = await atPackChoice(env);

		await press(env, existing);

		expect(last(env, "addStickerToSet")?.payload).toEqual({ user_id: anna, name: pack.name, sticker: expectedSticker });
		expect(last(env, "editMessageText")?.payload.text).toBe(texts.stickerAdded("Мои", `https://t.me/addstickers/${pack.name}`));
	});

	it("adds the sticker once however many times the button is pressed", async () =>
	{
		const env = setup();
		env.packs.add(anna, "sown0001_by_sticker_test_bot", "Мои");
		const [existing = ""] = await atPackChoice(env);

		await press(env, existing);
		await press(env, existing);

		expect(env.calls.filter((call) => call.method === "addStickerToSet")).toHaveLength(1);
		expect(env.calls.at(-1)).toMatchObject({ method: "answerCallbackQuery", payload: { text: texts.staleButton } });
	});

	// Callback data carries the pack id; swapping in someone else's id must not
	// reach their pack.
	it("refuses a forged press naming someone else's pack", async () =>
	{
		const env = setup();
		const theirs = env.packs.add(boris, "sbor0001_by_sticker_test_bot", "Чужие");
		const [create = ""] = await atPackChoice(env);
		const forged = create.replace(/:new$/, `:${String(theirs.id)}`);

		await press(env, forged);

		expect(env.calls.filter((call) => call.method === "addStickerToSet")).toEqual([]);
		expect(env.calls.at(-1)).toMatchObject({ method: "answerCallbackQuery", payload: { text: texts.staleButton } });
	});

	it("drops a pack Telegram no longer has from the list", async () =>
	{
		const env = setup({ addStickerToSet: { error_code: 400, description: "Bad Request: STICKERSET_INVALID" } });
		env.packs.add(anna, "sgone001_by_sticker_test_bot", "Удалённый");
		const [existing = ""] = await atPackChoice(env);

		await press(env, existing);

		expect(last(env, "editMessageText")?.payload.text).toBe(texts.packMissing("Удалённый"));
		expect(env.packs.list(anna)).toEqual([]);
	});

	it("says so when the pack is full", async () =>
	{
		const env = setup({ addStickerToSet: { error_code: 400, description: "Bad Request: STICKERS_TOO_MUCH" } });
		env.packs.add(anna, "sfull001_by_sticker_test_bot", "Полный");
		const [existing = ""] = await atPackChoice(env);

		await press(env, existing);

		expect(last(env, "editMessageText")?.payload.text).toBe(texts.packFull);
		expect(env.packs.list(anna)).toHaveLength(1);
	});

	it("/cancel forgets a question about the title", async () =>
	{
		const env = setup();
		const [create = ""] = await atPackChoice(env);
		await press(env, create);

		await env.bot.handleUpdate(textUpdate("/cancel"));
		await env.bot.handleUpdate(textUpdate("Котики"));

		expect(env.calls.filter((call) => call.method === "createNewStickerSet")).toEqual([]);
		expect(last(env, "sendMessage")?.payload.text).toBe(texts.hint);
	});
});

describe("the user's packs", () =>
{
	it("/packs lists the user's packs with links, and says when there are none", async () =>
	{
		const env = setup();
		await env.bot.handleUpdate(textUpdate("/packs"));
		expect(last(env, "sendMessage")?.payload.text).toBe(texts.packsEmpty);

		env.packs.add(anna, "sone0001_by_sticker_test_bot", "Первый");
		env.packs.add(boris, "sbor0001_by_sticker_test_bot", "Чужой");
		await env.bot.handleUpdate(textUpdate("/packs"));

		expect(last(env, "sendMessage")?.payload.text).toBe(texts.packsList("1. «Первый» — https://t.me/addstickers/sone0001_by_sticker_test_bot"));
	});

	it("/delete_me asks first and removes the user's packs only after confirmation", async () =>
	{
		const env = setup();
		env.packs.add(anna, "sone0001_by_sticker_test_bot", "Первый");
		env.packs.add(boris, "sbor0001_by_sticker_test_bot", "Чужой");

		await env.bot.handleUpdate(textUpdate("/delete_me"));
		expect(last(env, "sendMessage")?.payload.text).toBe(texts.deleteConfirm(1));
		expect(buttonsOf(last(env, "sendMessage"))).toEqual(["del:yes", "del:no"]);

		await press(env, "del:no");
		expect(env.packs.list(anna)).toHaveLength(1);

		await press(env, "del:yes");
		expect(env.packs.list(anna)).toEqual([]);
		expect(env.packs.list(boris)).toHaveLength(1);
		expect(last(env, "editMessageText")?.payload.text).toBe(texts.deleted);
	});
});
