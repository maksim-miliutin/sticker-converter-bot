import sharp, { type Metadata } from "sharp";

export type ImageFormat = "jpeg" | "png" | "webp";

export interface ImageInfo
{
	readonly format: ImageFormat;
	// As displayed, after EXIF rotation.
	readonly width: number;
	readonly height: number;
	readonly bytes: number;
	readonly hasAlpha: boolean;
}

export type ImageProblem = "unsupported-format" | "animated" | "too-many-pixels" | "corrupted";

export type Inspection =
	| { readonly ok: true; readonly image: ImageInfo }
	| { readonly ok: false; readonly problem: ImageProblem };

export interface ImageLimits
{
	readonly maxPixels: number;
}

function startsWith(bytes: Uint8Array, offset: number, expected: readonly number[] | string): boolean
{
	const values = typeof expected === "string" ? Array.from(expected, (char) => char.charCodeAt(0)) : expected;

	return values.every((value, index) => bytes[offset + index] === value);
}

// The decoder only ever sees these three formats. sharp can also read SVG, TIFF,
// GIF and HEIF, and each of those parsers is attack surface this bot has no use for.
function signatureOf(bytes: Uint8Array): ImageFormat | undefined
{
	if (startsWith(bytes, 0, [0xff, 0xd8, 0xff]))
	{
		return "jpeg";
	}

	if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
	{
		return "png";
	}

	if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP"))
	{
		return "webp";
	}

	return undefined;
}

const failure = (problem: ImageProblem): Inspection => ({ ok: false, problem });

// Checks an untrusted upload in order of cost: signature, then the header, where
// the pixel count is known before anything is decoded, then a full decode at a
// reduced size, which is what catches a file cut off halfway.
export async function inspectImage(bytes: Uint8Array, limits: ImageLimits): Promise<Inspection>
{
	const format = signatureOf(bytes);
	if (format === undefined)
	{
		return failure("unsupported-format");
	}

	// Reading the header decodes no pixels, so sharp's own pixel limit is lifted
	// here: otherwise a huge image would be reported as corrupted, not as too large.
	let metadata: Metadata;
	try
	{
		metadata = await sharp(bytes, { pages: -1, limitInputPixels: false }).metadata();
	}
	catch
	{
		return failure("corrupted");
	}

	if (metadata.format !== format)
	{
		return failure("corrupted");
	}

	if ((metadata.pages ?? 1) > 1)
	{
		return failure("animated");
	}

	if (metadata.width * metadata.height > limits.maxPixels)
	{
		return failure("too-many-pixels");
	}

	try
	{
		await sharp(bytes, { failOn: "truncated", limitInputPixels: limits.maxPixels })
			.resize(64, 64, { fit: "inside" })
			.raw()
			.toBuffer();
	}
	catch
	{
		return failure("corrupted");
	}

	return {
		ok: true,
		image: {
			format,
			width: metadata.autoOrient.width,
			height: metadata.autoOrient.height,
			bytes: bytes.length,
			hasAlpha: metadata.hasAlpha,
		},
	};
}
