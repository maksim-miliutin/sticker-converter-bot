import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logger.ts";

const token = "123456789:AAHfake-token_for-tests-only0123456789";

function capture(): { lines: string[]; write: (chunk: string) => void }
{
	const lines: string[] = [];

	return { lines, write: (chunk) => lines.push(chunk) };
}

describe("createLogger", () =>
{
	// grammY keeps the failed fetch as HttpError.error, and that error's message
	// carries the request URL, which is https://api.telegram.org/bot<token>/<method>.
	it("scrubs the bot token even from the fetch error nested inside grammY's HttpError", () =>
	{
		const output = capture();
		const logger = createLogger({ level: "info", secrets: [token], destination: output });
		const fetchError = new Error(`request to https://api.telegram.org/bot${token}/getMe failed, reason: ECONNRESET`);
		const httpError = Object.assign(new Error("Network request for 'getMe' failed!"), { error: fetchError });

		logger.error({ err: httpError }, "polling failed");

		expect(output.lines).toHaveLength(1);
		expect(output.lines[0]).not.toContain(token);
		expect(output.lines[0]).toContain("bot[redacted]/getMe");
	});

	it("keeps every line valid JSON with its fields intact", () =>
	{
		const output = capture();
		const logger = createLogger({ level: "info", secrets: [token], destination: output });

		logger.info({ updateId: 42 }, "update handled");

		expect(JSON.parse(output.lines[0] ?? "")).toMatchObject({ level: 30, updateId: 42, msg: "update handled" });
	});

	// replaceAll("") inserts the replacement between every character, which would
	// turn each log line into garbage the moment a secret happens to be unset.
	it("ignores an empty secret instead of mangling the output", () =>
	{
		const output = capture();
		const logger = createLogger({ level: "info", secrets: [""], destination: output });

		logger.info("still readable");

		expect(JSON.parse(output.lines[0] ?? "")).toMatchObject({ msg: "still readable" });
	});

	it("drops records below the configured level", () =>
	{
		const output = capture();
		const logger = createLogger({ level: "warn", secrets: [], destination: output });

		logger.info("too quiet");
		logger.warn("loud enough");

		expect(output.lines).toHaveLength(1);
		expect(output.lines[0]).toContain("loud enough");
	});
});
