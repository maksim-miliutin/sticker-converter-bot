import { describe, expect, it } from "vitest";

import { createBot } from "../src/bot/create-bot.ts";
import { createLogger } from "../src/logger.ts";
import type { Download } from "../src/telegram-files.ts";
import { texts } from "../src/texts.ts";
import { solid, truncated } from "./support/images.ts";
import {
	botInfo,
	buttonsOf,
	callbackUpdate,
	documentUpdate,
	photoUpdate,
	recordCalls,
	textUpdate,
	type ApiCall,
} from "./support/telegram.ts";

const token = "123456789:AAHfake-token_for-tests-only0123456789";
const maxFileBytes = 1024 * 1024;

interface Setup
{
	bot: ReturnType<typeof createBot>;
	calls: ApiCall[];
	downloads: string[];
	logs: string[];
}

function setup(answer: () => Promise<Download> = async () => ({ ok: true, bytes: await solid(300, 200, "png") })): Setup
{
	const downloads: string[] = [];
	const logs: string[] = [];
	const logger = createLogger({ level: "info", secrets: [token], destination: { write: (line) => logs.push(line) } });
	const bot = createBot({
		token,
		logger,
		botInfo,
		limits: { maxFileBytes, maxPixels: 50_000_000 },
		download: (fileId) =>
		{
			downloads.push(fileId);
			return answer();
		},
	});

	return { bot, calls: recordCalls(bot), downloads, logs };
}

// Sends an image and returns the callback data of the choice the bot offered.
async function offered(env: Setup, update = documentUpdate({ fileId: "doc-7", mimeType: "image/png", bytes: 5_000 })): Promise<{ sticker: string; convert: string; cancel: string }>
{
	await env.bot.handleUpdate(update);
	const [sticker = "", convert = "", cancel = ""] = buttonsOf(env.calls.at(-1));

	return { sticker, convert, cancel };
}

const methods = (calls: ApiCall[]): string[] => calls.map((call) => call.method);
const texts_ = (calls: ApiCall[]): unknown[] => calls.map((call) => call.payload.text);

describe("an image arriving", () =>
{
	it("as a photo is answered with a choice and a hint to send a file instead", async () =>
	{
		const env = setup();
		const update = photoUpdate([{ fileId: "small", side: 90 }, { fileId: "large", side: 1280, bytes: 90_000 }]);

		await env.bot.handleUpdate(update);

		expect(methods(env.calls)).toEqual(["sendMessage"]);
		expect(env.calls[0]?.payload).toMatchObject({
			text: `${texts.chooseAction}\n\n${texts.photoHint}`,
			reply_parameters: { message_id: update.message?.message_id },
		});
		expect(buttonsOf(env.calls[0])).toEqual([
			expect.stringMatching(/^img:[\w-]{16}:sticker$/),
			expect.stringMatching(/^img:[\w-]{16}:convert$/),
			expect.stringMatching(/^img:[\w-]{16}:cancel$/),
		]);
	});

	// The spec forbids downloading before the user asks for something.
	it("is not downloaded until an action is picked", async () =>
	{
		const env = setup();

		await offered(env);

		expect(env.downloads).toEqual([]);
	});

	it("as a file gets the choice without the photo hint", async () =>
	{
		const env = setup();

		await offered(env);

		expect(env.calls[0]?.payload.text).toBe(texts.chooseAction);
	});

	it.each(["application/pdf", "image/gif", "image/heic", "image/svg+xml"])(
		"as a %s document is refused before anything is downloaded",
		async (mimeType) =>
		{
			const env = setup();

			await env.bot.handleUpdate(documentUpdate({ mimeType, bytes: 5_000 }));

			expect(texts_(env.calls)).toEqual([texts.unsupportedFormat]);
			expect(env.downloads).toEqual([]);
		},
	);

	it("over the size limit is refused before anything is downloaded", async () =>
	{
		const env = setup();

		await env.bot.handleUpdate(documentUpdate({ mimeType: "image/png", bytes: maxFileBytes + 1 }));

		expect(texts_(env.calls)).toEqual([texts.tooLarge(1)]);
		expect(env.downloads).toEqual([]);
	});
});

