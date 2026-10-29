/**
 * PakaonAI offline shell.
 *
 * Caching rules (T-11):
 * - Only same-origin static assets are cached, by request destination and an
 *   explicit path allowlist.
 * - HTML/navigation responses are NEVER cached: they can contain another
 *   signed-in user's data and must always come from the network.
 * - API and auth requests are never intercepted or cached.
 * - Bumping CACHE_NAME purges every previous cache on activate.
 */
const CACHE_NAME = "pakaonai-static-v7";
const CACHE_PREFIX = "pakaonai-static-";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
	OFFLINE_URL,
	"/manifest.webmanifest",
	"/icons/icon-192.png",
	"/icons/icon-512.png",
	"/icons/maskable-512.png",
	"/icons/apple-touch-icon.png",
	"/favicon.ico",
	// Pakoy's offline pose is part of the offline page (#221).
	"/mascot/pakoy-offline.webp",
];

const STATIC_PREFIXES = [
	"/_next/static/",
	"/icons/",
	"/pakaonai-logo-kit/",
	"/mascot/",
	"/models/",
];
const STATIC_FILES = new Set([
	"/manifest.webmanifest",
	"/favicon.ico",
	"/icons/icon-192.png",
	"/icons/icon-512.png",
	"/icons/maskable-512.png",
	"/icons/apple-touch-icon.png",
]);
const CACHEABLE_DESTINATIONS = new Set(["script", "style", "image", "font", "manifest"]);

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			await cache.addAll(PRECACHE_URLS);
			await self.skipWaiting();
		})(),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
					.map((key) => caches.delete(key)),
			);
			await self.clients.claim();
		})(),
	);
});

self.addEventListener("message", (event) => {
	if (event.data && event.data.type === "SKIP_WAITING") {
		self.skipWaiting();
	}
});

function isCacheableAsset(pathname, request) {
	if (request.mode === "navigate" || request.destination === "document") return false;
	// A GLB fetched by useGLTF arrives with destination "empty"/"other", not
	// "image". Allow that exception only under the explicit /models/ prefix;
	// every other asset still needs an allowlisted destination.
	const modelAsset = pathname.startsWith("/models/");
	if (!modelAsset && !CACHEABLE_DESTINATIONS.has(request.destination)) return false;
	if (STATIC_FILES.has(pathname)) return true;
	return STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isShareable(response) {
	if (!response || !response.ok) return false;
	if (response.type !== "basic") return false;
	const cacheControl = response.headers.get("cache-control") || "";
	if (/no-store|private/i.test(cacheControl)) return false;
	const vary = response.headers.get("vary") || "";
	// Never store a response that varies by auth/cookie/cookie-dependent headers.
	if (/(authorization|cookie)/i.test(vary)) return false;
	return true;
}

async function cacheFirst(request) {
	const cached = await caches.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (isShareable(response)) {
		const cache = await caches.open(CACHE_NAME);
		await cache.put(request, response.clone());
	}
	return response;
}

async function navigationFallback(request) {
	try {
		// Network first, always. HTML is never written to the cache.
		const response = await fetch(request);
		if (response) return response;
	} catch {
		// Network unavailable; serve the cached offline shell below.
	}

	const cached = await caches.match(OFFLINE_URL);
	if (cached) return cached;

	return new Response("Offline", {
		status: 503,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
	if (request.headers.has("authorization")) return;

	if (request.mode === "navigate" || request.destination === "document") {
		event.respondWith(navigationFallback(request));
		return;
	}

	if (isCacheableAsset(url.pathname, request)) {
		event.respondWith(cacheFirst(request));
	}
});
