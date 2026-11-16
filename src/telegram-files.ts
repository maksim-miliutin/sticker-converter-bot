import http, { type Agent } from "node:http";
import https from "node:https";

import { GrammyError, HttpError, type Api } from "grammy";

import { networkReason } from "./outages.ts";

export type Download =
	| { readonly ok: true; readonly bytes: Buffer }
	| { readonly ok: false; readonly problem: "too-large" }
	| { readonly ok: false; readonly problem: "unavailable"; readonly reason: string };

export interface DownloadOptions
{
	readonly token: string;
	readonly maxBytes: number;
	// The agent grammY uses, so files come through the same proxy as API calls.
	readonly agent?: Agent;
	readonly apiRoot?: string;
	// Longest silence allowed between two chunks.
	readonly idleTimeoutMs?: number;
}

class DownloadError extends Error
{
}

const tooLarge: Download = { ok: false, problem: "too-large" };

const unavailable = (reason: string): Download => ({ ok: false, problem: "unavailable", reason });

// Never the message of an arbitrary error: the file URL, token included, can
// appear in it. Telegram's own description, a system code or our own wording only.
function reasonOf(error: unknown): string
{
	if (error instanceof GrammyError)
	{
		return error.description;
	}

	if (error instanceof HttpError)
	{
		return networkReason(error);
	}

	if (error instanceof DownloadError)
	{
		return error.message;
	}

	if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string")
	{
		return error.code;
	}

	return "network error";
}

// Telegram stores the file and getFile names its path. The bytes are fetched
// with a cap counted as they arrive: file_size is optional and nothing makes it
// honest, so a stream past maxBytes is cut off rather than trusted.
export async function downloadFile(api: Pick<Api, "getFile">, fileId: string, options: DownloadOptions): Promise<Download>
{
	let path: string | undefined;
	try
	{
		const file = await api.getFile(fileId);
		if (file.file_size !== undefined && file.file_size > options.maxBytes)
		{
			return tooLarge;
		}

		path = file.file_path;
	}
	catch (error)
	{
		// The cloud Bot API refuses getFile above 20 MB with this description.
		if (error instanceof GrammyError && error.description.includes("file is too big"))
		{
			return tooLarge;
		}

		return unavailable(reasonOf(error));
	}

	if (path === undefined)
	{
		return unavailable("no file path");
	}

	const url = new URL(`${options.apiRoot ?? "https://api.telegram.org"}/file/bot${options.token}/${path}`);
	try
	{
		return await fetchCapped(url, options);
	}
	catch (error)
	{
		return unavailable(reasonOf(error));
	}
}

function fetchCapped(url: URL, options: DownloadOptions): Promise<Download>
{
	return new Promise((resolve, reject) =>
	{
		const get = url.protocol === "http:" ? http.get : https.get;
		const request = get(url, {
			...(options.agent !== undefined && { agent: options.agent }),
			timeout: options.idleTimeoutMs ?? 30_000,
		}, (response) =>
		{
			if (response.statusCode !== 200)
			{
				response.resume();
				reject(new DownloadError(`HTTP ${String(response.statusCode)}`));
				return;
			}

			const chunks: Buffer[] = [];
			let received = 0;

			response.on("data", (chunk: Buffer) =>
			{
				received += chunk.length;
				if (received > options.maxBytes)
				{
					request.destroy();
					resolve(tooLarge);
					return;
				}

				chunks.push(chunk);
			});
			response.on("end", () =>
			{
				resolve({ ok: true, bytes: Buffer.concat(chunks) });
			});
			response.on("error", reject);
		});

		request.on("timeout", () => request.destroy(new DownloadError("timeout")));
		request.on("error", reject);
	});
}
