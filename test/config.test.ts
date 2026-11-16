import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig, secretsOf } from "../src/config.ts";

const token = "123456789:AAHfake-token_for-tests-only0123456789";

function issuesOf(env: Record<string, string | undefined>): readonly string[]
{
	try
	{
		loadConfig(env);
	}
	catch (error)
	{
		if (error instanceof ConfigError)
		{
			return error.issues;
		}

		throw error;
	}

	throw new Error("expected loadConfig to reject this environment");
}

describe("loadConfig", () =>
{
	it("accepts a well-formed token and defaults the log level to info", () =>
	{
		expect(loadConfig({ BOT_TOKEN: token })).toMatchObject({ botToken: token, logLevel: "info" });
	});

	it("trims the whitespace an .env file or a copy-paste leaves around values", () =>
	{
		const config = loadConfig({ BOT_TOKEN: ` ${token}\n`, LOG_LEVEL: " debug " });

		expect(config).toMatchObject({ botToken: token, logLevel: "debug" });
	});

	it("names every problem at once instead of stopping at the first", () =>
	{
		const issues = issuesOf({ LOG_LEVEL: "loud" });

		expect(issues).toHaveLength(2);
		expect(issues.join("\n")).toContain("BOT_TOKEN");
		expect(issues.join("\n")).toContain("LOG_LEVEL");
	});

	it("treats an empty token the same as a missing one", () =>
	{
		expect(issuesOf({ BOT_TOKEN: "   " })).toEqual([expect.stringContaining("BOT_TOKEN is not set")]);
	});

	// The error ends up in a terminal or a log; a token with one character off is
	// still one character away from the real secret.
	it("never repeats a malformed token in the error text", () =>
	{
		const almost = "123456789:AAHfake token with a space in it 0123";
		const issues = issuesOf({ BOT_TOKEN: almost });

		expect(issues).toHaveLength(1);
		expect(issues[0]).not.toContain("AAHfake");
		expect(String(new ConfigError(issues))).not.toContain("AAHfake");
	});

	it("rejects a log level pino does not know", () =>
	{
		expect(issuesOf({ BOT_TOKEN: token, LOG_LEVEL: "verbose" })).toEqual([expect.stringContaining("LOG_LEVEL")]);
	});
});

describe("POLLING_TIMEOUT_SECONDS", () =>
{
	it("holds each getUpdates for 30 seconds by default, as grammY does", () =>
	{
		expect(loadConfig({ BOT_TOKEN: token }).pollingTimeoutSeconds).toBe(30);
	});

	// Cloudflare WARP in Local Proxy mode drops any request longer than 10 seconds.
	it("accepts a short timeout for proxies that cut long requests", () =>
	{
		expect(loadConfig({ BOT_TOKEN: token, POLLING_TIMEOUT_SECONDS: " 5 " }).pollingTimeoutSeconds).toBe(5);
	});

	// 0 would turn long polling into a request every few milliseconds.
	it.each(["0", "51", "5.5", "-3", "abc", "1e1"])("rejects %s", (value) =>
	{
		expect(issuesOf({ BOT_TOKEN: token, POLLING_TIMEOUT_SECONDS: value })).toEqual([
			expect.stringContaining("POLLING_TIMEOUT_SECONDS"),
		]);
	});
});

describe("file limits", () =>
{
	it("takes 20 MB and 50 megapixels by default", () =>
	{
		expect(loadConfig({ BOT_TOKEN: token })).toMatchObject({ maxFileBytes: 20 * 1024 * 1024, maxPixels: 50_000_000 });
	});

	it("accepts lower limits", () =>
	{
		const config = loadConfig({ BOT_TOKEN: token, MAX_FILE_MB: "5", MAX_INPUT_MEGAPIXELS: "12" });

		expect(config).toMatchObject({ maxFileBytes: 5 * 1024 * 1024, maxPixels: 12_000_000 });
	});

	// getFile in the cloud Bot API stops at 20 MB; a higher number would only
	// promise users something Telegram refuses.
	it.each(["21", "0", "abc"])("rejects MAX_FILE_MB=%s", (value) =>
	{
		expect(issuesOf({ BOT_TOKEN: token, MAX_FILE_MB: value })).toEqual([expect.stringContaining("MAX_FILE_MB")]);
	});

	it.each(["0", "101", "1.5"])("rejects MAX_INPUT_MEGAPIXELS=%s", (value) =>
	{
		expect(issuesOf({ BOT_TOKEN: token, MAX_INPUT_MEGAPIXELS: value })).toEqual([expect.stringContaining("MAX_INPUT_MEGAPIXELS")]);
	});
});

describe("TELEGRAM_PROXY_URL", () =>
{
	it("leaves the proxy off when the variable is unset or blank", () =>
	{
		expect(loadConfig({ BOT_TOKEN: token }).telegramProxyUrl).toBeUndefined();
		expect(loadConfig({ BOT_TOKEN: token, TELEGRAM_PROXY_URL: "  " }).telegramProxyUrl).toBeUndefined();
	});

	it("accepts the Cloudflare WARP local proxy", () =>
	{
		const config = loadConfig({ BOT_TOKEN: token, TELEGRAM_PROXY_URL: " socks5h://127.0.0.1:40000 " });

		expect(config.telegramProxyUrl).toBe("socks5h://127.0.0.1:40000");
	});

	// An http:// proxy would need a different agent; accepting it silently would
	// leave the bot on a direct connection that the network resets.
	it.each([
		"http://127.0.0.1:8080",
		"127.0.0.1:40000",
		"socks5h://127.0.0.1",
		"socks5h://:40000",
		"socks://127.0.0.1:40000",
	])("rejects %s with a hint at the expected form", (url) =>
	{
		expect(issuesOf({ BOT_TOKEN: token, TELEGRAM_PROXY_URL: url })).toEqual([
			expect.stringContaining("socks5h://127.0.0.1:40000"),
		]);
	});

	it("never repeats the proxy address in the error, since it may carry a password", () =>
	{
		const issues = issuesOf({ BOT_TOKEN: token, TELEGRAM_PROXY_URL: "http://user:hunter2@proxy.example:8080" });

		expect(issues.join("\n")).not.toContain("hunter2");
	});

	it("hands the proxy password to the logger as a secret, as written and decoded", () =>
	{
		const config = loadConfig({ BOT_TOKEN: token, TELEGRAM_PROXY_URL: "socks5://user:p%40ss@127.0.0.1:1080" });

		expect(secretsOf(config)).toEqual([token, "p%40ss", "p@ss"]);
	});

	it("keeps a password with a stray percent sign as written instead of failing at startup", () =>
	{
		const config = loadConfig({ BOT_TOKEN: token, TELEGRAM_PROXY_URL: "socks5://user:50%off@127.0.0.1:1080" });

		expect(secretsOf(config)).toEqual([token, "50%off"]);
	});

	it("has no proxy secrets when the proxy needs no password", () =>
	{
		const config = loadConfig({ BOT_TOKEN: token, TELEGRAM_PROXY_URL: "socks5h://127.0.0.1:40000" });

		expect(secretsOf(config)).toEqual([token]);
	});
});
