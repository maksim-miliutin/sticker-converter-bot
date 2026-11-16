import type { ApiClientOptions } from "grammy";
import { SocksProxyAgent } from "socks-proxy-agent";

// grammY on Node sends requests through node-fetch, which ignores HTTPS_PROXY and
// the Windows system proxy; an agent in baseFetchConfig is the only way to reroute
// it. grammY merges this over its defaults, so compression stays on, while its
// keep-alive agent is replaced: every request opens a fresh proxy connection, which
// suits proxies that cut long-lived connections, such as Cloudflare WARP.
export function telegramClientOptions(proxyUrl: string | undefined): ApiClientOptions
{
	if (proxyUrl === undefined)
	{
		return {};
	}

	return { baseFetchConfig: { agent: new SocksProxyAgent(proxyUrl) } };
}

export function proxyLabel(proxyUrl: string | undefined): string
{
	const url = proxyUrl === undefined ? null : URL.parse(proxyUrl);
	if (url === null)
	{
		return "direct";
	}

	return `${url.protocol}//${url.host}`;
}
