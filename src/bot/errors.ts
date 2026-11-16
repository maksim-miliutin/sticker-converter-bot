import { GrammyError, HttpError, type BotError } from "grammy";

import type { Logger } from "../logger.ts";
import { networkReason } from "../outages.ts";
import { texts } from "../texts.ts";

// ignore: expected noise, a debug line at most;
// log: worth a warning, but writing to the user is pointless or impossible;
// notify: an error in the log and a short apology to the user.
export type ErrorReaction = "ignore" | "log" | "notify";

// Telegram answers 400 for these, yet nothing is wrong: the screen a button asks
// for is already shown, or a button was pressed while the bot was down.
const harmless = ["message is not modified", "query is too old"];

export function reactionTo(error: unknown): ErrorReaction
{
	// The network that just failed would carry the apology too.
	if (error instanceof HttpError)
	{
		return "log";
	}

	if (!(error instanceof GrammyError))
	{
		return "notify";
	}

	if (error.error_code === 400 && harmless.some((text) => error.description.includes(text)))
	{
		return "ignore";
	}

	// 403: the user blocked the bot or left Telegram; 429: another message now only
	// lengthens the wait Telegram asked for.
	if (error.error_code === 403 || error.error_code === 429)
	{
		return "log";
	}

	return "notify";
}

// A failed request carries its whole payload, chat id and text included, and the
// network error's message carries the URL with the token. Only what identifies the
// failure is kept; a bug stays an Error so pino records its stack.
export function describeError(error: unknown): Record<string, unknown>
{
	if (error instanceof GrammyError)
	{
		return {
			method: error.method,
			code: error.error_code,
			description: error.description,
			...(error.parameters.retry_after !== undefined && { retryAfter: error.parameters.retry_after }),
		};
	}

	if (error instanceof HttpError)
	{
		return { reason: networkReason(error) };
	}

	return error instanceof Error ? { err: error } : { value: String(error) };
}

export async function handleBotError(error: BotError, logger: Logger): Promise<void>
{
	const updateId = error.ctx.update.update_id;
	const details = { updateId, ...describeError(error.error) };
	const reaction = reactionTo(error.error);

	switch (reaction)
	{
		case "ignore":
			logger.debug(details, "update error ignored");
			return;

		case "log":
			logger.warn(details, "update failed");
			return;

		case "notify":
			logger.error(details, "update failed");
			break;
	}

	if (error.ctx.chat === undefined)
	{
		return;
	}

	try
	{
		await error.ctx.reply(texts.failed);
	}
	catch (replyError)
	{
		logger.warn({ updateId, ...describeError(replyError) }, "could not tell the user about the failure");
	}
}
