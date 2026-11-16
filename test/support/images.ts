import zlib from "node:zlib";

import sharp from "sharp";

// Fixtures are drawn at test time, so the repository holds no binary images and
// every case says in code what makes it special.

export async function solid(width: number, height: number, format: "png" | "jpeg" | "webp" | "gif", alpha = false): Promise<Buffer>
{
	const background = alpha ? { r: 200, g: 40, b: 40, alpha: 0.5 } : { r: 200, g: 40, b: 40 };
	const image = sharp({ create: { width, height, channels: alpha ? 4 : 3, background } });

	return image.toFormat(format).toBuffer();
}

// Photo-like content: noise compresses badly, so most of the file is pixel data
// and cutting its tail damages pixels, not headers.
export async function noisy(width: number, height: number, format: "png" | "jpeg" | "webp"): Promise<Buffer>
{
	const pixels = Buffer.alloc(width * height * 3);
	for (let index = 0; index < pixels.length; index++)
	{
		pixels[index] = Math.imul(index, 2654435761) >>> 24;
	}

	return sharp(pixels, { raw: { width, height, channels: 3 } }).toFormat(format).toBuffer();
}

// A JPEG whose EXIF says "rotate 90° clockwise to display", as phones write it.
export async function rotatedJpeg(width: number, height: number): Promise<Buffer>
{
	const image = sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } });

	return image.jpeg().withMetadata({ orientation: 6 }).toBuffer();
}

export async function animatedWebp(): Promise<Buffer>
{
	const frames = await Promise.all([solid(64, 64, "png"), solid(64, 64, "png", true)]);

	return sharp(frames, { join: { animated: true } }).webp().toBuffer();
}

// A real PNG whose header claims width × height. Decoding it would need
// width × height × 4 bytes; the point is to refuse it from the header alone.
export async function pngClaiming(width: number, height: number): Promise<Buffer>
{
	const png = Buffer.from(await solid(16, 16, "png"));

	// Signature (8) + IHDR length (4) + "IHDR" (4), then width and height.
	png.writeUInt32BE(width, 16);
	png.writeUInt32BE(height, 20);
	png.writeUInt32BE(zlib.crc32(png.subarray(12, 29)), 29);

	return png;
}

export function truncated(bytes: Buffer, keep = 0.5): Buffer
{
	return bytes.subarray(0, Math.floor(bytes.length * keep));
}
