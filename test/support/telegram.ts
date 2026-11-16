import type { Bot } from "grammy";
import type { Chat, Update, UserFromGetMe } from "grammy/types";

export interface ApiCall
{
	readonly method: string;
	readonly payload: Record<string, unknown>;
}

export const botInfo: UserFromGetMe = {
	id: 42,
	is_bot: true,
	first_name: "Sticker Test",
	username: "sticker_test_bot",
	can_join_groups: true,
	can_read_all_group_messages: false,
	supports_inline_queries: false,
	can_connect_to_business: false,
	has_main_web_app: false,
	has_topics_enabled: false,
	allows_users_to_create_topics: false,
	can_manage_bots: false,
	supports_join_request_queries: false,
};

export const privateChat: Chat.PrivateChat = { id: 1001, type: "private", first_name: "Anna" };
export const groupChat: Chat.GroupChat = { id: -2002, type: "group", title: "Friends" };

const user = { id: 1001, is_bot: false, first_name: "Anna" };

let updateId = 0;
let messageId = 0;

// How Telegram answers a method that fails: an API error such as 400 or 403, or a
// thrown error for a request that never got an answer at all.
export type Failure = { readonly error_code: number; readonly description: string } | Error;

// Every Bot API call made by the bot is recorded and answered locally, so a test
// sees exactly what would have gone to Telegram and nothing leaves the process.
// Methods listed in failures fail every time they are called.
export function recordCalls(bot: Bot, failures: Readonly<Record<string, Failure>> = {}): ApiCall[]
{
	const calls: ApiCall[] = [];

	bot.api.config.use((_prev, method, payload) =>
	{
		calls.push({ method, payload: payload });

		const failure = failures[method];
		if (failure instanceof Error)
		{
			return Promise.reject(failure);
		}

		if (failure !== undefined)
		{
			return Promise.resolve({ ok: false, ...failure } as never);
		}

		const result = method === "sendMessage" || method === "editMessageText"
			? { message_id: ++messageId, date: 1, chat: privateChat, text: "" }
			: true;

		return Promise.resolve({ ok: true, result } as never);
	});

	return calls;
}

export function textUpdate(text: string, chat: Chat = privateChat): Update
{
	const command = /^\/\S+/.exec(text);

	return {
		update_id: ++updateId,
		message: {
			message_id: ++messageId,
			date: 1_700_000_000,
			chat,
			from: user,
			text,
			...(command && { entities: [{ type: "bot_command", offset: 0, length: command[0].length }] }),
		},
	} as Update;
}

export interface CallbackOptions
{
	readonly chat?: Chat;
	// Telegram sends a message with date 0 when the original can no longer be
	// read or edited, for example after it was deleted.
	readonly inaccessible?: boolean;
}

export function callbackUpdate(data: string, options: CallbackOptions = {}): Update
{
	const chat = options.chat ?? privateChat;
	const message = options.inaccessible === true
		? { message_id: ++messageId, date: 0, chat }
		: { message_id: ++messageId, date: 1_700_000_000, chat, from: { ...botInfo }, text: "menu" };

	return {
		update_id: ++updateId,
		callback_query: { id: `cb${String(updateId)}`, from: user, chat_instance: "ci", data, message },
	};
}

export function buttonsOf(call: ApiCall | undefined): string[]
{
	const markup = call?.payload.reply_markup as { inline_keyboard?: { callback_data?: string }[][] } | undefined;

	return (markup?.inline_keyboard ?? []).flat().map((button) => button.callback_data ?? "");
}
