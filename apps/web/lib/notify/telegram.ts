const TELEGRAM_API_BASE = "https://api.telegram.org";
const TIMEOUT_MS = 2000;
const MAX_ATTEMPTS = 2; // first try + one retry

/**
 * Join a path onto NEXT_PUBLIC_BASE_URL for links in alerts (3.5/5.1:
 * links are stored locale-free, absolute only where a full URL is needed).
 * Returns null when the base URL is not configured.
 */
export function absoluteAppUrl(path: string): string | null {
	const base = process.env.NEXT_PUBLIC_BASE_URL;
	if (!base) return null;
	return `${base.replace(/\/+$/, "")}${path}`;
}

/**
 * Send a message to the ops chat (task 3.5, decision D3).
 *
 * - No-op returning false while TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is
 *   unset (H11 adds them later) — alerts keep working DB-only until then.
 * - One retry with a short timeout; after that it gives up and returns
 *   false. A Telegram outage must never break ingest or the cron.
 * - Never logs the token (the token lives only inside the request URL,
 *   which is never printed) and never throws.
 *
 * Limitation (documented in the plan): one TELEGRAM_CHAT_ID means every
 * farm's alerts go to one chat — fine for a pilot or ops group. A per-farm
 * contact field is a later, additive task.
 */
export async function sendTelegramMessage(text: string): Promise<boolean> {
	const token = process.env.TELEGRAM_BOT_TOKEN;
	const chatId = process.env.TELEGRAM_CHAT_ID;
	if (!token || !chatId) return false;

	const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
	const body = JSON.stringify({
		chat_id: chatId,
		text,
		link_preview_options: { is_disabled: true },
	});

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body,
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (response.ok) return true;
		} catch {
			// Network error or timeout — fall through to the retry.
		}
		// Only retry when there are attempts left (keeps silence predictable).
		if (attempt < MAX_ATTEMPTS) {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}

	// No URL, no token, no payload in the log line.
	console.error("[telegram] delivery failed after retry");
	return false;
}
