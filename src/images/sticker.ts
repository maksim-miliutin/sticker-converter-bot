import sharp from "sharp";

export const stickerSide = 512;
export const maxStickerBytes = 512 * 1024;

export interface Sticker
{
	readonly bytes: Buffer;
	readonly width: number;
	readonly height: number;
}

// WEBP at quality 90. Measured worst case, pure noise at 512 × 512, comes to about
// 190 KB, so a ladder of falling qualities would never get past its first step; the
// size check stays as a guard of Telegram's limit should the format or side change.
const quality = 90;

// A static Telegram sticker: WEBP, one side exactly 512 px, the other at most 512,
// at most 512 KB. The image is rotated by its EXIF once and decoded to raw pixels,
// so no metadata of the original reaches the sticker. Undefined when it cannot fit.
export async function makeSticker(bytes: Uint8Array, maxPixels: number): Promise<Sticker | undefined>
{
	const { data, info } = await sharp(bytes, { failOn: "truncated", limitInputPixels: maxPixels })
		.autoOrient()
		.resize(stickerSide, stickerSide, { fit: "inside" })
		.raw()
		.toBuffer({ resolveWithObject: true });

	const raw = { width: info.width, height: info.height, channels: info.channels };
	const encoded = await sharp(data, { raw }).webp({ quality, alphaQuality: 100 }).toBuffer();

	return encoded.length <= maxStickerBytes ? { bytes: encoded, width: info.width, height: info.height } : undefined;
}
