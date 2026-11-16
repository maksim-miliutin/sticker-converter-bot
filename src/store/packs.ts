import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface StickerPack
{
	readonly id: number;
	readonly owner: number;
	readonly name: string;
	readonly title: string;
}

function toPack(row: Record<string, unknown>): StickerPack
{
	return { id: Number(row.id), owner: Number(row.owner), name: String(row.name), title: String(row.title) };
}

// Sticker sets this bot created, by owner. Telegram holds the sets themselves; this
// is only the list behind /packs and the check that a pack belongs to the user.
export class PackStore
{
	private readonly db: DatabaseSync;

	constructor(path: string)
	{
		if (path !== ":memory:")
		{
			mkdirSync(dirname(path), { recursive: true });
		}

		this.db = new DatabaseSync(path);
		this.db.exec(`
			create table if not exists packs (
				id integer primary key,
				owner integer not null,
				name text not null unique,
				title text not null,
				created_at integer not null
			);
			create index if not exists packs_owner on packs (owner);
		`);
	}

	list(owner: number): StickerPack[]
	{
		return this.db.prepare("select id, owner, name, title from packs where owner = ? order by id").all(owner).map(toPack);
	}

	find(id: number, owner: number): StickerPack | undefined
	{
		const row = this.db.prepare("select id, owner, name, title from packs where id = ? and owner = ?").get(id, owner);

		return row === undefined ? undefined : toPack(row);
	}

	add(owner: number, name: string, title: string): StickerPack
	{
		const result = this.db.prepare("insert into packs (owner, name, title, created_at) values (?, ?, ?, ?)").run(owner, name, title, Date.now());

		return { id: Number(result.lastInsertRowid), owner, name, title };
	}

	remove(id: number): void
	{
		this.db.prepare("delete from packs where id = ?").run(id);
	}

	removeOwner(owner: number): number
	{
		return Number(this.db.prepare("delete from packs where owner = ?").run(owner).changes);
	}

	close(): void
	{
		this.db.close();
	}
}
