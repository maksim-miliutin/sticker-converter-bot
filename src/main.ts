import process from "node:process";

import { createBot } from "./bot/create-bot.ts";
import { commands } from "./bot/menu.ts";
import { ConfigError, loadConfig, secretsOf, type Config } from "./config.ts";
import { createLogger, type Logger } from "./logger.ts";
import { assertNoWebhook, pollingOptions } from "./polling.ts";
import { PackStore } from "./store/packs.ts";
import { proxyLabel, telegramAgent } from "./telegram-client.ts";

async function poll(config: Config, logger: Logger): Promise<void>
{
	const agent = telegramAgent(config.telegramProxyUrl);
	const packs = new PackStore(config.databasePath);
	const bot = createBot({
		token: config.botToken,
		logger,
		packs,
		limits: { maxFileBytes: config.maxFileBytes, maxPixels: config.maxPixels },
		...(agent !== undefined && { agent }),
	});

	// grammY waits up to 500 seconds for an answer; without this line an unreachable
	// Telegram looks like a terminal that does nothing at all.
	logger.info({ via: proxyLabel(config.telegramProxyUrl) }, "connecting to Telegram");
	await bot.init();
	await assertNoWebhook(bot.api);
	await bot.api.setMyCommands(commands.map(({ command, description }) => ({ command, description })));

	// Installed only now: a Ctrl+C during startup should simply end the process.
	const stop = (): void =>
	{
		logger.info("stopping");
		void bot.stop();
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	await bot.start({
		...pollingOptions(config.pollingTimeoutSeconds),
		onStart: (me) =>
		{
			logger.info({ username: me.username, pollSeconds: config.pollingTimeoutSeconds }, "long polling started");
		},
	});

	packs.close();
	logger.info("stopped");
}

async function main(): Promise<number>
{
	let config: Config;
	try
	{
		config = loadConfig(process.env);
	}
	catch (error)
	{
		if (error instanceof ConfigError)
		{
			console.error(error.message);
			return 1;
		}

		throw error;
	}

	// From here on every error goes through the logger, which scrubs the token.
	const logger = createLogger({ level: config.logLevel, secrets: secretsOf(config) });
	try
	{
		await poll(config, logger);
		return 0;
	}
	catch (error)
	{
		logger.fatal({ err: error }, "bot stopped on an error");
		return 1;
	}
}

process.exitCode = await main();
