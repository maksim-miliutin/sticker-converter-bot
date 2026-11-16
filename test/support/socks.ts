import net from "node:net";

export interface SocksConnect
{
	readonly host: string;
	readonly port: number;
	// "domain" means the client left name resolution to the proxy (socks5h).
	readonly addressType: "ipv4" | "domain" | "ipv6";
}

export interface RefusingSocksServer
{
	readonly port: number;
	readonly requests: SocksConnect[];
	close(): Promise<void>;
}

const addressTypes = { 1: "ipv4", 3: "domain", 4: "ipv6" } as const;

function parseConnect(request: Buffer): SocksConnect | undefined
{
	const type = request[3];
	if (request[0] !== 5 || request[1] !== 1 || (type !== 1 && type !== 3 && type !== 4))
	{
		return undefined;
	}

	const start = type === 3 ? 5 : 4;
	const length = type === 1 ? 4 : type === 4 ? 16 : request[4] ?? 0;
	const address = request.subarray(start, start + length);
	const host = type === 3 ? address.toString("latin1") : Array.from(address).join(".");

	return { host, port: request.readUInt16BE(start + length), addressType: addressTypes[type] };
}

// A SOCKS5 server on loopback that records each CONNECT and refuses it. It shows
// where a client meant to go without letting anything leave the machine.
export async function startRefusingSocksServer(): Promise<RefusingSocksServer>
{
	const requests: SocksConnect[] = [];

	const server = net.createServer((socket) =>
	{
		let greeted = false;

		socket.on("data", (chunk) =>
		{
			if (!greeted)
			{
				greeted = true;
				socket.write(Buffer.from([5, 0]));
				return;
			}

			const connect = parseConnect(chunk);
			if (connect !== undefined)
			{
				requests.push(connect);
			}

			// Reply 5: connection refused, with an empty IPv4 bind address.
			socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
		});

		socket.on("error", () => undefined);
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as net.AddressInfo).port;

	return {
		port,
		requests,
		close: () => new Promise<void>((resolve) => server.close(() =>
		{
			resolve();
		})),
	};
}
