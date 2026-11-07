/**
 * Minimal HTTP clients for the bench harness: the app's device routes,
 * PostgREST (the local database) and the Storage API.
 *
 * Node 22's built-in fetch is the only dependency. Every request is bounded by
 * a timeout, every response body is read through the redactor, and no client
 * ever puts a credential in a URL or a log line.
 */

export function createRedactor(secrets) {
	const values = secrets.filter((value) => typeof value === "string" && value.length >= 8);
	return (input) => {
		let text = String(input);
		for (const value of values) {
			text = text.split(value).join("[redacted]");
		}
		return text
			.replace(/token=[^&\s"']+/gi, "token=[redacted]")
			.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
			.replace(/apikey["']?\s*[:=]\s*["']?[A-Za-z0-9._-]+/gi, "apikey=[redacted]");
	};
}

async function readBody(response, redact) {
	const text = await response.text();
	const rawLength = Buffer.byteLength(text, "utf8");
	if (!text) return { text: "", json: null, rawLength };
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { text: redact(text.slice(0, 2000)), json, rawLength };
}

export function createApiClient({ baseUrl, redact, timeoutMs = 15_000 }) {
	const base = baseUrl.replace(/\/+$/, "");

	async function request(path, options = {}) {
		const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
		const headers = {
			accept: "application/json",
			"cache-control": "no-store",
			...(options.body === undefined ? {} : { "content-type": "application/json" }),
			...(options.token ? { "x-device-token": options.token } : {}),
			...(options.headers ?? {}),
		};
		let response;
		try {
			response = await fetch(url, {
				method: options.method ?? "GET",
				headers,
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
				signal: AbortSignal.timeout(options.timeoutMs ?? timeoutMs),
			});
		} catch (error) {
			throw new Error(
				`${options.method ?? "GET"} ${path} failed: ${redact(error instanceof Error ? error.message : String(error))}`,
			);
		}
		const body = await readBody(response, redact);
		return {
			status: response.status,
			headers: response.headers,
			text: body.text,
			json: body.json,
			rawLength: body.rawLength,
			ok: response.ok,
			path,
		};
	}

	return { request, baseUrl: base };
}

export function createPostgrest({ supabaseUrl, serviceKey, redact }) {
	const base = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1`;

	async function call(table, query, options = {}) {
		const url = `${base}/${encodeURIComponent(table)}${query ? `?${query}` : ""}`;
		const method = options.method ?? "GET";
		const prefer = options.prefer ?? (method === "GET" ? null : "return=representation");
		let response;
		try {
			response = await fetch(url, {
				method,
				headers: {
					apikey: serviceKey,
					authorization: `Bearer ${serviceKey}`,
					accept: "application/json",
					"content-type": "application/json",
					...(prefer ? { prefer } : {}),
				},
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
				signal: AbortSignal.timeout(15_000),
			});
		} catch (error) {
			throw new Error(
				`PostgREST ${method} ${table} failed: ${redact(
					error instanceof Error ? error.message : String(error),
				)}`,
			);
		}
		const body = await readBody(response, redact);
		if (!response.ok) {
			throw new Error(
				`PostgREST ${options.method ?? "GET"} ${table} -> ${response.status}: ${body.text || "(empty)"}`,
			);
		}
		return body.json;
	}

	return {
		select(table, query = "") {
			return call(table, query);
		},
		async first(table, query = "") {
			const rows = await call(table, `${query}${query ? "&" : ""}limit=1`);
			return Array.isArray(rows) ? (rows[0] ?? null) : null;
		},
		async count(table, query = "") {
			const url = `${base}/${encodeURIComponent(table)}${query ? `?${query}` : ""}`;
			const response = await fetch(url, {
				method: "HEAD",
				headers: {
					apikey: serviceKey,
					authorization: `Bearer ${serviceKey}`,
					prefer: "count=exact",
					range: "0-0",
				},
				signal: AbortSignal.timeout(15_000),
			});
			if (!response.ok) {
				throw new Error(`PostgREST COUNT ${table} -> ${response.status}`);
			}
			const range = response.headers.get("content-range") ?? "*/0";
			const total = Number(range.split("/")[1]);
			return Number.isFinite(total) ? total : 0;
		},
		insert(table, rows) {
			return call(table, "", { method: "POST", body: rows });
		},
		update(table, query, patch) {
			return call(table, query, { method: "PATCH", body: patch });
		},
		delete(table, query) {
			return call(table, query, { method: "DELETE", prefer: "return=minimal" });
		},
	};
}

export function createStorage({ supabaseUrl, serviceKey, redact }) {
	const base = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1`;
	const authHeaders = {
		apikey: serviceKey,
		authorization: `Bearer ${serviceKey}`,
	};

	async function request(path, options = {}) {
		let response;
		try {
			response = await fetch(`${base}${path}`, {
				method: options.method ?? "GET",
				headers: { ...authHeaders, ...(options.headers ?? {}) },
				body: options.body,
				signal: AbortSignal.timeout(30_000),
			});
		} catch (error) {
			throw new Error(
				`Storage ${options.method ?? "GET"} ${path} failed: ${redact(
					error instanceof Error ? error.message : String(error),
				)}`,
			);
		}
		return response;
	}

	return {
		async ensureBucket(bucket) {
			const created = await request("/bucket", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id: bucket, name: bucket, public: false }),
			});
			if (!created.ok) {
				const detail = redact((await created.text()).slice(0, 500));
				const alreadyExists = /already exists|duplicate|exists/i.test(detail);
				if (!alreadyExists) {
					throw new Error(
						`Storage bucket ${bucket} could not be created: ${created.status} ${detail}`,
					);
				}
			}
			const bucketResponse = await request(`/bucket/${encodeURIComponent(bucket)}`);
			const body = await bucketResponse.json().catch(() => null);
			if (!bucketResponse.ok || !body) {
				throw new Error(`Storage bucket ${bucket} is not readable: ${bucketResponse.status}`);
			}
			return { public: body.public, id: body.id ?? body.name ?? bucket };
		},

		async putObject(bucket, path, bytes, contentType) {
			const response = await request(
				`/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`,
				{
					method: "POST",
					headers: { "content-type": contentType, "x-upsert": "true" },
					body: bytes,
				},
			);
			const detail = redact((await response.text()).slice(0, 500));
			if (!response.ok) {
				throw new Error(`Storage upload ${bucket}/${path} -> ${response.status} ${detail}`);
			}
			return detail;
		},

		async downloadObject(bucket, path) {
			const response = await request(
				`/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`,
			);
			if (!response.ok) {
				const detail = redact((await response.text()).slice(0, 500));
				throw new Error(`Storage download ${bucket}/${path} -> ${response.status} ${detail}`);
			}
			return Buffer.from(await response.arrayBuffer());
		},

		async signObject(bucket, path, expiresIn) {
			const response = await request(
				`/object/sign/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ expiresIn }),
				},
			);
			const body = await response.json().catch(() => null);
			if (!response.ok || !body?.signedURL) {
				throw new Error(`Storage sign ${bucket}/${path} -> ${response.status}`);
			}
			const signed = String(body.signedURL);
			if (signed.startsWith("http://") || signed.startsWith("https://")) return signed;
			if (signed.startsWith("/storage/v1/")) {
				return `${supabaseUrl.replace(/\/+$/, "")}${signed}`;
			}
			if (signed.startsWith("/object/")) return `${base}${signed}`;
			return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
		},

		async deleteObject(bucket, path) {
			const response = await request(
				`/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`,
				{ method: "DELETE" },
			);
			if (!response.ok && response.status !== 404) {
				const detail = redact((await response.text()).slice(0, 300));
				throw new Error(`Storage delete ${bucket}/${path} -> ${response.status} ${detail}`);
			}
		},
	};
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll a read function until it returns a truthy value. Used only for data the
 * route commits asynchronously (there is no queue between the request and the
 * row); the timeout is deliberately short so a real failure is not hidden.
 */
export async function waitFor(label, read, { timeoutMs = 10_000, intervalMs = 200 } = {}) {
	const started = Date.now();
	let last = null;
	let lastError = null;
	while (Date.now() - started < timeoutMs) {
		try {
			last = await read();
			if (last) return last;
		} catch (error) {
			lastError = error;
		}
		await sleep(intervalMs);
	}
	const suffix = lastError ? ` (last error: ${lastError.message})` : "";
	throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}${suffix}`);
}
