import { pino, type Logger } from "pino";

import type { LogLevel } from "./config.ts";

export type { Logger };

export interface LogDestination
{
	write(chunk: string): unknown;
}

export interface LoggerOptions
{
	readonly level: LogLevel;
	readonly secrets: readonly string[];
	readonly destination?: LogDestination;
}

// Secrets are scrubbed from the finished line rather than from known field paths:
// an error can carry a secret anywhere, including inside a nested cause. They are
// matched as written, which is enough while every secret is a bot token or a
// webhook secret, neither of which holds a character JSON would escape.
export function createLogger(options: LoggerOptions): Logger
{
	const secrets = options.secrets.filter((secret) => secret !== "");
	const target = options.destination ?? pino.destination({ dest: 1, sync: true });

	const scrubbing: LogDestination = {
		write(chunk)
		{
			let line = chunk;
			for (const secret of secrets)
			{
				line = line.replaceAll(secret, "[redacted]");
			}

			return target.write(line);
		},
	};

	return pino({ level: options.level, timestamp: pino.stdTimeFunctions.isoTime }, scrubbing);
}
