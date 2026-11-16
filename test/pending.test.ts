import { describe, expect, it } from "vitest";

import { Pending, type PendingImage } from "../src/bot/pending.ts";

const anna = 1001;
const boris = 2002;

function image(owner: number, fileId = "file-a"): PendingImage
{
	return { owner, fileId, fromPhoto: false };
}

function store(options: { maxEntries?: number } = {}): { pending: Pending<PendingImage>; advance: (ms: number) => void }
{
	let now = 0;
	const pending = new Pending<PendingImage>({ ttlMs: 15 * 60_000, maxEntries: options.maxEntries ?? 100, now: () => now });

	return { pending, advance: (ms) => (now += ms) };
}

describe("Pending", () =>
{
	it("hands an image back to its owner once", () =>
	{
		const { pending } = store();
		const token = pending.add(image(anna));

		expect(pending.take(token, anna)).toEqual(image(anna));
		expect(pending.take(token, anna)).toBeUndefined();
	});

	// Callback data comes from the client; a token is no proof of who may use it.
	it("refuses someone else's token and keeps the image for its owner", () =>
	{
		const { pending } = store();
		const token = pending.add(image(anna));

		expect(pending.take(token, boris)).toBeUndefined();
		expect(pending.take(token, anna)).toEqual(image(anna));
	});

	it("forgets an image after 15 minutes", () =>
	{
		const { pending, advance } = store();
		const token = pending.add(image(anna));

		advance(15 * 60_000);

		expect(pending.take(token, anna)).toBeUndefined();
	});

	it("still has the image one millisecond before it expires", () =>
	{
		const { pending, advance } = store();
		const token = pending.add(image(anna));

		advance(15 * 60_000 - 1);

		expect(pending.take(token, anna)).toEqual(image(anna));
	});

	it("drops only the owner's images on cancel and says whether there were any", () =>
	{
		const { pending } = store();
		const annas = pending.add(image(anna));
		const boriss = pending.add(image(boris));

		expect(pending.clear(anna)).toBe(true);
		expect(pending.clear(anna)).toBe(false);
		expect(pending.take(annas, anna)).toBeUndefined();
		expect(pending.take(boriss, boris)).toEqual(image(boris));
	});

	// Someone sending pictures in a loop must not grow the bot's memory without end.
	it("keeps at most maxEntries images, dropping the oldest first", () =>
	{
		const { pending } = store({ maxEntries: 2 });
		const first = pending.add(image(anna, "first"));
		const second = pending.add(image(anna, "second"));
		const third = pending.add(image(anna, "third"));

		expect(pending.take(first, anna)).toBeUndefined();
		expect(pending.take(second, anna)).toMatchObject({ fileId: "second" });
		expect(pending.take(third, anna)).toMatchObject({ fileId: "third" });
	});

	// The token travels in callback data, which Telegram caps at 64 bytes.
	it("issues short, unguessable, distinct tokens", () =>
	{
		const { pending } = store();
		const tokens = new Set(Array.from({ length: 50 }, () => pending.add(image(anna))));

		expect(tokens.size).toBe(50);
		for (const token of tokens)
		{
			expect(token).toMatch(/^[A-Za-z0-9_-]{16}$/);
		}
	});
});
