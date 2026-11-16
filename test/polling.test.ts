import { describe, expect, it } from "vitest";

import { assertNoWebhook, WebhookActiveError } from "../src/polling.ts";

function apiWithWebhook(url: string | undefined, pending = 0): Parameters<typeof assertNoWebhook>[0]
{
	const info = { has_custom_certificate: false, pending_update_count: pending };

	return {
		getWebhookInfo: () => Promise.resolve(url === undefined ? info : { ...info, url }),
	};
}

describe("assertNoWebhook", () =>
{
	it("lets long polling start when no webhook is set", async () =>
	{
		await expect(assertNoWebhook(apiWithWebhook(""))).resolves.toBeUndefined();
	});

	// The Bot API types mark url as optional ("may be empty"); an absent field must
	// not read as a webhook and block every start.
	it("treats an absent url the same as an empty one", async () =>
	{
		await expect(assertNoWebhook(apiWithWebhook(undefined))).resolves.toBeUndefined();
	});

	// grammY's bot.start() deletes any webhook before polling. Running the dev
	// script with the production token would silently take the live bot offline.
	it("refuses to poll over a live webhook instead of deleting it", async () =>
	{
		await expect(assertNoWebhook(apiWithWebhook("https://bot.example.com/hook", 7))).rejects.toBeInstanceOf(WebhookActiveError);
	});

	it("names the webhook host and the waiting updates but not the secret path", async () =>
	{
		const error = await assertNoWebhook(apiWithWebhook("https://bot.example.com/hook/s3cr3t-path", 7)).catch((caught: unknown) => caught);

		expect(String(error)).toContain("bot.example.com");
		expect(String(error)).toContain("7");
		expect(String(error)).not.toContain("s3cr3t-path");
	});
});
