import { describe, expect, it } from "vitest";

import { createBot } from "../src/bot/create-bot.ts";
import { commands, screenFor } from "../src/bot/menu.ts";
import { createLogger } from "../src/logger.ts";
import { texts } from "../src/texts.ts";
import {
	botInfo,
	buttonsOf,
	callbackUpdate,
	groupChat,
	privateChat,
	recordCalls,
	textUpdate,
} from "./support/telegram.ts";

const token = "123456789:AAHfake-token_for-tests-only0123456789";
const mainButtons = ["menu:sticker", "menu:convert", "menu:packs", "menu:help"];

function setup(): { bot: ReturnType<typeof createBot>; calls: ReturnType<typeof recordCalls>; logs: string[] }
{
	const logs: string[] = [];
	const logger = createLogger({ level: "debug", secrets: [token], destination: { write: (line) => logs.push(line) } });
	const bot = createBot({ token, logger, botInfo });

	return { bot, calls: recordCalls(bot), logs };
}

describe("commands", () =>
{
	it("/start opens the main menu with the four actions", async () =>
	{
		const { bot, calls } = setup();

		await bot.handleUpdate(textUpdate("/start"));

		expect(calls.map((call) => call.method)).toEqual(["sendMessage"]);
		expect(calls[0]?.payload).toMatchObject({ chat_id: privateChat.id, text: texts.welcome });
		expect(buttonsOf(calls[0])).toEqual(mainButtons);
	});

	it.each(commands.map((entry) => [entry.command, entry.screen] as const))(
		"/%s answers with its own screen, not the fallback hint",
		async (command, screen) =>
		{
			const { bot, calls } = setup();

			await bot.handleUpdate(textUpdate(`/${command}`));

			// Commands with their own handler answer with their own text.
			const own: Partial<Record<string, string>> = { delete_me: texts.deleteConfirm(0), packs: texts.packsEmpty };

			expect(calls.map((call) => call.method)).toEqual(["sendMessage"]);
			expect(calls[0]?.payload.text).toBe(own[command] ?? screenFor(screen).text);
			expect(calls[0]?.payload.text).not.toBe(texts.hint);
		},
	);

	// The table drives the tests above; an empty or shortened table would make them
	// pass by having nothing to check.
	it("offers exactly the commands the spec lists, in menu order", () =>
	{
		expect(commands.map((entry) => entry.command)).toEqual([
			"start",
			"stickers",
			"convert",
			"packs",
			"help",
			"privacy",
			"delete_me",
			"cancel",
		]);
	});

	it("every command has a description Telegram will accept in the command menu", () =>
	{
		for (const { command, description } of commands)
		{
			expect(command).toMatch(/^[a-z0-9_]{1,32}$/);
			expect(description.length).toBeGreaterThanOrEqual(1);
			expect(description.length).toBeLessThanOrEqual(256);
		}
	});

	it("an ordinary message gets a hint together with the main menu", async () =>
	{
		const { bot, calls } = setup();

		await bot.handleUpdate(textUpdate("сделай мне красиво"));

		expect(calls[0]?.payload.text).toBe(texts.hint);
		expect(buttonsOf(calls[0])).toEqual(mainButtons);
	});

	it("stays silent in groups, where it has nothing to offer", async () =>
	{
		const { bot, calls } = setup();

		await bot.handleUpdate(textUpdate("/start", groupChat));
		await bot.handleUpdate(textUpdate("hello", groupChat));

		expect(calls).toEqual([]);
	});
});

describe("menu buttons", () =>
{
	it("acknowledges the press before it changes the screen", async () =>
	{
		const { bot, calls } = setup();

		await bot.handleUpdate(callbackUpdate("menu:help"));

		expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
		expect(calls[1]?.payload.text).toBe(texts.help);
		expect(buttonsOf(calls[1])).toEqual(["menu:main"]);
	});

	it("back leads to the main menu", async () =>
	{
		const { bot, calls } = setup();

		await bot.handleUpdate(callbackUpdate("menu:main"));

		expect(calls[1]?.payload.text).toBe(texts.welcome);
		expect(buttonsOf(calls[1])).toEqual(mainButtons);
	});

	// Callback data comes back from the client as is; an old build, a hand-made
	// request or a typo must not reach any action.
	it.each(["menu:nope", "menu:", "menu:main:extra", "menu:privacy", "delete:everything", ""])(
		"answers a stale or forged button %j and changes nothing",
		async (data) =>
		{
			const { bot, calls } = setup();

			await bot.handleUpdate(callbackUpdate(data));

			expect(calls).toEqual([
				{ method: "answerCallbackQuery", payload: expect.objectContaining({ text: texts.staleButton }) as unknown },
			]);
		},
	);

	it("sends a fresh screen when the message under the button can no longer be edited", async () =>
	{
		const { bot, calls } = setup();

		await bot.handleUpdate(callbackUpdate("menu:sticker", { inaccessible: true }));

		expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery", "sendMessage"]);
		expect(calls[1]?.payload.text).toBe(texts.stickerPrompt);
	});

	it("still acknowledges a button pressed in a group, so the client stops spinning", async () =>
	{
		const { bot, calls } = setup();

		await bot.handleUpdate(callbackUpdate("menu:help", { chat: groupChat }));

		expect(calls.map((call) => call.method)).toEqual(["answerCallbackQuery"]);
	});
});

describe("logging", () =>
{
	// /privacy promises the log holds the update number and kind, never the text.
	it("records each update by id and kind without its text", async () =>
	{
		const { bot, logs } = setup();
		const update = textUpdate("мой адрес: улица Ленина, 1");

		await bot.handleUpdate(update);

		const line = logs.map((entry) => JSON.parse(entry) as Record<string, unknown>).find((entry) => entry.msg === "update handled");
		expect(line).toMatchObject({ updateId: update.update_id, kind: "message" });
		expect(logs.join("")).not.toContain("Ленина");
	});
});
