import type { Api, PollingOptions } from "grammy";

export class WebhookActiveError extends Error
{
	constructor(message: string)
	{
		super(message);
		this.name = "WebhookActiveError";
	}
}

// getUpdates and a webhook cannot run together, and grammY's bot.start() resolves
// that by deleting the webhook. Switching a bot between the two must be a decision,
// so polling refuses to start instead. Only the host is reported: the path of a
// webhook often doubles as its secret.
export async function assertNoWebhook(api: Pick<Api, "getWebhookInfo">): Promise<void>
{
	const info = await api.getWebhookInfo();
	const url = info.url ?? "";
	if (url === "")
	{
		return;
	}

	const host = URL.parse(url)?.host ?? "an unreadable address";

	throw new WebhookActiveError(
		`this bot has a webhook at ${host} with ${String(info.pending_update_count)} waiting updates; `
		+ "long polling would delete it. Use a separate test bot, or remove the webhook deliberately with deleteWebhook.",
	);
}

// timeout is how long Telegram holds each getUpdates open while nothing happens.
// Through a proxy that cuts long requests it must stay below that proxy's limit,
// or every quiet poll ends in a network error and a 3-second retry pause.
export function pollingOptions(timeoutSeconds: number): PollingOptions
{
	return { timeout: timeoutSeconds, allowed_updates: ["message", "callback_query"] };
}
