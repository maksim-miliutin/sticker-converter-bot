import sharp, { type Metadata } from "sharp";
import { describe, expect, it } from "vitest";

import { makeSticker, maxStickerBytes } from "../src/images/sticker.ts";
import { noisy, rotatedJpeg, solid } from "./support/images.ts";

const maxPixels = 50_000_000;

async function made(bytes: Buffer): Promise<{ width: number; height: number; size: number; meta: Metadata }>
{
	const sticker = await makeSticker(bytes, maxPixels);
	if (sticker === undefined)
	{
		throw new Error("expected a sticker");
	}

	return { width: sticker.width, height: sticker.height, size: sticker.bytes.length, meta: await sharp(sticker.bytes).metadata() };
}

describe("makeSticker", () =>
{
	it("scales a 4000×3000 photo so the long side is exactly 512 and keeps its proportions", async () =>
	{
		const sticker = await made(await solid(4000, 3000, "jpeg"));

		expect(sticker).toMatchObject({ width: 512, height: 384 });
		expect(sticker.meta).toMatchObject({ format: "webp", width: 512, height: 384 });
	});

	it("does the same for a portrait image", async () =>
	{
		expect(await made(await solid(3000, 4000, "png"))).toMatchObject({ width: 384, height: 512 });
	});

	// Telegram wants one side of exactly 512 px, so a small picture is enlarged.
	it("enlarges a small image until its long side is 512", async () =>
	{
		expect(await made(await solid(100, 50, "png"))).toMatchObject({ width: 512, height: 256 });
	});

	it("keeps transparency", async () =>
	{
		const sticker = await made(await solid(64, 64, "png", true));

		expect(sticker.meta.hasAlpha).toBe(true);
	});

	// A 400×300 JPEG with "rotate 90°" in EXIF is a 300×400 portrait. Applying the
	// rotation twice would turn it back into a landscape.
	it("applies the EXIF rotation exactly once", async () =>
	{
		const sticker = await made(await rotatedJpeg(400, 300));

		expect(sticker).toMatchObject({ width: 384, height: 512 });
		expect(sticker.meta.orientation).toBeUndefined();
	});

	it("carries no EXIF or other metadata from the original", async () =>
	{
		const sticker = await made(await rotatedJpeg(400, 300));

		expect(sticker.meta.exif).toBeUndefined();
		expect(sticker.meta.icc).toBeUndefined();
	});

	// Noise is the worst case for compression.
	it("fits even a noisy photo into Telegram's 512 KB", async () =>
	{
		const sticker = await made(await noisy(2000, 2000, "png"));

		expect(sticker.size).toBeLessThanOrEqual(maxStickerBytes);
	});
});
