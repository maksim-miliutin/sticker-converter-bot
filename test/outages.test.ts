import { HttpError } from "grammy";
import { afterEach, describe, expect, it } from "vitest";

import { createBot } from "../src/bot/create-bot.ts";
import { createLogger } from "../src/logger.ts";
import { reportOutages } from "../src/outages.ts";
import { telegramClientOptions } from "../src/telegram-client.ts";
import { startRefusingSocksServer, type RefusingSocksServer } from "./support/socks.ts";
import { botInfo } from "./support/telegram.ts";

const token = "123456789:AAHfake-token_for-tests-only0123456789";

interface LogLine
{
	level: number;
	msg: string;
	method?: string;
	reason?: string;
}

function setup(): { raw: string[]; lines: () => LogLine[]; transform: ReturnType<typeof reportOutages> }
{
	const raw: string[] = [];
	const logger = createLogger({ level: "info", secrets: [token], destination: { write: (line) => raw.push(line) } });

	return {
		raw,
		lines: () => raw.map((line) => JSON.parse(line) as LogLine),
		transform: reportOutages(logger),
	};
}

// What grammY's base call throws when fetch fails: the cause carries the URL,
// and with it the token, in its message.
const resetByNetwork = new HttpError(
	"Network request for 'getUpdates' failed!",
	Object.assign(new Error(`request to https://api.telegram.org/bot${token}/getUpdates failed, reason: read ECONNRESET`), {
		code: "ECONNRESET",
	}),
);

const failing = (): Promise<never> => Promise.reject(resetByNetwork);
const answering = (): Promise<never> => Promise.resolve({ ok: true, result: [] } as never);

// grammY types the signal with the abort-controller polyfill, which the built-in
// AbortSignal satisfies at runtime but not structurally.
type GrammySignal = Parameters<ReturnType<typeof reportOutages>>[3];

async function call(
	transform: ReturnType<typeof reportOutages>,
	prev: () => Promise<never>,
	signal?: AbortSignal,
): Promise<unknown>
{
	return transform(prev, "getUpdates", {}, signal as GrammySignal).catch((error: unknown) => error);
}

let proxy: RefusingSocksServer | undefined;

afterEach(async () =>
{
	await proxy?.close();
	proxy = undefined;
});

describe("reportOutages", () =>
{
	it("warns once when Telegram becomes unreachable and names the network error, not the URL", async () =>
	{
		const { lines, raw, transform } = setup();

		await call(transform, failing);
		await call(transform, failing);
		await call(transform, failing);

		expect(lines().filter((line) => line.level === 40)).toEqual([
			expect.objectContaining({ method: "getUpdates", reason: "ECONNRESET", msg: "telegram is unreachable, retrying" }),
		]);
		expect(raw.join("")).not.toContain("api.telegram.org/bot");
	});

	// node-fetch keeps the cause only inside its message when the failure has no
	// system code, as with a SOCKS proxy refusing the connection.
	it("falls back to the cause after 'reason:' when the network error has no code", async () =>
	{
		const { lines, raw, transform } = setup();
		const refusedByProxy = new HttpError(
			"Network request for 'getUpdates' failed!",
			Object.assign(
				new Error(`request to https://api.telegram.org/bot${token}/getUpdates failed, reason: Socks5 proxy rejected connection - ConnectionRefused`),
				{ name: "FetchError" },
			),
		);

		await call(transform, () => Promise.reject(refusedByProxy));

		expect(lines()[0]?.reason).toBe("Socks5 proxy rejected connection - ConnectionRefused");
		expect(raw.join("")).not.toContain("api.telegram.org/bot");
	});

	it("announces once that Telegram answers again", async () =>
	{
		const { lines, transform } = setup();

		await call(transform, failing);
		await call(transform, answering);
		await call(transform, answering);

		expect(lines().filter((line) => line.msg === "telegram is reachable again")).toHaveLength(1);
	});

	it("says nothing while Telegram keeps answering", async () =>
	{
		const { raw, transform } = setup();

		await call(transform, answering);

		expect(raw).toEqual([]);
	});

	// bot.stop() aborts the pending getUpdates; that failure is the bot leaving,
	// not the network going away.
	it("keeps quiet about a request cancelled because the bot is stopping", async () =>
	{
		const { raw, transform } = setup();
		const stopping = new AbortController();
		stopping.abort();

		await call(transform, failing, stopping.signal);

		expect(raw).toEqual([]);
	});

	it("hands the failure on unchanged, so grammY retries exactly as before", async () =>
	{
		const { transform } = setup();

		expect(await call(transform, failing)).toBe(resetByNetwork);
	});

	it("is installed on every bot, so a failed startup getMe is reported too", async () =>
	{
		proxy = await startRefusingSocksServer();
		const raw: string[] = [];
		const logger = createLogger({ level: "info", secrets: [token], destination: { write: (line) => raw.push(line) } });
		const bot = createBot({
			token,
			logger,
			botInfo,
			client: telegramClientOptions(`socks5h://127.0.0.1:${String(proxy.port)}`),
		});

		await expect(bot.api.getMe()).rejects.toThrow();

		expect(raw.map((line) => JSON.parse(line) as LogLine)).toEqual([
			expect.objectContaining({ level: 40, method: "getMe", msg: "telegram is unreachable, retrying" }),
		]);
	});
});
