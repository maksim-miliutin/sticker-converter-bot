import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types";

import { texts } from "../texts.ts";

export type ScreenId = "main" | "sticker" | "convert" | "packs" | "help" | "privacy" | "deleteMe" | "cancel";

export interface Screen
{
	readonly text: string;
	readonly reply_markup: InlineKeyboardMarkup;
}

export interface CommandEntry
{
	readonly command: string;
	readonly description: string;
	readonly screen: ScreenId;
}

// One table feeds the command handlers, the command menu set through
// setMyCommands and the tests, so a command cannot exist in one and not the others.
export const commands: readonly CommandEntry[] = [
	{ command: "start", description: texts.commandStart, screen: "main" },
	{ command: "stickers", description: texts.commandStickers, screen: "sticker" },
	{ command: "convert", description: texts.commandConvert, screen: "convert" },
	{ command: "packs", description: texts.commandPacks, screen: "packs" },
	{ command: "help", description: texts.commandHelp, screen: "help" },
	{ command: "privacy", description: texts.commandPrivacy, screen: "privacy" },
	{ command: "delete_me", description: texts.commandDeleteMe, screen: "deleteMe" },
	{ command: "cancel", description: texts.commandCancel, screen: "cancel" },
];

const screenTexts: Record<ScreenId, string> = {
	main: texts.welcome,
	sticker: texts.stickerPrompt,
	convert: texts.convertPrompt,
	packs: texts.packsEmpty,
	help: texts.help,
	privacy: texts.privacy,
	deleteMe: texts.deleteMe,
	cancel: texts.cancel,
};

// Only these screens are reachable by a button; anything else in callback data
// is stale or forged, even when it names a real screen.
const menuButtons: readonly { readonly screen: ScreenId; readonly label: string }[] = [
	{ screen: "sticker", label: texts.menuSticker },
	{ screen: "convert", label: texts.menuConvert },
	{ screen: "packs", label: texts.menuPacks },
	{ screen: "help", label: texts.menuHelp },
];

const prefix = "menu:";

function button(label: string, screen: ScreenId): InlineKeyboardButton
{
	return { text: label, callback_data: prefix + screen };
}

export function screenFor(id: ScreenId): Screen
{
	const keyboard = id === "main"
		? menuButtons.map((entry) => [button(entry.label, entry.screen)])
		: [[button(texts.back, "main")]];

	return { text: screenTexts[id], reply_markup: { inline_keyboard: keyboard } };
}

export function parseMenuData(data: string): ScreenId | undefined
{
	if (!data.startsWith(prefix))
	{
		return undefined;
	}

	const target = data.slice(prefix.length);
	if (target === "main")
	{
		return "main";
	}

	return menuButtons.find((entry) => entry.screen === target)?.screen;
}
