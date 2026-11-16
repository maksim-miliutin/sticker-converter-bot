import { HttpError } from "grammy";
import { describe, expect, it } from "vitest";

import { neverSent, retryUnsent } from "../src/retry.ts";

const token = "123456789:AAHfake-token_for-tests-only0123456789";

function networkError(reason: string, code?: string): HttpError
{
	const cause = Object.assign(new Error(`request to https://api.telegram.org/bot${token}/sendMessage failed, reason: ${reason}`), code === undefined ? {} : { code });

	return new HttpError("Network request for 'sendMessage' failed!", cause);
}

const proxyRefused = networkError("Socks5 proxy rejected connection - HostUnreachable");
const resetMidway = networkError("read ECONNRESET", "ECONNRESET");

type Prev = Parameters<ReturnType<typeof retryUnsent>>[0];

function failingTimes(times: number, error: Error): { prev: Prev; calls: () => number }
{
	let calls = 0;
	const prev = (() =>
	{
		calls++;
		return calls <= times ? Promise.reject(error) : Promise.resolve({ ok: true, result: true });
	}) as unknown as Prev;

	return { prev, calls: () => calls };
}

const transform = retryUnsent({ attempts: 3, delayMs: 0 });

describe("neverSent", () =>
{
	it.each([
		["a SOCKS proxy refusing the connection", proxyRefused, true],
		["nothing listening at the proxy port", networkError("connect ECONNREFUSED 127.0.0.1:40000"), true],
		["a name that does not resolve", networkError("getaddrinfo ENOTFOUND api.telegram.org", "ENOTFOUND"), true],
		["a connection reset after the request went out", resetMidway, false],
		["a timeout, after which Telegram may have acted", networkError("network timeout at: …", "ETIMEDOUT"), false],
		["an error that is not about the network at all", new Error("boom"), false],
	])("%s → %s", (_name, error, expected) =>
	{
		expect(neverSent(error)).toBe(expected);
	});
});

describe("retryUnsent", () =>
{
	// WARP drops a request now and then with HostUnreachable; the request never
	// reached Telegram, so sending it again cannot post anything twice.
	it("sends again a request the proxy refused, and returns the answer that follows", async () =>
	{
		const { prev, calls } = failingTimes(1, proxyRefused);

		await expect(transform(prev, "sendMessage", {} as never, undefined)).resolves.toEqual({ ok: true, result: true });
		expect(calls()).toBe(2);
	});

	it("does not resend a request that may already have reached Telegram", async () =>
	{
		const { prev, calls } = failingTimes(1, resetMidway);

		await expect(transform(prev, "sendMessage", {} as never, undefined)).rejects.toBe(resetMidway);
		expect(calls()).toBe(1);
	});

	it("gives up after the configured number of attempts", async () =>
	{
		const { prev, calls } = failingTimes(10, proxyRefused);

		await expect(transform(prev, "sendMessage", {} as never, undefined)).rejects.toBe(proxyRefused);
		expect(calls()).toBe(3);
	});
});
