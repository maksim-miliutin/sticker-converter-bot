import type { Agent } from "node:http";

import type { ApiClientOptions } from "grammy";
import { SocksProxyAgent } from "socks-proxy-agent";

// grammY on Node sends requests through node-fetch, which ignores HTTPS_PROXY and
// the Windows system proxy; an agent is the only way to reroute it. The same agent
// carries file downloads, so both take one path to Telegram.
export function telegramAgent(proxyUrl: string | undefined): Agent | undefined
{
	return proxyUrl === undefined ? undefined : new SocksProxyAgent(proxyUrl);
}

// grammY merges baseFetchConfig over its defaults, so compression stays on, while
// its keep-alive agent is replaced: every request opens a fresh proxy connection,
// which suits proxies that cut long-lived connections, such as Cloudflare WARP.
export function telegramClientOptions(agent: Agent | undefined): ApiClientOptions
{
	return agent === undefined ? {} : { baseFetchConfig: { agent } };
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
