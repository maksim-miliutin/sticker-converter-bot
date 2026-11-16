import { afterEach, describe, expect, it } from "vitest";

import { createBot } from "../src/bot/create-bot.ts";
import { createLogger } from "../src/logger.ts";
import { proxyLabel, telegramClientOptions } from "../src/telegram-client.ts";
import { botInfo } from "./support/telegram.ts";
import { startRefusingSocksServer, type RefusingSocksServer } from "./support/socks.ts";

const token = "123456789:AAHfake-token_for-tests-only0123456789";

let proxy: RefusingSocksServer | undefined;

afterEach(async () =>
{
	await proxy?.close();
	proxy = undefined;
});

describe("telegramClientOptions", () =>
{
	it("leaves grammY's own connection settings alone when no proxy is configured", () =>
	{
		expect(telegramClientOptions(undefined)).toEqual({});
	});

	// grammY on Node talks through node-fetch, which ignores proxy environment
	// variables and the system proxy; only an agent in baseFetchConfig reroutes it.
	it("sends Bot API requests through the SOCKS proxy and lets the proxy resolve api.telegram.org", async () =>
	{
		proxy = await startRefusingSocksServer();
		const logger = createLogger({ level: "silent", secrets: [token] });
		const bot = createBot({
			token,
			logger,
			botInfo,
			client: telegramClientOptions(`socks5h://127.0.0.1:${String(proxy.port)}`),
		});

		await expect(bot.api.getMe()).rejects.toThrow();

		expect(proxy.requests).toEqual([{ host: "api.telegram.org", port: 443, addressType: "domain" }]);
	});
});

describe("proxyLabel", () =>
{
	it("says the connection is direct when no proxy is configured", () =>
	{
		expect(proxyLabel(undefined)).toBe("direct");
	});

	it("names the proxy for the startup log without its login and password", () =>
	{
		expect(proxyLabel("socks5://user:hunter2@127.0.0.1:1080")).toBe("socks5://127.0.0.1:1080");
	});
});
