import { randomBytes } from "node:crypto";

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

// Telegram's rules for a set's short name: letters, digits and underscores,
// starting with a letter, no two underscores in a row, ending in
// _by_<bot username>, 64 characters at most. Seven random characters make a
// clash unlikely; the caller still retries if Telegram reports the name taken.
export function packName(botUsername: string): string
{
	const random = Array.from(randomBytes(7), (byte) => alphabet[byte % alphabet.length]).join("");

	return `s${random}_by_${botUsername}`;
}
