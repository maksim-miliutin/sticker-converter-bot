export const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export type LogLevel = (typeof logLevels)[number];

export interface Config
{
	readonly botToken: string;
	readonly logLevel: LogLevel;
	readonly telegramProxyUrl: string | undefined;
	readonly pollingTimeoutSeconds: number;
	readonly maxFileBytes: number;
	readonly maxPixels: number;
	readonly databasePath: string;
}

// Everything the logger must scrub. A proxy password appears in logs either as
// written in the URL (percent-encoded) or decoded, so both forms are listed.
export function secretsOf(config: Config): string[]
{
	const secrets = new Set([config.botToken]);

	const password = config.telegramProxyUrl === undefined ? "" : URL.parse(config.telegramProxyUrl)?.password ?? "";
	if (password !== "")
	{
		secrets.add(password);
		secrets.add(decodedOrSame(password));
	}

	return [...secrets];
}

function decodedOrSame(value: string): string
{
	try
	{
		return decodeURIComponent(value);
	}
	catch
	{
		// A lone "%" is not an escape; the URL keeps such a password as written.
		return value;
	}
}

export class ConfigError extends Error
{
	readonly issues: readonly string[];

	constructor(issues: readonly string[])
	{
		super(`invalid configuration:\n- ${issues.join("\n- ")}`);
		this.name = "ConfigError";
		this.issues = issues;
	}
}

// Bot API tokens are "<bot id>:<secret>". The shape check only catches a broken
// copy-paste early; whether Telegram accepts the token is known after getMe.
const tokenShape = /^\d{1,20}:[A-Za-z0-9_-]{30,}$/;

function isLogLevel(value: string): value is LogLevel
{
	return (logLevels as readonly string[]).includes(value);
}

// The schemes socks-proxy-agent understands, minus its bare "socks:", which hides
// whether names are resolved locally or by the proxy.
const proxySchemes = ["socks5h:", "socks5:", "socks4a:", "socks4:"];

function isProxyUrl(value: string): boolean
{
	const url = URL.parse(value);

	return url !== null && proxySchemes.includes(url.protocol) && url.hostname !== "" && url.port !== "";
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config
{
	const issues: string[] = [];

	const botToken = env.BOT_TOKEN?.trim() ?? "";
	if (botToken === "")
	{
		issues.push("BOT_TOKEN is not set");
	}
	else if (!tokenShape.test(botToken))
	{
		// The value itself is never quoted: it is a secret even when it is wrong.
		issues.push("BOT_TOKEN does not look like a bot token from @BotFather (<digits>:<secret>)");
	}

	const rawLevel = env.LOG_LEVEL?.trim() || "info";
	const logLevel = isLogLevel(rawLevel) ? rawLevel : undefined;
	if (logLevel === undefined)
	{
		issues.push(`LOG_LEVEL must be one of ${logLevels.join(", ")}`);
	}

	const telegramProxyUrl = env.TELEGRAM_PROXY_URL?.trim() || undefined;
	if (telegramProxyUrl !== undefined && !isProxyUrl(telegramProxyUrl))
	{
		// Not quoted either: a proxy URL may carry a login and password.
		issues.push(
			"TELEGRAM_PROXY_URL must be a SOCKS proxy with host and port, for example socks5h://127.0.0.1:40000 "
			+ `(supported: ${proxySchemes.map((scheme) => scheme.slice(0, -1)).join(", ")})`,
		);
	}

	const wholeNumber = (name: string, fallback: number, max: number, unit: string): number =>
	{
		const raw = env[name]?.trim() || String(fallback);
		const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
		if (!(value >= 1 && value <= max))
		{
			issues.push(`${name} must be a whole number of ${unit} from 1 to ${String(max)}`);
		}

		return value;
	};

	const pollingTimeoutSeconds = wholeNumber("POLLING_TIMEOUT_SECONDS", 30, 50, "seconds");
	// The cloud Bot API serves files through getFile up to 20 MB.
	const maxFileMb = wholeNumber("MAX_FILE_MB", 20, 20, "megabytes");
	const maxMegapixels = wholeNumber("MAX_INPUT_MEGAPIXELS", 50, 100, "megapixels");

	if (issues.length > 0 || logLevel === undefined)
	{
		throw new ConfigError(issues);
	}

	return {
		botToken,
		logLevel,
		telegramProxyUrl,
		pollingTimeoutSeconds,
		maxFileBytes: maxFileMb * 1024 * 1024,
		maxPixels: maxMegapixels * 1_000_000,
		databasePath: env.DATABASE_PATH?.trim() || "data/bot.sqlite",
	};
}
