import { randomBytes } from "node:crypto";

export interface Owned
{
	readonly owner: number;
}

export interface PendingImage extends Owned
{
	readonly fileId: string;
	readonly fromPhoto: boolean;
}

export interface PendingOptions
{
	readonly ttlMs: number;
	readonly maxEntries: number;
	readonly now?: () => number;
}

interface Entry<T>
{
	readonly item: T;
	readonly expiresAt: number;
}

// Things waiting for the user's next press: an image waiting for an action, a
// sticker waiting for its pack. The callback button carries only a random token;
// the data and the owner stay here, because callback data is capped at 64 bytes
// and comes back untrusted.
//
// Kept in memory on purpose until the database arrives: a restart forgets every
// waiting image, and its buttons then answer as stale, which is safe.
export class Pending<T extends Owned>
{
	private readonly entries = new Map<string, Entry<T>>();
	private readonly ttlMs: number;
	private readonly maxEntries: number;
	private readonly now: () => number;

	constructor(options: PendingOptions)
	{
		this.ttlMs = options.ttlMs;
		this.maxEntries = options.maxEntries;
		this.now = options.now ?? Date.now;
	}

	add(item: T): string
	{
		const token = randomBytes(12).toString("base64url");
		this.entries.set(token, { item, expiresAt: this.now() + this.ttlMs });

		// A Map iterates in insertion order, so the first key is the oldest.
		for (const oldest of this.entries.keys())
		{
			if (this.entries.size <= this.maxEntries)
			{
				break;
			}

			this.entries.delete(oldest);
		}

		return token;
	}

	// Single use: a repeated press or a redelivered update finds nothing. A token
	// of someone else's item leaves that item waiting for its owner.
	take(token: string, userId: number): T | undefined
	{
		const entry = this.entries.get(token);
		if (entry === undefined || entry.item.owner !== userId)
		{
			return undefined;
		}

		this.entries.delete(token);

		return entry.expiresAt > this.now() ? entry.item : undefined;
	}

	clear(userId: number): boolean
	{
		let cleared = false;
		for (const [token, entry] of this.entries)
		{
			if (entry.item.owner === userId)
			{
				this.entries.delete(token);
				cleared = true;
			}
		}

		return cleared;
	}
}
