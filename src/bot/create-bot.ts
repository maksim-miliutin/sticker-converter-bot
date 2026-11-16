import { Bot, type ApiClientOptions } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";

import type { Logger } from "../logger.ts";
import { reportOutages } from "../outages.ts";
import { texts } from "../texts.ts";
import { commands, parseMenuData, screenFor } from "./menu.ts";

export interface BotDependencies
{
	readonly token: string;
	readonly logger: Logger;
	// Tests pass a fixed identity so the bot never calls getMe.
	readonly botInfo?: UserFromGetMe;
	// How requests reach Telegram, for example through a proxy.
	readonly client?: ApiClientOptions;
}

function updateKind(update: Update): string
{
	return Object.keys(update).find((key) => key !== "update_id") ?? "unknown";
}

export function createBot(deps: BotDependencies): Bot
{
	const bot = new Bot(deps.token, {
		...(deps.botInfo !== undefined && { botInfo: deps.botInfo }),
		...(deps.client !== undefined && { client: deps.client }),
	});

	bot.api.config.use(reportOutages(deps.logger));

	// The update id and kind are all that is logged: /privacy promises no message text.
	bot.use(async (ctx, next) =>
	{
		const started = performance.now();
		try
		{
			await next();
		}
		finally
		{
			const ms = Math.round(performance.now() - started);
			deps.logger.debug({ updateId: ctx.update.update_id, kind: updateKind(ctx.update), ms }, "update handled");
		}
	});

	const direct = bot.chatType("private");

	for (const entry of commands)
	{
		direct.command(entry.command, async (ctx) =>
		{
			const screen = screenFor(entry.screen);
			await ctx.reply(screen.text, { reply_markup: screen.reply_markup });
		});
	}

	direct.on("callback_query:data", async (ctx) =>
	{
		const target = parseMenuData(ctx.callbackQuery.data);
		if (target === undefined)
		{
			await ctx.answerCallbackQuery({ text: texts.staleButton });
			return;
		}

		await ctx.answerCallbackQuery();

		const screen = screenFor(target);
		const message = ctx.callbackQuery.message;
		if (message === undefined || message.date === 0)
		{
			await ctx.reply(screen.text, { reply_markup: screen.reply_markup });
			return;
		}

		await ctx.editMessageText(screen.text, { reply_markup: screen.reply_markup });
	});

	direct.on("message", async (ctx) =>
	{
		await ctx.reply(texts.hint, { reply_markup: screenFor("main").reply_markup });
	});

	// Groups, inline messages and anything the handlers above passed on: the client
	// keeps a spinner on the button until the query is answered.
	bot.on("callback_query", async (ctx) =>
	{
		await ctx.answerCallbackQuery();
	});

	// Without a handler grammY prints the raw error to the console and stops polling.
	bot.catch((error) =>
	{
		deps.logger.error({ err: error.error, updateId: error.ctx.update.update_id }, "update failed");
	});

	return bot;
}
