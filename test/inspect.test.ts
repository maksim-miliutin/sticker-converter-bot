import { describe, expect, it } from "vitest";

import { inspectImage } from "../src/images/inspect.ts";
import { animatedWebp, noisy, pngClaiming, rotatedJpeg, solid, truncated } from "./support/images.ts";

const limits = { maxPixels: 50_000_000 };

describe("inspectImage", () =>
{
	it.each(["png", "jpeg", "webp"] as const)("accepts a %s and reports what it really is", async (format) =>
	{
		const bytes = await solid(300, 200, format);

		expect(await inspectImage(bytes, limits)).toEqual({
			ok: true,
			image: { format, width: 300, height: 200, bytes: bytes.length, hasAlpha: false },
		});
	});

	it("notices transparency, which a sticker has to keep", async () =>
	{
		const inspection = await inspectImage(await solid(64, 64, "png", true), limits);

		expect(inspection).toMatchObject({ ok: true, image: { hasAlpha: true } });
	});

	// Phones store a portrait photo as landscape pixels plus an EXIF note to rotate.
	it("reports the size as the photo is displayed, after its EXIF rotation", async () =>
	{
		const inspection = await inspectImage(await rotatedJpeg(400, 300), limits);

		expect(inspection).toMatchObject({ ok: true, image: { width: 300, height: 400 } });
	});

	it("judges the format by the bytes, so a PNG named photo.jpg is still a PNG", async () =>
	{
		const inspection = await inspectImage(await solid(10, 10, "png"), limits);

		expect(inspection).toMatchObject({ ok: true, image: { format: "png" } });
	});

	it.each([
		["a GIF", () => solid(32, 32, "gif")],
		["a PDF", () => Promise.resolve(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"))],
		["an SVG, which is never handed to the decoder", () => Promise.resolve(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"/>"))],
		["plain text", () => Promise.resolve(Buffer.from("definitely not a picture"))],
		["an empty file", () => Promise.resolve(Buffer.alloc(0))],
	])("refuses %s as an unsupported format", async (_name, make) =>
	{
		expect(await inspectImage(await make(), limits)).toEqual({ ok: false, problem: "unsupported-format" });
	});

	it("refuses an animated WEBP, since stickers here are static", async () =>
	{
		expect(await inspectImage(await animatedWebp(), limits)).toEqual({ ok: false, problem: "animated" });
	});

	// An interrupted download loses the last kilobytes, not half the file. A decoder
	// left to its defaults fills the missing rows with grey and calls it a success.
	it.each([
		["JPEG", "jpeg"],
		["PNG", "png"],
		["WEBP", "webp"],
	] as const)("refuses a %s missing its last tenth as unreadable", async (_name, format) =>
	{
		const bytes = truncated(await noisy(400, 400, format), 0.9);

		expect(await inspectImage(bytes, limits)).toEqual({ ok: false, problem: "corrupted" });
	});

	// 30000 × 30000 decodes to 3.6 GB of pixels from a file of a few hundred bytes.
	it("refuses a decompression bomb from its header, before decoding a single pixel", async () =>
	{
		const started = performance.now();

		expect(await inspectImage(await pngClaiming(30_000, 30_000), limits)).toEqual({ ok: false, problem: "too-many-pixels" });
		expect(performance.now() - started).toBeLessThan(1_000);
	});

	it("accepts an image exactly at the pixel limit and refuses one pixel row more", async () =>
	{
		const atLimit = { maxPixels: 100 * 100 };

		expect(await inspectImage(await solid(100, 100, "png"), atLimit)).toMatchObject({ ok: true });
		expect(await inspectImage(await solid(100, 101, "png"), atLimit)).toEqual({ ok: false, problem: "too-many-pixels" });
	});
});
