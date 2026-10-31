/**
 * Base-URL guard for console-created OpenAI-compatible providers (#432).
 *
 * A superadmin can type any URL into the provider form, and the server will
 * then fetch it with an API key attached. That is a server-side request forgery
 * surface: `http://169.254.169.254/` (cloud metadata), `http://localhost:3000/`
 * (the app itself) or a private-range host must never be reachable this way.
 *
 * Rules: https only, no credentials in the URL, no fragment, a bounded length,
 * and a hostname that is not a loopback/private/link-local/unique-local
 * address or a local-only suffix.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_URL_LENGTH = 300;
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];
const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "[::]", "::", "::1", "[::1]"]);

export type BaseUrlCheck = { ok: true; url: string } | { ok: false; error: string };

export function isPrivateIpv4(host: string): boolean {
	const parts = host.split(".");
	if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
	const octets = parts.map(Number);
	if (octets.some((octet) => octet > 255)) return false;
	const [a, b] = octets;
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 169 && b === 254) return true; // link-local, cloud metadata
	if (a === 172 && b >= 16 && b <= 31) return true; // private
	if (a === 192 && b === 168) return true; // private
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
	if (a >= 224) return true; // multicast/reserved
	return false;
}

export function isPrivateIpv6(host: string): boolean {
	const bare = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
	if (bare === "::" || bare === "::1") return true;
	if (bare.startsWith("fe80:")) return true; // link-local
	if (bare.startsWith("fc") || bare.startsWith("fd")) return true; // unique local
	if (bare.startsWith("fec0:")) return true; // deprecated site-local
	// IPv4-mapped addresses keep the IPv4 rules. `new URL` rewrites
	// `[::ffff:127.0.0.1]` to the hex form `[::ffff:7f00:1]`, so both forms
	// are read here, or the guard would pass loopback and metadata addresses.
	const mapped = bare.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
	if (mapped) return isPrivateIpv4(mapped[1]);
	const mappedHex = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
	if (mappedHex) {
		const high = Number.parseInt(mappedHex[1], 16);
		const low = Number.parseInt(mappedHex[2], 16);
		return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
	}
	return false;
}

export function checkProviderBaseUrl(raw: string): BaseUrlCheck {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return { ok: false, error: "Enter the provider base URL." };
	if (trimmed.length > MAX_URL_LENGTH) {
		return { ok: false, error: `The base URL must be at most ${MAX_URL_LENGTH} characters.` };
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return { ok: false, error: "Enter a valid https URL." };
	}

	if (url.protocol !== "https:") {
		return { ok: false, error: "The provider base URL must use https." };
	}
	if (url.username || url.password) {
		return { ok: false, error: "Do not put credentials in the base URL." };
	}
	if (url.hash) {
		return { ok: false, error: "Remove the fragment from the base URL." };
	}

	const host = url.hostname.toLowerCase();
	if (BLOCKED_HOSTNAMES.has(host)) {
		return { ok: false, error: "The base URL cannot point at a local address." };
	}
	if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
		return { ok: false, error: "The base URL cannot point at a local address." };
	}
	if (host.includes(":") ? isPrivateIpv6(host) : isPrivateIpv4(host)) {
		return { ok: false, error: "The base URL cannot point at a private address." };
	}

	return { ok: true, url: url.toString().replace(/\/+$/, "") };
}

/** Chat-completions endpoint for an OpenAI-compatible base URL. */
export function chatCompletionsUrl(baseUrl: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * Resolve a hostname and refuse it when any address it points at is private.
 *
 * `checkProviderBaseUrl` only reads the typed hostname, so a public-looking
 * name whose DNS record points at `169.254.169.254` or `10.x` would pass it.
 * This runs when the URL is saved and again before every provider call. A
 * short-lived DNS rebind between this lookup and the fetch is a remaining
 * window; the provider fetch also refuses redirects, so a public host cannot
 * bounce the request, with its API key, to an internal address.
 */
export async function assertHostResolvesPublic(hostname: string): Promise<void> {
	const host = hostname.replace(/^\[/, "").replace(/\]$/, "");
	const literal = isIP(host);
	if (literal === 4 && isPrivateIpv4(host)) throw new Error("Provider host is a private address.");
	if (literal === 6 && isPrivateIpv6(host)) throw new Error("Provider host is a private address.");
	if (literal !== 0) return;

	let addresses: { address: string; family: number }[];
	try {
		addresses = await lookup(host, { all: true });
	} catch {
		throw new Error("Provider host could not be resolved.");
	}
	if (addresses.length === 0) throw new Error("Provider host could not be resolved.");
	for (const { address, family } of addresses) {
		if (family === 6 ? isPrivateIpv6(address) : isPrivateIpv4(address)) {
			throw new Error("Provider host resolves to a private address.");
		}
	}
}

/** `checkProviderBaseUrl` plus the DNS check, for the places that save a URL. */
export async function checkProviderBaseUrlResolved(raw: string): Promise<BaseUrlCheck> {
	const checked = checkProviderBaseUrl(raw);
	if (!checked.ok) return checked;
	try {
		await assertHostResolvesPublic(new URL(checked.url).hostname);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : "Invalid host." };
	}
	return checked;
}
