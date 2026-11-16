import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config.ts";

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
		expect(loadConfig({ BOT_TOKEN: token })).toEqual({ botToken: token, logLevel: "info" });
	});

	it("trims the whitespace an .env file or a copy-paste leaves around values", () =>
	{
		const config = loadConfig({ BOT_TOKEN: ` ${token}\n`, LOG_LEVEL: " debug " });

		expect(config).toEqual({ botToken: token, logLevel: "debug" });
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
