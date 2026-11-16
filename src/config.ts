export const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export type LogLevel = (typeof logLevels)[number];

export interface Config
{
	readonly botToken: string;
	readonly logLevel: LogLevel;
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

	if (issues.length > 0 || logLevel === undefined)
	{
		throw new ConfigError(issues);
	}

	return { botToken, logLevel };
}
