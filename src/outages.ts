import { HttpError, type Transformer } from "grammy";

import type { Logger } from "./logger.ts";

// grammY retries a failed getMe at startup and a failed getUpdates every three
// seconds, and reports either only under DEBUG=grammy*. Without this a dropped
// proxy or network looks like a bot that silently stopped answering.
//
// The first failure is a warning, repeats are debug lines so an outage does not
// flood the log, and the first success after it says the connection is back.
// Failures are rethrown untouched: retrying stays grammY's job.
export function reportOutages(logger: Logger): Transformer
{
	let failing = false;

	return async (prev, method, payload, signal) =>
	{
		try
		{
			const response = await prev(method, payload, signal);
			if (failing)
			{
				failing = false;
				logger.info({ method }, "telegram is reachable again");
			}

			return response;
		}
		catch (error)
		{
			// bot.stop() aborts the pending getUpdates: the bot is leaving, the network is fine.
			if (signal?.aborted !== true)
			{
				const reason = networkReason(error);
				if (failing)
				{
					logger.debug({ method, reason }, "telegram is still unreachable");
				}
				else
				{
					failing = true;
					logger.warn({ method, reason }, "telegram is unreachable, retrying");
				}
			}

			throw error;
		}
	};
}

// node-fetch words its error "request to <url> failed, reason: <cause>", and the URL
// carries the token, so the message is never logged whole. The system code comes
// first (ECONNRESET, ETIMEDOUT, ECONNREFUSED); without one, the text after
// "reason: " says what happened, for example a SOCKS proxy refusing the connection.
export function networkReason(error: unknown): string
{
	const cause = error instanceof HttpError ? error.error : error;
	if (typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string")
	{
		return cause.code;
	}

	if (!(cause instanceof Error))
	{
		return "unknown";
	}

	const marker = "reason: ";
	const at = cause.message.indexOf(marker);

	return at === -1 ? cause.name : cause.message.slice(at + marker.length);
}
