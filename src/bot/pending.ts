import { randomBytes } from "node:crypto";

export interface PendingImage
{
	readonly owner: number;
	readonly fileId: string;
	readonly fromPhoto: boolean;
}

export interface PendingOptions
{
	readonly ttlMs: number;
	readonly maxEntries: number;
	readonly now?: () => number;
}

interface Entry
{
	readonly image: PendingImage;
	readonly expiresAt: number;
}

// Images sent to the bot and still waiting for the user to pick an action. The
// callback button carries only a random token; the file id and the owner stay
// here, because callback data is capped at 64 bytes and comes back untrusted.
//
// Kept in memory on purpose until the database arrives: a restart forgets every
// waiting image, and its buttons then answer as stale, which is safe.
export class PendingImages
{
	private readonly entries = new Map<string, Entry>();
	private readonly ttlMs: number;
	private readonly maxEntries: number;
	private readonly now: () => number;

	constructor(options: PendingOptions)
	{
		this.ttlMs = options.ttlMs;
		this.maxEntries = options.maxEntries;
		this.now = options.now ?? Date.now;
	}

	add(image: PendingImage): string
	{
		const token = randomBytes(12).toString("base64url");
		this.entries.set(token, { image, expiresAt: this.now() + this.ttlMs });

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
	// of someone else's image leaves that image waiting for its owner.
	take(token: string, userId: number): PendingImage | undefined
	{
		const entry = this.entries.get(token);
		if (entry === undefined || entry.image.owner !== userId)
		{
			return undefined;
		}

		this.entries.delete(token);

		return entry.expiresAt > this.now() ? entry.image : undefined;
	}

	clear(userId: number): boolean
	{
		let cleared = false;
		for (const [token, entry] of this.entries)
		{
			if (entry.image.owner === userId)
			{
				this.entries.delete(token);
				cleared = true;
			}
		}

		return cleared;
	}
}
