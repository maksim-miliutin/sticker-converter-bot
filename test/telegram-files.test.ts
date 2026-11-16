import { GrammyError, type Api } from "grammy";
import type { File } from "grammy/types";
import { SocksProxyAgent } from "socks-proxy-agent";
import { afterEach, describe, expect, it } from "vitest";

import { downloadFile } from "../src/telegram-files.ts";
import { startFileServer, streamBytes, type FileServer } from "./support/file-server.ts";
import { startRefusingSocksServer, type RefusingSocksServer } from "./support/socks.ts";

const token = "123456789:AAHfake-token_for-tests-only0123456789";
const maxBytes = 200 * 1024;

let server: FileServer | undefined;
let proxy: RefusingSocksServer | undefined;

afterEach(async () =>
{
	await server?.close();
	await proxy?.close();
	server = undefined;
	proxy = undefined;
});

function apiReturning(file: Partial<File>): Pick<Api, "getFile">
{
	return { getFile: () => Promise.resolve({ file_id: "id", file_unique_id: "uid", ...file }) };
}

function apiFailing(error: Error): Pick<Api, "getFile">
{
	return { getFile: () => Promise.reject(error) };
}

describe("downloadFile", () =>
{
	it("downloads the file Telegram names and returns its bytes", async () =>
	{
		const content = Buffer.from("pretend this is a jpeg");
		server = await startFileServer((response) => response.end(content));

		const result = await downloadFile(apiReturning({ file_path: "photos/file_1.jpg", file_size: content.length }), "id", {
			token,
			maxBytes,
			apiRoot: server.root,
		});

		expect(result).toEqual({ ok: true, bytes: content });
		expect(server.requests).toEqual([`/file/bot${token}/photos/file_1.jpg`]);
	});

	it("refuses a file Telegram reports as over the limit without downloading it", async () =>
	{
		server = await startFileServer(streamBytes(maxBytes + 1));

		const result = await downloadFile(apiReturning({ file_path: "documents/big.png", file_size: maxBytes + 1 }), "id", {
			token,
			maxBytes,
			apiRoot: server.root,
		});

		expect(result).toEqual({ ok: false, problem: "too-large" });
		expect(server.requests).toEqual([]);
	});

	// file_size is optional in the Bot API and nothing makes it honest; only the
	// bytes actually received count.
	it("stops downloading as soon as the bytes exceed the limit, whatever Telegram said", async () =>
	{
		server = await startFileServer(streamBytes(maxBytes * 20));

		const result = await downloadFile(apiReturning({ file_path: "documents/liar.png", file_size: 10 }), "id", {
			token,
			maxBytes,
			apiRoot: server.root,
		});

		expect(result).toEqual({ ok: false, problem: "too-large" });
		await expect.poll(() => server?.abandoned()).toBe(true);
	});

	it("treats Telegram's own 'file is too big' as too large", async () =>
	{
		const error = new GrammyError("Call to 'getFile' failed!", { ok: false, error_code: 400, description: "Bad Request: file is too big" }, "getFile", {});

		expect(await downloadFile(apiFailing(error), "id", { token, maxBytes })).toEqual({ ok: false, problem: "too-large" });
	});

	// The file URL is https://api.telegram.org/file/bot<token>/<path>.
	it("reports a file that cannot be fetched without ever mentioning its URL", async () =>
	{
		server = await startFileServer((response) =>
		{
			response.writeHead(404).end();
		});

		const result = await downloadFile(apiReturning({ file_path: "photos/gone.jpg" }), "id", { token, maxBytes, apiRoot: server.root });

		expect(result).toEqual({ ok: false, problem: "unavailable", reason: "HTTP 404" });
		expect(JSON.stringify(result)).not.toContain(token);
	});

	it("gives up on a download that stalls", async () =>
	{
		server = await startFileServer((response) =>
		{
			response.writeHead(200);
			response.write("first bytes, then silence");
		});

		const result = await downloadFile(apiReturning({ file_path: "photos/slow.jpg" }), "id", {
			token,
			maxBytes,
			apiRoot: server.root,
			idleTimeoutMs: 200,
		});

		expect(result).toEqual({ ok: false, problem: "unavailable", reason: "timeout" });
	});

	it("downloads through the same proxy as the Bot API, letting it resolve api.telegram.org", async () =>
	{
		proxy = await startRefusingSocksServer();
		const agent = new SocksProxyAgent(`socks5h://127.0.0.1:${String(proxy.port)}`);

		const result = await downloadFile(apiReturning({ file_path: "photos/file_2.jpg" }), "id", { token, maxBytes, agent });

		expect(result).toMatchObject({ ok: false, problem: "unavailable" });
		expect(proxy.requests).toEqual([{ host: "api.telegram.org", port: 443, addressType: "domain" }]);
	});

	it("reports a file Telegram cannot find by its id as unavailable", async () =>
	{
		const error = new GrammyError("Call to 'getFile' failed!", { ok: false, error_code: 400, description: "Bad Request: invalid file_id" }, "getFile", {});

		expect(await downloadFile(apiFailing(error), "id", { token, maxBytes })).toEqual({
			ok: false,
			problem: "unavailable",
			reason: "Bad Request: invalid file_id",
		});
	});
});
