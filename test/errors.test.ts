import { GrammyError, HttpError } from "grammy";
import { describe, expect, it } from "vitest";

import { describeError, reactionTo, type ErrorReaction } from "../src/bot/errors.ts";
import { createBot } from "../src/bot/create-bot.ts";
import { createLogger } from "../src/logger.ts";
import { texts } from "../src/texts.ts";
import { botInfo, callbackUpdate, privateChat, recordCalls, textUpdate, type Failure } from "./support/telegram.ts";

const token = "123456789:AAHfake-token_for-tests-only0123456789";

function apiError(method: string, error_code: number, description: string, payload: Record<string, unknown> = {}): GrammyError
{
	return new GrammyError(`Call to '${method}' failed!`, { ok: false, error_code, description }, method, payload);
}

const networkDown = new HttpError(
	"Network request for 'sendMessage' failed!",
	Object.assign(new Error(`request to https://api.telegram.org/bot${token}/sendMessage failed, reason: read ECONNRESET`), {
		code: "ECONNRESET",
	}),
);

describe("reactionTo", () =>
{
	const cases: readonly (readonly [string, ErrorReaction, unknown])[] = [
		["a second press of the same button", "ignore", apiError("editMessageText", 400, "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message")],
		["a button answered too late, after a restart", "ignore", apiError("answerCallbackQuery", 400, "Bad Request: query is too old and response timeout expired or query ID is invalid")],
		["a user who blocked the bot", "log", apiError("sendMessage", 403, "Forbidden: bot was blocked by the user")],
		["a deleted account", "log", apiError("sendMessage", 403, "Forbidden: user is deactivated")],
		["Telegram asking to slow down", "log", apiError("sendMessage", 429, "Too Many Requests: retry after 5")],
		["a network failure", "log", networkDown],
		["a request Telegram rejects for another reason", "notify", apiError("editMessageText", 400, "Bad Request: can't parse entities")],
		["a bug in the bot itself", "notify", new TypeError("Cannot read properties of undefined")],
	];

	it.each(cases)("%s → %s", (_name, reaction, error) =>
	{
		expect(reactionTo(error)).toBe(reaction);
	});
});

describe("describeError", () =>
{
	// /privacy promises the log holds no message content; a failed request carries
	// its whole payload, chat id and text included.
	it("names the method and Telegram's answer but leaves out the request payload", () =>
	{
		const error = apiError("sendMessage", 400, "Bad Request: chat not found", { chat_id: 1001, text: "мой адрес" });

		expect(describeError(error)).toEqual({ method: "sendMessage", code: 400, description: "Bad Request: chat not found" });
	});

	it("names a network failure by its code, never by the URL that holds the token", () =>
	{
		expect(describeError(networkDown)).toEqual({ reason: "ECONNRESET" });
	});

	it("keeps a bug as an error so its stack reaches the log", () =>
	{
		const bug = new TypeError("boom");

		expect(describeError(bug)).toEqual({ err: bug });
	});
});

describe("a bot whose request fails", () =>
{
	function setup(failures: Readonly<Record<string, Failure>>): {
		bot: ReturnType<typeof createBot>;
		calls: ReturnType<typeof recordCalls>;
		logs: () => Record<string, unknown>[];
		raw: string[];
	}
	{
		const raw: string[] = [];
		const logger = createLogger({ level: "debug", secrets: [token], destination: { write: (line) => raw.push(line) } });
		const bot = createBot({ token, logger, botInfo });
		const calls = recordCalls(bot, failures);

		return { bot, calls, raw, logs: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>) };
	}

	const warnings = (lines: Record<string, unknown>[]): Record<string, unknown>[] =>
		lines.filter((line) => typeof line.level === "number" && line.level >= 40);

	it("stays quiet when a button is pressed twice and the screen is already shown", async () =>
	{
		const { bot, calls, logs } = setup({ editMessageText: { error_code: 400, description: "Bad Request: message is not modified" } });

		await bot.handleUpdate(callbackUpdate("menu:main"));

		expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
		expect(warnings(logs())).toEqual([]);
	});

	it("tells the user something went wrong and logs the cause without the chat id", async () =>
	{
		const { bot, calls, logs, raw } = setup({ editMessageText: { error_code: 400, description: "Bad Request: can't parse entities" } });

		await bot.handleUpdate(callbackUpdate("menu:help"));

		expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery", "editMessageText", "sendMessage"]);
		expect(calls[2]?.payload).toMatchObject({ chat_id: privateChat.id, text: texts.failed });
		expect(warnings(logs())).toEqual([
			expect.objectContaining({ level: 50, method: "editMessageText", code: 400, msg: "update failed" }),
		]);
		expect(raw.join("")).not.toContain(String(privateChat.id));
	});

	it("does not write again to a user who blocked the bot", async () =>
	{
		const { bot, calls, logs } = setup({ sendMessage: { error_code: 403, description: "Forbidden: bot was blocked by the user" } });

		await bot.handleUpdate(textUpdate("/start"));

		expect(calls.map((call) => call.method)).toEqual(["sendMessage"]);
		expect(warnings(logs())).toEqual([expect.objectContaining({ level: 40, code: 403 })]);
	});

	it("logs a network failure instead of trying to send through the same broken network", async () =>
	{
		const { bot, calls, logs } = setup({ sendMessage: networkDown });

		await bot.handleUpdate(textUpdate("/start"));

		expect(calls.map((call) => call.method)).toEqual(["sendMessage"]);
		expect(warnings(logs())).toContainEqual(expect.objectContaining({ level: 40, reason: "ECONNRESET", msg: "update failed" }));
	});

	// bot.catch only runs under bot.start(); a webhook would see the error thrown
	// and answer Telegram with a 500, after which Telegram redelivers the update.
	it("handles the error inside the update, so a webhook would answer Telegram normally", async () =>
	{
		const { bot } = setup({ sendMessage: { error_code: 403, description: "Forbidden: bot was blocked by the user" } });

		await expect(bot.handleUpdate(textUpdate("/start"))).resolves.toBeUndefined();
	});
});
