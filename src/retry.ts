import { HttpError, type Transformer } from "grammy";

export interface RetryOptions
{
	readonly attempts: number;
	// Waited before the second attempt, twice that before the third, and so on.
	readonly delayMs: number;
}

const unsentCodes = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);
const unsentReason = /reason: (?:Socks[45] proxy rejected connection|connect E(?:CONNREFUSED|HOSTUNREACH|NETUNREACH)|getaddrinfo E(?:NOTFOUND|AI_AGAIN))/;

// True only when the request provably never reached Telegram: the proxy refused
// to connect, nothing answered at the address, or the name did not resolve. A reset
// or a timeout can come after Telegram already acted on the request.
export function neverSent(error: unknown): boolean
{
	if (!(error instanceof HttpError) || !(error.error instanceof Error))
	{
		return false;
	}

	const cause = error.error;
	if ("code" in cause && typeof cause.code === "string" && unsentCodes.has(cause.code))
	{
		return true;
	}

	return unsentReason.test(cause.message);
}

// Sends again only what never left, so a retry cannot post a message twice.
// Everything else reaches the caller untouched on the first failure.
export function retryUnsent(options: RetryOptions): Transformer
{
	return async (prev, method, payload, signal) =>
	{
		for (let attempt = 1; ; attempt++)
		{
			try
			{
				return await prev(method, payload, signal);
			}
			catch (error)
			{
				if (attempt >= options.attempts || signal?.aborted === true || !neverSent(error))
				{
					throw error;
				}

				await new Promise((resolve) => setTimeout(resolve, options.delayMs * attempt));
			}
		}
	};
}
