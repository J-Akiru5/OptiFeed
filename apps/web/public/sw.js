const CACHE_NAME = "pakaonai-static-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
	OFFLINE_URL,
	"/manifest.webmanifest",
	"/icons/icon-192.png",
	"/icons/icon-512.png",
	"/icons/maskable-512.png",
	"/icons/apple-touch-icon.png",
	"/favicon.ico",
];

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
					.filter((key) => key.startsWith("pakaonai-static-") && key !== CACHE_NAME)
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

function isStaticAsset(pathname) {
	return (
		pathname.startsWith("/_next/static/") ||
		pathname.startsWith("/icons/") ||
		pathname.startsWith("/pakaonai-logo-kit/") ||
		/\.(?:css|js|woff2?|png|jpe?g|svg|webp|ico)$/i.test(pathname)
	);
}

async function cacheFirst(request) {
	const cached = await caches.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok) {
		const cache = await caches.open(CACHE_NAME);
		await cache.put(request, response.clone());
	}
	return response;
}

async function navigationFallback(request) {
	try {
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

	if (request.mode === "navigate") {
		event.respondWith(navigationFallback(request));
		return;
	}

	if (isStaticAsset(url.pathname)) {
		event.respondWith(cacheFirst(request));
	}
});
