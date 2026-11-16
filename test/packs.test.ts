import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { packName } from "../src/bot/pack-name.ts";
import { PackStore } from "../src/store/packs.ts";

const anna = 1001;
const boris = 2002;
let directory: string | undefined;

afterEach(() =>
{
	if (directory !== undefined)
	{
		rmSync(directory, { recursive: true, force: true });
		directory = undefined;
	}
});

describe("PackStore", () =>
{
	it("lists only the owner's packs, oldest first", () =>
	{
		const store = new PackStore(":memory:");
		store.add(anna, "first_by_bot", "Первый");
		store.add(boris, "other_by_bot", "Чужой");
		store.add(anna, "second_by_bot", "Второй");

		expect(store.list(anna).map((pack) => pack.title)).toEqual(["Первый", "Второй"]);
	});

	// Callback data names a pack by id; the id alone must not open someone else's.
	it("finds a pack by id only for its owner", () =>
	{
		const store = new PackStore(":memory:");
		const pack = store.add(anna, "first_by_bot", "Первый");

		expect(store.find(pack.id, anna)).toEqual(pack);
		expect(store.find(pack.id, boris)).toBeUndefined();
	});

	it("forgets every pack of one owner and nobody else's", () =>
	{
		const store = new PackStore(":memory:");
		store.add(anna, "a1_by_bot", "1");
		store.add(anna, "a2_by_bot", "2");
		store.add(boris, "b1_by_bot", "3");

		expect(store.removeOwner(anna)).toBe(2);
		expect(store.list(anna)).toEqual([]);
		expect(store.list(boris)).toHaveLength(1);
	});

	it("keeps packs across a restart", () =>
	{
		directory = mkdtempSync(join(tmpdir(), "packs-"));
		const path = join(directory, "nested", "bot.sqlite");
		const first = new PackStore(path);
		first.add(anna, "kept_by_bot", "Сохранён");
		first.close();

		const second = new PackStore(path);

		expect(second.list(anna).map((pack) => pack.name)).toEqual(["kept_by_bot"]);
		second.close();
	});
});

describe("packName", () =>
{
	// Telegram: letters, digits and underscores, starting with a letter, no double
	// underscores, ending in _by_<bot username>, at most 64 characters.
	it("follows Telegram's rules for a short name", () =>
	{
		const name = packName("sticker_test_bot");

		expect(name).toMatch(/^s[a-z0-9]{7}_by_sticker_test_bot$/);
		expect(name.length).toBeLessThanOrEqual(64);
		expect(name).not.toContain("__");
	});

	it("draws a different name each time", () =>
	{
		const names = new Set(Array.from({ length: 100 }, () => packName("bot")));

		expect(names.size).toBe(100);
	});
});