describe("picking an action", () =>
{
	it("acknowledges the press, says it is checking, then reports what the image is", async () =>
	{
		const env = setup();
		const { convert } = await offered(env, photoUpdate([{ fileId: "small", side: 90 }, { fileId: "large", side: 1280 }]));

		await env.bot.handleUpdate(callbackUpdate(convert));

		expect(methods(env.calls.slice(1))).toEqual(["answerCallbackQuery", "editMessageText", "editMessageText"]);
		expect(texts_(env.calls.slice(2))).toEqual([texts.checking, texts.imageAccepted("PNG, 300×200, 1 КБ")]);
		expect(env.downloads).toEqual(["large"]);
	});

	it("names transparency and the size in megabytes when they apply", async () =>
	{
		const bytes = Buffer.concat([await solid(64, 64, "png", true), Buffer.alloc(1_300_000)]);
		const env = setup(() => Promise.resolve({ ok: true, bytes }));
		const { convert } = await offered(env);

		await env.bot.handleUpdate(callbackUpdate(convert));

		expect(env.calls.at(-1)?.payload.text).toBe(texts.imageAccepted("PNG с прозрачностью, 64×64, 1,2 МБ"));
	});

	it.each([
		["a cut-off file", async () => truncated(await solid(200, 200, "jpeg")), texts.corrupted],
		["a GIF renamed to .png", () => solid(32, 32, "gif"), texts.unsupportedFormat],
	])("reports %s by what its bytes are", async (_name, make, expected) =>
	{
		const bytes = await make();
		const env = setup(() => Promise.resolve({ ok: true, bytes }));
		const { sticker } = await offered(env);

		await env.bot.handleUpdate(callbackUpdate(sticker));

		expect(env.calls.at(-1)?.payload.text).toBe(expected);
	});

	it("reports a file that turned out larger than the limit while downloading", async () =>
	{
		const env = setup(() => Promise.resolve({ ok: false, problem: "too-large" }));
		const { sticker } = await offered(env);

		await env.bot.handleUpdate(callbackUpdate(sticker));

		expect(env.calls.at(-1)?.payload.text).toBe(texts.tooLarge(1));
	});

	it("asks to try again when the download fails, and logs why without the file", async () =>
	{
		const env = setup(() => Promise.resolve({ ok: false, problem: "unavailable", reason: "ECONNRESET" }));
		const { sticker } = await offered(env);

		await env.bot.handleUpdate(callbackUpdate(sticker));

		expect(env.calls.at(-1)?.payload.text).toBe(texts.downloadFailed);
		expect(env.logs.map((line) => JSON.parse(line) as Record<string, unknown>)).toContainEqual(
			expect.objectContaining({ level: 40, reason: "ECONNRESET", msg: "image download failed" }),
		);
	});

	it("without a stand-in download asks Telegram for the file it offered", async () =>
	{
		const logger = createLogger({ level: "silent", secrets: [token] });
		const bot = createBot({ token, logger, botInfo });
		const calls = recordCalls(bot);
		const env: Setup = { bot, calls, downloads: [], logs: [] };
		const { sticker } = await offered(env);

		await bot.handleUpdate(callbackUpdate(sticker));

		expect(calls).toContainEqual({ method: "getFile", payload: { file_id: "doc-7" } });
		expect(calls.at(-1)?.payload.text).toBe(texts.downloadFailed);
	});

	it("cancel forgets the image without downloading it", async () =>
	{
		const env = setup();
		const { sticker, cancel } = await offered(env);

		await env.bot.handleUpdate(callbackUpdate(cancel));
		await env.bot.handleUpdate(callbackUpdate(sticker));

		expect(texts_(env.calls.slice(1))).toEqual([undefined, texts.imageCancelled, texts.staleButton]);
		expect(env.downloads).toEqual([]);
	});
});

describe("buttons that must not act", () =>
{
	// A repeated press or a redelivered update must not start a second download.
	it("a second press of the same button checks the image only once", async () =>
	{
		const env = setup();
		const { sticker } = await offered(env);

		await env.bot.handleUpdate(callbackUpdate(sticker));
		await env.bot.handleUpdate(callbackUpdate(sticker));

		expect(env.downloads).toHaveLength(1);
		expect(env.calls.at(-1)).toMatchObject({ method: "answerCallbackQuery", payload: { text: texts.staleButton } });
	});

	it("a forged press by someone else is answered as stale and leaves the image to its owner", async () =>
	{
		const env = setup();
		const { sticker } = await offered(env);

		await env.bot.handleUpdate(callbackUpdate(sticker, { fromId: 2002 }));

		expect(env.calls.at(-1)).toMatchObject({ method: "answerCallbackQuery", payload: { text: texts.staleButton } });
		expect(env.downloads).toEqual([]);

		await env.bot.handleUpdate(callbackUpdate(sticker));

		expect(env.downloads).toEqual(["doc-7"]);
	});

	it.each(["img:short:sticker", "img:AAAAAAAAAAAAAAAA:delete", "img:AAAAAAAAAAAAAAAA:sticker"])(
		"%s is answered as stale",
		async (data) =>
		{
			const env = setup();

			await env.bot.handleUpdate(callbackUpdate(data));

			expect(env.calls).toEqual([{ method: "answerCallbackQuery", payload: expect.objectContaining({ text: texts.staleButton }) as unknown }]);
		},
	);

	it.each([["/cancel"], ["/delete_me", "del:yes"]])("%s forgets every image still waiting", async (command, confirm?: string) =>
	{
		const env = setup();
		const { sticker } = await offered(env);

		await env.bot.handleUpdate(textUpdate(command));
		if (confirm !== undefined)
		{
			await env.bot.handleUpdate(callbackUpdate(confirm));
		}

		await env.bot.handleUpdate(callbackUpdate(sticker));

		expect(env.downloads).toEqual([]);
		expect(env.calls.at(-1)).toMatchObject({ method: "answerCallbackQuery", payload: { text: texts.staleButton } });
	});

	it("/cancel says so when there were images waiting, and that nothing was when there were none", async () =>
	{
		const env = setup();
		await env.bot.handleUpdate(textUpdate("/cancel"));
		await offered(env);
		await env.bot.handleUpdate(textUpdate("/cancel"));

		const replies = env.calls.filter((call) => call.method === "sendMessage").map((call) => call.payload.text);
		expect(replies).toEqual([texts.cancel, texts.chooseAction, texts.cancelledPending]);
	});
});
