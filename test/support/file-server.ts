import http from "node:http";
import type { AddressInfo } from "node:net";

export interface FileServer
{
	readonly root: string;
	readonly requests: string[];
	// True when the client hung up before the server finished sending.
	readonly abandoned: () => boolean;
	close(): Promise<void>;
}

export type Respond = (response: http.ServerResponse) => void;

// Stands in for https://api.telegram.org/file/... on loopback: records each path
// and answers with whatever the test tells it to.
export async function startFileServer(respond: Respond): Promise<FileServer>
{
	const requests: string[] = [];
	let abandoned = false;

	const server = http.createServer((request, response) =>
	{
		requests.push(request.url ?? "");
		response.on("close", () =>
		{
			if (!response.writableFinished)
			{
				abandoned = true;
			}
		});
		respond(response);
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;

	return {
		root: `http://127.0.0.1:${String(port)}`,
		requests,
		abandoned: () => abandoned,
		close: () => new Promise<void>((resolve) =>
		{
			server.closeAllConnections();
			server.close(() =>
			{
				resolve();
			});
		}),
	};
}

// Sends size bytes in 64 KB chunks, giving the client a chance to hang up between them.
export function streamBytes(size: number): Respond
{
	return (response) =>
	{
		response.writeHead(200, { "content-type": "application/octet-stream" });
		let sent = 0;

		const next = (): void =>
		{
			if (sent >= size || response.destroyed)
			{
				response.end();
				return;
			}

			const chunk = Buffer.alloc(Math.min(64 * 1024, size - sent), 7);
			sent += chunk.length;
			response.write(chunk, () => setImmediate(next));
		};

		next();
	};
}
