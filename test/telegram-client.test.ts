import { SocksProxyAgent } from "socks-proxy-agent";
import { afterEach, describe, expect, it } from "vitest";

import { createBot } from "../src/bot/create-bot.ts";
import { createLogger } from "../src/logger.ts";
import { proxyLabel, telegramAgent, telegramClientOptions } from "../src/telegram-client.ts";
import { botInfo } from "./support/telegram.ts";
import { startRefusingSocksServer, type RefusingSocksServer } from "./support/socks.ts";

const token = "123456789:AAHfake-token_for-tests-only0123456789";

let proxy: RefusingSocksServer | undefined;

afterEach(async () =>
{
	await proxy?.close();
	proxy = undefined;
});

describe("telegramAgent", () =>
{
	it("makes no agent when no proxy is configured, so Node connects directly", () =>
	{
		expect(telegramAgent(undefined)).toBeUndefined();
	});

	it("makes a SOCKS agent for the configured proxy", () =>
	{
		const agent = telegramAgent("socks5h://127.0.0.1:40000");

		expect(agent).toBeInstanceOf(SocksProxyAgent);
		expect((agent as SocksProxyAgent).proxy).toMatchObject({ host: "127.0.0.1", port: 40000, type: 5 });
	});
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
			agent: new SocksProxyAgent(`socks5h://127.0.0.1:${String(proxy.port)}`),
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
