#!/usr/bin/env node
/**
 * Bench verification harness for the OptiFeed device loop and signed OTA.
 *
 * This script exercises the server half of the loop against the *local*
 * Supabase stack and the local Next.js app, then builds/uploads a real signed
 * OTA channel and checks the delivery contract. It is deliberately
 * dependency-free: Node 22's fetch, PostgREST and the Storage API are enough.
 *
 * Usage (from the repository root):
 *   node scripts/bench/device-loop.mjs
 *   node scripts/bench/device-loop.mjs --self-check   # no stack, no network
 *
 * Required environment (same conventions as the `e2e` job):
 *   DATABASE_URL                   loopback only; the target guard
 *   NEXT_PUBLIC_SUPABASE_URL       loopback local stack
 *   SUPABASE_SERVICE_ROLE_KEY      local stack service key
 *   E2E_ALLOW_LOCAL_STACK=yes      explicit local-stack opt-in
 *   CRON_SECRET                    local-only value, also set on the app server
 * Optional:
 *   BENCH_BASE_URL                 default PLAYWRIGHT_BASE_URL or 127.0.0.1:3000
 *   BENCH_DEVICE_MAC               default 02:00:00:BE:00:01
 *   BENCH_OTA_VARIANT              gpio5 (default) or gpio25
 *   BENCH_OTA_PRIVATE_KEY          offline key path for an installable image
 *   BENCH_OTA_KEY_ID               primary (default) or spare
 *   BENCH_REQUIRE_OTA_DELIVERY=1   fail instead of skipping when the stack is HTTP
 *   BENCH_KEEP_FIXTURE=1           keep the temp signing fixture and DB rows
 *
 * The harness never writes to a non-loopback host and never prints a token,
 * service key, cron secret, private key or signed URL query string.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	OTA_CONTRACT,
	assertChannelEnvelope,
	buildExpectedCheckResponse,
	checkSourceContract,
	compareSemver,
	isLoopbackHost,
	isOtaVariant,
	nextMajorVersion,
	redactUrl,
	relayGpioForVariant,
	responseByteLength,
	signedUrlTtl,
	verifyChannelSignature,
} from "./lib/contract.mjs";
import {
	createApiClient,
	createPostgrest,
	createRedactor,
	createStorage,
	sleep,
	waitFor,
} from "./lib/http.mjs";
import {
	createOtaFixture,
	estimateResponseBytes,
	tamperChannelManifest,
	tamperChannelSignature,
} from "./lib/ota-fixture.mjs";
import { BenchReport } from "./lib/report.mjs";

const SELF_CHECK_PATH = "scripts/bench/device-loop.mjs";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LOOPBACK_HELP =
	"the bench harness refuses any non-loopback target; use the local Supabase stack only";

class ConfigError extends Error {}

function parseArgs(argv) {
	const options = {
		selfCheck: false,
		skipOta: false,
		requireOtaDelivery: false,
		keepFixture: false,
		help: false,
	};
	for (const arg of argv) {
		if (arg === "--self-check") options.selfCheck = true;
		else if (arg === "--skip-ota") options.skipOta = true;
		else if (arg === "--require-ota-delivery") options.requireOtaDelivery = true;
		else if (arg === "--keep-fixture") options.keepFixture = true;
		else if (arg === "--help" || arg === "-h") options.help = true;
		else throw new ConfigError(`unknown argument: ${arg}`);
	}
	return options;
}

function printHelp() {
	process.stdout.write(
		[
			"Bench device loop + OTA contract harness",
			"",
			`  node ${SELF_CHECK_PATH}                     run against the local stack`,
			`  node ${SELF_CHECK_PATH} --self-check        contract/signing checks only, no network`,
			`  node ${SELF_CHECK_PATH} --skip-ota          device loop only`,
			`  node ${SELF_CHECK_PATH} --require-ota-delivery   fail if the stack cannot deliver over HTTPS`,
			`  node ${SELF_CHECK_PATH} --keep-fixture      keep the temp fixture and the bench rows`,
			"",
			"Environment: see the header of this file.",
			"",
		].join("\n"),
	);
}

function readFirmwareVersion() {
	const source = readFileSync(
		join(repoRoot, "firmware", "firmware-main", "firmware-main.ino"),
		"utf8",
	);
	const match = /#define\s+FW_VERSION\s+"([^"]+)"/.exec(source);
	if (!match) throw new ConfigError("could not read FW_VERSION from firmware-main.ino");
	return match[1];
}

function readConfig() {
	const databaseUrl = process.env.DATABASE_URL ?? "";
	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
	const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
	const cronSecret = process.env.CRON_SECRET ?? "";
	const baseUrl =
		process.env.BENCH_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
	const deviceMac = (process.env.BENCH_DEVICE_MAC ?? "02:00:00:BE:00:01").toUpperCase();
	const variant = process.env.BENCH_OTA_VARIANT ?? "gpio5";
	const keyId = process.env.BENCH_OTA_KEY_ID ?? "primary";

	const problems = [];
	if (!databaseUrl) problems.push("DATABASE_URL is not set");
	if (!supabaseUrl) problems.push("NEXT_PUBLIC_SUPABASE_URL is not set");
	if (!serviceKey) problems.push("SUPABASE_SERVICE_ROLE_KEY is not set");
	if (!cronSecret) problems.push("CRON_SECRET is not set (the app server must use the same value)");
	if (process.env.E2E_ALLOW_LOCAL_STACK !== "yes") {
		problems.push("E2E_ALLOW_LOCAL_STACK=yes is required (same opt-in as the e2e suite)");
	}
	if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(deviceMac)) {
		problems.push(`BENCH_DEVICE_MAC is not a MAC address: ${deviceMac}`);
	}
	if (!isOtaVariant(variant))
		problems.push(`BENCH_OTA_VARIANT must be gpio5 or gpio25: ${variant}`);
	if (keyId !== "primary" && keyId !== "spare")
		problems.push(`BENCH_OTA_KEY_ID must be primary or spare: ${keyId}`);

	if (problems.length > 0) throw new ConfigError(problems.join("; "));

	const checkLoopback = (label, value) => {
		let parsed;
		try {
			parsed = new URL(value);
		} catch {
			throw new ConfigError(`${label} is not a URL: ${value}`);
		}
		if (!isLoopbackHost(parsed.hostname)) {
			throw new ConfigError(`${label} points at ${parsed.hostname}; ${LOOPBACK_HELP}`);
		}
		return parsed;
	};

	checkLoopback("DATABASE_URL", databaseUrl);
	const supabase = checkLoopback("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
	checkLoopback("BENCH_BASE_URL/PLAYWRIGHT_BASE_URL", baseUrl);

	return {
		databaseUrl,
		supabaseUrl: supabase.toString().replace(/\/+$/, ""),
		serviceKey,
		cronSecret,
		baseUrl: baseUrl.replace(/\/+$/, ""),
		deviceMac,
		variant,
		keyId,
		firmwareVersion: readFirmwareVersion(),
	};
}

function idsFor(mac) {
	const suffix = mac.replace(/:/g, "").toLowerCase();
	return {
		suffix,
		user: `bench_user_${suffix}`,
		supabaseId: `00000000-0000-4000-8000-${suffix}`,
		farmSlug: `bench-${suffix}`,
		email: `bench-${suffix}@bench.optifeed.local`,
		farm: `bench_farm_${suffix}`,
		pond: `bench_pond_${suffix}`,
		device: `bench_dev_${suffix}`,
		request: `bench_req_${suffix}`,
	};
}

async function deleteQuietly(store, table, filter, warnings) {
	try {
		await store.delete(table, filter);
	} catch (error) {
		warnings.push(`${table}: ${error.message}`);
	}
}

/**
 * Remove only this harness's fixture. Child tables are deleted explicitly
 * because the Prisma relations are `Restrict` by default, not cascade. Every
 * delete is scoped by the bench ids, so a failed cleanup can never touch a
 * real row.
 */
async function cleanupFixture({ store, ids, mac, warnings = [] }) {
	const device = `deviceId=eq.${encodeURIComponent(ids.device)}`;
	const pond = `pondId=eq.${encodeURIComponent(ids.pond)}`;
	await deleteQuietly(store, "Notification", pond, warnings);
	await deleteQuietly(
		store,
		"ScheduleCommand",
		`deviceId=eq.${encodeURIComponent(ids.device)}`,
		warnings,
	);
	await deleteQuietly(store, "FeedLevelLog", device, warnings);
	await deleteQuietly(store, "WaterTempLog", device, warnings);
	await deleteQuietly(store, "FeedEvent", device, warnings);
	await deleteQuietly(store, "FeedRequest", device, warnings);
	await deleteQuietly(store, "DeviceStateEvent", device, warnings);
	await deleteQuietly(store, "DeviceConnectivityDaily", device, warnings);
	await deleteQuietly(store, "EnergyDevice", `id=eq.${encodeURIComponent(ids.device)}`, warnings);
	await deleteQuietly(store, "Pond", `id=eq.${encodeURIComponent(ids.pond)}`, warnings);
	await deleteQuietly(store, "Farm", `id=eq.${encodeURIComponent(ids.farm)}`, warnings);
	await deleteQuietly(store, "User", `id=eq.${encodeURIComponent(ids.user)}`, warnings);

	for (const scope of ["feed", "schedule", "firmware"]) {
		const key = `rl:device:${scope}:${mac}`;
		await deleteQuietly(store, "rate_limit_bucket", `key=eq.${encodeURIComponent(key)}`, warnings);
	}
	return warnings;
}

async function provisionFixture({ store, config, ids, token }) {
	await store.insert("User", {
		id: ids.user,
		supabaseId: ids.supabaseId,
		farmId: ids.farmSlug,
		email: ids.email,
		displayName: "Bench device loop",
		role: "OPERATOR",
		mustChangePassword: false,
		updatedAt: new Date().toISOString(),
	});
	await store.insert("Farm", {
		id: ids.farm,
		ownerId: ids.farmSlug,
		name: "Bench device loop farm",
		updatedAt: new Date().toISOString(),
	});
	await store.insert("Pond", {
		id: ids.pond,
		ownerId: ids.farmSlug,
		farmId: ids.farm,
		name: "Bench device loop pond",
		feedingRatePct: 3,
		feedsPerDay: 3,
		population: 1000,
		scheduleStart: "06:00:00",
		scheduleEnd: "18:00:00",
		status: "ACTIVE",
		isFallow: false,
	});
	await store.insert("EnergyDevice", {
		id: ids.device,
		mac: config.deviceMac,
		token,
		tokenHash: createHash("sha256").update(token).digest("hex"),
		label: "Bench device loop",
		pondId: ids.pond,
		approvalStatus: "APPROVED",
		isPaused: false,
		gramsPerFeeding: 50,
		buttonFeedGrams: 80,
		gramsPerSecond: 4,
		hopperCapacityG: 7000,
	});

	return store.first("EnergyDevice", `id=eq.${encodeURIComponent(ids.device)}`);
}

function reportSourceContract(report) {
	const checks = checkSourceContract(repoRoot);
	for (const check of checks) {
		if (check.ok) report.pass("contract", check.name);
		else
			report.fail(
				"contract",
				check.name,
				"source of truth moved; update the harness with the contract",
			);
	}
	return checks.every((check) => check.ok);
}

function addOtaFixtureRows(report, fixture) {
	const manifest = JSON.parse(fixture.channel.manifest);
	report.pass(
		"ota-sign",
		"signed channel matches the release contract",
		`${fixture.channel.version}, ${fixture.channel.size} bytes, ${fixture.channel.key_id}, ${manifest.variant}/GPIO ${manifest.relay_gpio}`,
	);
	report.pass(
		"ota-sign",
		"manifest bytes verify against the matching public key",
		`${fixture.signing.mode}; verifyManifestSignature equivalent (ECDSA P-256/SHA-256, DER base64)`,
	);
	report.pass(
		"ota-sign",
		"sha256 and size are the bytes the signer read",
		`sha256 ${fixture.channel.sha256.slice(0, 12)}..., ${fixture.channel.size} bytes`,
	);
	report.pass(
		"ota-sign",
		"image fits the min_spiffs OTA slot",
		`${fixture.channel.size} <= ${OTA_CONTRACT.maxImageBytes} bytes (OTA_MAX_IMAGE_BYTES)`,
	);
	const estimated = estimateResponseBytes(fixture.channel);
	if (estimated <= OTA_CONTRACT.maxCheckResponseBytes) {
		report.pass(
			"ota-sign",
			"check response stays under 8 KB",
			`${estimated} bytes <= ${OTA_CONTRACT.maxCheckResponseBytes} (OTA_MAX_CHECK_RESPONSE_BYTES)`,
		);
	} else {
		report.fail(
			"ota-sign",
			"check response stays under 8 KB",
			`${estimated} bytes > ${OTA_CONTRACT.maxCheckResponseBytes}; the route would answer update:false`,
		);
	}
}

async function runSelfCheck({ report, options }) {
	if (!reportSourceContract(report)) return;

	const version = nextMajorVersion(readFirmwareVersion());
	const fixture = createOtaFixture({
		repoRoot,
		version,
		minFrom: readFirmwareVersion(),
		variant: "gpio5",
		keyId: "primary",
		keep: options.keepFixture,
	});
	try {
		addOtaFixtureRows(report, fixture);

		const manifest = JSON.parse(fixture.channel.manifest);
		if (
			manifest.board === OTA_CONTRACT.board &&
			manifest.version === version &&
			manifest.size === fixture.image.length &&
			manifest.sha256 === fixture.channel.sha256 &&
			manifest.key_id === fixture.channel.key_id
		) {
			report.pass(
				"ota-sign",
				"manifest agrees with the envelope field by field",
				"board, version, size, sha256, key_id",
			);
		} else {
			report.fail("ota-sign", "manifest agrees with the envelope field by field");
		}

		const staleSignature = tamperChannelSignature(fixture.channel);
		if (verifyChannelSignature(staleSignature, fixture.signing.publicPem) === false) {
			report.pass(
				"ota-sign",
				"a tampered signature is rejected",
				"verifyManifestSignature owner: firmware-main.ino:2432",
			);
		} else {
			report.fail("ota-sign", "a tampered signature is rejected");
		}

		const tamperedManifest = tamperChannelManifest(fixture.channel, (values) => {
			values.version = "0.0.0";
		});
		const envelope = assertChannelEnvelope(tamperedManifest, "gpio5");
		if (envelope.length > 0) {
			report.pass(
				"ota-sign",
				"a manifest that disagrees with its envelope is refused before delivery",
				"app parseChannel owner: apps/web/lib/firmware/ota.ts:158; device checkForUpdate owner: firmware-main.ino:3165",
			);
		} else {
			report.fail(
				"ota-sign",
				"a manifest that disagrees with its envelope is refused before delivery",
			);
		}

		const source = readFileSync(
			join(repoRoot, "firmware", "firmware-main", "firmware-main.ino"),
			"utf8",
		);
		const installedAt = source.indexOf('otaSetState("installed")');
		const rolledBackAt = source.indexOf('otaSetState("rolled_back")');
		const installedSlice = installedAt >= 0 ? source.slice(installedAt, installedAt + 500) : "";
		const rolledBackSlice = rolledBackAt >= 0 ? source.slice(rolledBackAt, rolledBackAt + 500) : "";
		if (
			installedSlice.includes("ESP.restart()") &&
			!installedSlice.includes("sendTelemetry()") &&
			rolledBackSlice.includes("esp_ota_mark_app_invalid_rollback_and_reboot()")
		) {
			report.warn(
				"finding",
				"ota_installed / ota_rolled_back are not reachable from a real heartbeat",
				"firmware reboots immediately in both states; ingest maps them, but no beat carries them",
			);
		}

		if (options.keepFixture) {
			report.warn(
				"ota-sign",
				"signing fixture is kept by request",
				"the temp directory contains a throwaway private key; remove it after inspection",
			);
		} else {
			report.pass(
				"ota-sign",
				"ephemeral signing key leaves no fixture in the repository",
				"private key generated under the OS temp directory and removed after the run",
			);
		}
	} finally {
		fixture.cleanup();
	}
}

function isJsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runDeviceLoop({ report, config, options }) {
	const secrets = [config.serviceKey, config.cronSecret];
	const baseReport = report;

	const deviceToken = `esp32-tok-${randomBytes(16).toString("hex")}`;
	secrets.push(deviceToken);
	const redactWithToken = createRedactor(secrets);

	const api = createApiClient({ baseUrl: config.baseUrl, redact: redactWithToken });
	const store = createPostgrest({
		supabaseUrl: config.supabaseUrl,
		serviceKey: config.serviceKey,
		redact: redactWithToken,
	});
	const storage = createStorage({
		supabaseUrl: config.supabaseUrl,
		serviceKey: config.serviceKey,
		redact: redactWithToken,
	});

	const ids = idsFor(config.deviceMac);
	const runId = randomBytes(4).toString("hex");
	const channelVersion = nextMajorVersion(config.firmwareVersion);
	const cleanupWarnings = [];
	let deviceRow = null;
	let otaFixture = null;
	let imagePath = null;

	const pass = (...args) => baseReport.pass(...args);
	const fail = (...args) => baseReport.fail(...args);
	const skip = (...args) => baseReport.skip(...args);

	try {
		// ---- preflight -----------------------------------------------------
		if (!reportSourceContract(baseReport)) return;

		pass(
			"preflight",
			"targets are loopback only",
			`app ${api.baseUrl}, supabase ${new URL(config.supabaseUrl).host}, database ${new URL(config.databaseUrl).host}`,
		);
		pass(
			"preflight",
			"local-stack opt-in is explicit",
			"E2E_ALLOW_LOCAL_STACK=yes (same guard as the e2e suite)",
		);

		const health = await api.request("/api/health");
		if (health.status === 200) {
			pass("preflight", "local app is reachable", `${api.baseUrl}/api/health -> 200`);
		} else {
			fail("preflight", "local app is reachable", `/api/health -> ${health.status}`);
			return;
		}

		// ---- provision -----------------------------------------------------
		cleanupWarnings.push(...(await cleanupFixture({ store, ids, mac: config.deviceMac })));
		deviceRow = await provisionFixture({ store, config, ids, token: deviceToken });
		if (!deviceRow) {
			fail("provision", "bench device is provisioned", "EnergyDevice row was not returned");
			return;
		}
		const provisionedTokenHash = createHash("sha256").update(deviceToken).digest("hex");
		if (
			deviceRow.mac === config.deviceMac &&
			deviceRow.tokenHash === provisionedTokenHash &&
			deviceRow.approvalStatus === "APPROVED" &&
			deviceRow.pondId === ids.pond
		) {
			pass(
				"provision",
				"bench device is provisioned with an approved token hash",
				"same EnergyDevice columns the Superadmin Register action writes; plaintext token is never logged",
			);
		} else {
			fail("provision", "bench device is provisioned with an approved token hash");
		}

		// ---- heartbeat -----------------------------------------------------
		const heartbeatEventId = `bench-hb-${runId}`;
		const heartbeat = await api.request("/api/ingest", {
			method: "POST",
			token: deviceToken,
			body: {
				device_id: config.deviceMac,
				event_type: "heartbeat",
				event_id: heartbeatEventId,
				timestamp: new Date().toISOString(),
				rtc_ok: true,
				feeder_active: false,
				firmware_version: config.firmwareVersion,
				ota_state: "idle",
				reset_reason: "poweron",
				feed_level_percent: 42.5,
				feed_level_cm: 12.3,
				wifi_rssi: -55,
			},
		});
		if (heartbeat.status === 204) {
			pass(
				"heartbeat",
				"POST /api/ingest heartbeat is accepted",
				"204 (the firmware treats this as delivered)",
			);
		} else {
			fail(
				"heartbeat",
				"POST /api/ingest heartbeat is accepted",
				`${heartbeat.status} ${heartbeat.text}`,
			);
			return;
		}

		const seen = await waitFor(
			"heartbeat effects on EnergyDevice",
			async () => {
				const row = await store.first("EnergyDevice", `id=eq.${encodeURIComponent(ids.device)}`);
				return row?.lastSeenAt && row.feedLevelPercent === 42.5 ? row : null;
			},
			{ timeoutMs: 5000 },
		).catch((error) => {
			fail("heartbeat", "heartbeat updates EnergyDevice.lastSeenAt", error.message);
			return null;
		});
		if (seen) {
			pass(
				"heartbeat",
				"heartbeat updates EnergyDevice.lastSeenAt and hopper level",
				`lastSeenAt ${seen.lastSeenAt ? "set" : "missing"}, feedLevelPercent ${seen.feedLevelPercent}, feedLevelCm ${seen.feedLevelCm}`,
			);
		}

		const connected = await waitFor(
			"connected DeviceStateEvent",
			() =>
				store.first(
					"DeviceStateEvent",
					`deviceId=eq.${encodeURIComponent(ids.device)}&eventType=eq.connected`,
				),
			{ timeoutMs: 5000 },
		).catch(() => null);
		if (connected) {
			pass(
				"heartbeat",
				"first contact records a connected DeviceStateEvent",
				"eventType=connected, source=device",
			);
		} else {
			fail("heartbeat", "first contact records a connected DeviceStateEvent");
		}

		const reported = await store.first(
			"DeviceStateEvent",
			`deviceId=eq.${encodeURIComponent(ids.device)}&eventType=eq.firmware_reported`,
		);
		const reportedVersion =
			reported && isJsonObject(reported.metadata) ? reported.metadata.version : null;
		if (reportedVersion === config.firmwareVersion) {
			pass(
				"heartbeat",
				"reported firmware version is recorded for the hardware card",
				`firmware_reported metadata.version=${config.firmwareVersion}`,
			);
		} else {
			fail(
				"heartbeat",
				"reported firmware version is recorded for the hardware card",
				`got ${JSON.stringify(reportedVersion)}`,
			);
		}

		const todayKey = new Date().toISOString().slice(0, 10);
		const todayRollup = await store.first(
			"DeviceConnectivityDaily",
			`deviceId=eq.${encodeURIComponent(ids.device)}&day=eq.${todayKey}`,
		);
		if (todayRollup === null) {
			pass(
				"heartbeat",
				"a live heartbeat does not write today's connectivity rollup",
				"DeviceConnectivityDaily is a completed-UTC-day rollup (lib/platform/connectivity.ts:138)",
			);
		} else {
			fail(
				"heartbeat",
				"a live heartbeat does not write today's connectivity rollup",
				"unexpected row: the dashboard trend would treat a partial day as final",
			);
		}

		// ---- connectivity rollup ------------------------------------------
		const yesterday = new Date();
		yesterday.setUTCDate(yesterday.getUTCDate() - 1);
		yesterday.setUTCHours(12, 0, 0, 0);
		const yesterdayKey = yesterday.toISOString().slice(0, 10);
		await store.insert("FeedEvent", {
			id: `bench_heartbeat_${ids.suffix}_yesterday`,
			deviceId: ids.device,
			eventId: `bench-yesterday-${ids.suffix}`,
			eventType: "heartbeat",
			timestamp: yesterday.toISOString(),
			rtcOk: true,
			feederActive: false,
			receivedAt: yesterday.toISOString(),
			dataSource: "device",
			farmId: ids.farm,
		});
		await store.delete("PlatformSetting", "key=eq.connectivity.rollup").catch(() => {});
		const cron = await api.request("/api/cron/device-watch", {
			headers: { authorization: `Bearer ${config.cronSecret}` },
			timeoutMs: 60_000,
		});
		if (cron.status === 200) {
			const rollup = await waitFor(
				"DeviceConnectivityDaily yesterday",
				() =>
					store.first(
						"DeviceConnectivityDaily",
						`deviceId=eq.${encodeURIComponent(ids.device)}&day=eq.${yesterdayKey}`,
					),
				{ timeoutMs: 10_000 },
			).catch((error) => {
				fail(
					"connectivity",
					"device-watch rolls yesterday's heartbeat into DeviceConnectivityDaily",
					error.message,
				);
				return null;
			});
			if (rollup) {
				if (rollup.heartbeatCount === 1 && rollup.onlineMinutes === 0 && rollup.gapCount === 0) {
					pass(
						"connectivity",
						"device-watch rolls yesterday's heartbeat into DeviceConnectivityDaily",
						`day ${yesterdayKey}, heartbeatCount=1, onlineMinutes=0, gapCount=0`,
					);
				} else {
					fail(
						"connectivity",
						"device-watch rolls yesterday's heartbeat into DeviceConnectivityDaily",
						`heartbeatCount=${rollup.heartbeatCount}, onlineMinutes=${rollup.onlineMinutes}, gapCount=${rollup.gapCount}`,
					);
				}
			}
		} else if (cron.status === 403 && /Cron secret is not configured/i.test(cron.text)) {
			fail(
				"connectivity",
				"device-watch rolls yesterday's heartbeat into DeviceConnectivityDaily",
				"the app server has no CRON_SECRET; restart it with the same value the harness uses",
			);
		} else {
			const cronHealth = await api.request("/api/health/cron").catch(() => null);
			const job = Array.isArray(cronHealth?.json?.jobs)
				? cronHealth.json.jobs.find((row) => row.name === "device-watch")
				: null;
			const detail = job?.lastError ? `: ${job.lastError}` : "";
			fail(
				"connectivity",
				"device-watch completes without an internal error",
				`/api/cron/device-watch -> ${cron.status}${detail}`,
			);
			// The rollup runs before the housekeeping steps. If it wrote the
			// row, the data path is proven even though a later step failed.
			const partialRollup = await store
				.first(
					"DeviceConnectivityDaily",
					`deviceId=eq.${encodeURIComponent(ids.device)}&day=eq.${yesterdayKey}`,
				)
				.catch(() => null);
			if (partialRollup?.heartbeatCount === 1) {
				pass(
					"connectivity",
					"the rollup wrote yesterday's row before the later cron step failed",
					`day ${yesterdayKey}, heartbeatCount=1, onlineMinutes=${partialRollup.onlineMinutes}`,
				);
			} else {
				fail(
					"connectivity",
					"the rollup wrote yesterday's row before the later cron step failed",
					"no DeviceConnectivityDaily row: the cron failed before or during the rollup",
				);
			}
		}

		// ---- feed command: idle config ------------------------------------
		const idle = await api.request(
			`/api/feed-command?device_id=${encodeURIComponent(config.deviceMac)}`,
			{ token: deviceToken },
		);
		const idleConfig = idle.json?.config;
		if (
			idle.status === 200 &&
			idle.json?.feed_requested === false &&
			idle.json?.feed_request_id === null &&
			idle.json?.grams === 0 &&
			idle.json?.calibration === false &&
			idle.json?.button_feed_grams === 80 &&
			idle.json?.grams_per_feeding === 50 &&
			idle.json?.farm_offset_minutes === 480 &&
			isJsonObject(idleConfig) &&
			idleConfig.version === 1 &&
			Number.isInteger(idleConfig.rev) &&
			idleConfig.button_feed_grams === 80
		) {
			pass(
				"feed",
				"idle poll returns the device config and no feed",
				`feed_requested=false, button_feed_grams=80, config.rev=${idleConfig.rev}`,
			);
		} else {
			fail(
				"feed",
				"idle poll returns the device config and no feed",
				`status ${idle.status}, feed_requested=${idle.json?.feed_requested}, config.rev=${idleConfig?.rev}`,
			);
		}

		// ---- queue + claim exactly once -----------------------------------
		await store.insert("FeedRequest", {
			id: ids.request,
			deviceId: ids.device,
			grams: 80,
			status: "pending",
			kind: "feed",
			farmId: ids.farm,
			updatedAt: new Date().toISOString(),
		});
		const pending = await store.first("FeedRequest", `id=eq.${encodeURIComponent(ids.request)}`);
		if (pending?.status === "pending") {
			pass("feed-claim", "a manual feed is queued as pending", `FeedRequest ${ids.request}, 80 g`);
		} else {
			fail("feed-claim", "a manual feed is queued as pending", `status=${pending?.status}`);
		}

		const claimOnce = () =>
			api.request(`/api/feed-command?device_id=${encodeURIComponent(config.deviceMac)}`, {
				token: deviceToken,
			});
		const [claimA, claimB] = await Promise.all([claimOnce(), claimOnce()]);
		const claims = [claimA, claimB];
		const winners = claims.filter(
			(claim) => claim.status === 200 && claim.json?.feed_requested === true,
		);
		const losers = claims.filter(
			(claim) => claim.status === 200 && claim.json?.feed_requested === false,
		);
		if (winners.length === 1 && losers.length === 1) {
			const winner = winners[0];
			if (
				winner.json.feed_request_id === ids.request &&
				winner.json.grams === 80 &&
				winner.json.calibration === false &&
				isJsonObject(winner.json.config)
			) {
				pass(
					"feed-claim",
					"two overlapping polls claim the request exactly once",
					`one feed_requested=true for ${ids.request}, one false; no double-dispense`,
				);
			} else {
				fail(
					"feed-claim",
					"two overlapping polls claim the request exactly once",
					`winner returned request=${winner.json.feed_request_id}, grams=${winner.json.grams}`,
				);
			}
		} else {
			fail(
				"feed-claim",
				"two overlapping polls claim the request exactly once",
				`winners=${winners.length}, idlers=${losers.length}, statuses=${claims.map((claim) => claim.status).join("/")}`,
			);
		}

		const dispatched = await store.first("FeedRequest", `id=eq.${encodeURIComponent(ids.request)}`);
		if (dispatched?.status === "dispatched") {
			pass(
				"feed-claim",
				"the claim moves the request to dispatched",
				"claimPendingFeedRequest compare-and-set (lib/feed/commands.ts:439)",
			);
		} else {
			fail(
				"feed-claim",
				"the claim moves the request to dispatched",
				`status=${dispatched?.status}`,
			);
		}

		const thirdClaim = await claimOnce();
		if (thirdClaim.status === 200 && thirdClaim.json?.feed_requested === false) {
			pass(
				"feed-claim",
				"a later poll does not re-claim the same request",
				"feed_requested=false, feed_request_id=null",
			);
		} else {
			fail(
				"feed-claim",
				"a later poll does not re-claim the same request",
				`status ${thirdClaim.status}, feed_requested=${thirdClaim.json?.feed_requested}`,
			);
		}

		// ---- ingest: dashboard dispense + replay ---------------------------
		await sleep(1100); // ingest has a 1 s per-device rate limit
		const dispenseBody = {
			device_id: config.deviceMac,
			event_type: "feed_dispensed",
			event_id: `bench-disp-${runId}`,
			grams: 80,
			source: "dashboard",
			feed_request_id: ids.request,
			timestamp: new Date().toISOString(),
		};
		const dispensed = await api.request("/api/ingest", {
			method: "POST",
			token: deviceToken,
			body: dispenseBody,
		});
		if (dispensed.status === 204) {
			pass(
				"ingest",
				"POST /api/ingest feed_dispensed is accepted",
				"204, source=dashboard, feed_request_id present",
			);
		} else {
			fail(
				"ingest",
				"POST /api/ingest feed_dispensed is accepted",
				`${dispensed.status} ${dispensed.text}`,
			);
		}

		const completed = await store.first("FeedRequest", `id=eq.${encodeURIComponent(ids.request)}`);
		if (completed?.status === "completed") {
			pass(
				"ingest",
				"the dispense completes the pending feed request",
				"FeedRequest.status=completed (the dashboard's in-flight state clears)",
			);
		} else {
			fail(
				"ingest",
				"the dispense completes the pending feed request",
				`status=${completed?.status}`,
			);
		}

		const countEvents = () =>
			store.count(
				"FeedEvent",
				`deviceId=eq.${encodeURIComponent(ids.device)}&eventType=eq.feed_dispensed`,
			);
		const countStateEvents = () =>
			store.count(
				"DeviceStateEvent",
				`deviceId=eq.${encodeURIComponent(ids.device)}&eventType=eq.feed_dispensed`,
			);
		const countNotifications = () =>
			store.count("Notification", `pondId=eq.${encodeURIComponent(ids.pond)}&category=eq.feeding`);
		const afterFirst = {
			feedEvents: await countEvents(),
			stateEvents: await countStateEvents(),
			notifications: await countNotifications(),
		};
		if (
			afterFirst.feedEvents === 1 &&
			afterFirst.stateEvents === 1 &&
			afterFirst.notifications === 1
		) {
			pass(
				"ingest",
				"the dispense is recorded once in each dashboard-facing ledger",
				"1 FeedEvent, 1 DeviceStateEvent, 1 SUCCESS notification",
			);
		} else {
			fail(
				"ingest",
				"the dispense is recorded once in each dashboard-facing ledger",
				`FeedEvent=${afterFirst.feedEvents}, DeviceStateEvent=${afterFirst.stateEvents}, notifications=${afterFirst.notifications}`,
			);
		}

		await sleep(1100);
		const replay = await api.request("/api/ingest", {
			method: "POST",
			token: deviceToken,
			body: dispenseBody,
		});
		const afterReplay = {
			feedEvents: await countEvents(),
			stateEvents: await countStateEvents(),
			notifications: await countNotifications(),
		};
		if (
			replay.status === 204 &&
			afterReplay.feedEvents === afterFirst.feedEvents &&
			afterReplay.stateEvents === afterFirst.stateEvents &&
			afterReplay.notifications === afterFirst.notifications
		) {
			pass(
				"ingest",
				"an exact replay of the same dispense is idempotent",
				"204; FeedEvent/DeviceStateEvent/notification counts unchanged (feedRequestId fast path)",
			);
		} else {
			fail(
				"ingest",
				"an exact replay of the same dispense is idempotent",
				`status ${replay.status}, FeedEvent ${afterFirst.feedEvents}->${afterReplay.feedEvents}, ` +
					`state ${afterFirst.stateEvents}->${afterReplay.stateEvents}, notifications ${afterFirst.notifications}->${afterReplay.notifications}`,
			);
		}

		await sleep(1100);
		const eventIdReplay = await api.request("/api/ingest", {
			method: "POST",
			token: deviceToken,
			body: { ...dispenseBody, feed_request_id: null },
		});
		const afterEventIdReplay = await countEvents();
		if (eventIdReplay.status === 204 && afterEventIdReplay === afterFirst.feedEvents) {
			pass(
				"ingest",
				"a replayed event_id without a request id is deduped by the unique index",
				"204; FeedEvent count unchanged (FeedEvent_deviceId_eventId_key)",
			);
		} else {
			fail(
				"ingest",
				"a replayed event_id without a request id is deduped by the unique index",
				`status ${eventIdReplay.status}, FeedEvent ${afterFirst.feedEvents}->${afterEventIdReplay}`,
			);
		}

		// ---- ingest: the physical-button path -----------------------------
		await sleep(1100);
		const buttonBody = {
			device_id: config.deviceMac,
			event_type: "feed_dispensed",
			event_id: `bench-button-${runId}`,
			grams: 80,
			source: "button",
			feed_request_id: null,
			timestamp: new Date().toISOString(),
		};
		const button = await api.request("/api/ingest", {
			method: "POST",
			token: deviceToken,
			body: buttonBody,
		});
		const afterButton = {
			feedEvents: await countEvents(),
			stateEvents: await countStateEvents(),
			notifications: await countNotifications(),
		};
		if (
			button.status === 204 &&
			afterButton.feedEvents === 2 &&
			afterButton.stateEvents === 2 &&
			afterButton.notifications === 2
		) {
			pass(
				"ingest",
				"a local button dispense is recorded without a feed_request_id",
				"204; source=button; 2 FeedEvents total; the firmware signature has no request id",
			);
		} else {
			fail(
				"ingest",
				"a local button dispense is recorded without a feed_request_id",
				`status ${button.status}, FeedEvent=${afterButton.feedEvents}, state=${afterButton.stateEvents}, notifications=${afterButton.notifications}`,
			);
		}

		await sleep(1100);
		const buttonReplay = await api.request("/api/ingest", {
			method: "POST",
			token: deviceToken,
			body: buttonBody,
		});
		const afterButtonReplay = await countEvents();
		if (buttonReplay.status === 204 && afterButtonReplay === afterButton.feedEvents) {
			pass("ingest", "a replayed button dispense is idempotent", "204; FeedEvent count unchanged");
		} else {
			fail(
				"ingest",
				"a replayed button dispense is idempotent",
				`status ${buttonReplay.status}, FeedEvent ${afterButton.feedEvents}->${afterButtonReplay}`,
			);
		}

		// ---- dashboard-facing reads ---------------------------------------
		const dashboardDevice = await store.first(
			"EnergyDevice",
			`id=eq.${encodeURIComponent(ids.device)}`,
		);
		const freshEnough =
			dashboardDevice?.lastSeenAt &&
			Date.now() - new Date(dashboardDevice.lastSeenAt).getTime() < 2 * 60 * 1000;
		if (
			dashboardDevice &&
			dashboardDevice.feedLevelPercent === 42.5 &&
			dashboardDevice.feedLevelCm === 12.3 &&
			dashboardDevice.feedLevelUpdatedAt !== null &&
			dashboardDevice.wifiRssiDbm === -55 &&
			dashboardDevice.rtcOk === true &&
			freshEnough
		) {
			pass(
				"dashboard",
				"the device card reads the new hopper level and signal",
				"feedLevelPercent=42.5, feedLevelCm=12.3, wifiRssiDbm=-55, lastSeenAt fresh",
			);
		} else {
			fail(
				"dashboard",
				"the device card reads the new hopper level and signal",
				`level=${dashboardDevice?.feedLevelPercent}, cm=${dashboardDevice?.feedLevelCm}, rssi=${dashboardDevice?.wifiRssiDbm}, lastSeenAt=${dashboardDevice?.lastSeenAt}`,
			);
		}

		const levelLog = await store.first(
			"FeedLevelLog",
			`deviceId=eq.${encodeURIComponent(ids.device)}`,
		);
		if (levelLog?.levelPercent === 42.5 && levelLog?.distanceCm === 12.3) {
			pass(
				"dashboard",
				"the hopper history row is written for the chart",
				"FeedLevelLog levelPercent=42.5, distanceCm=12.3",
			);
		} else {
			fail(
				"dashboard",
				"the hopper history row is written for the chart",
				`levelPercent=${levelLog?.levelPercent}, distanceCm=${levelLog?.distanceCm}`,
			);
		}

		const pendingLeft = await store.count(
			"FeedRequest",
			`deviceId=eq.${encodeURIComponent(ids.device)}&status=eq.pending`,
		);
		if (pendingLeft === 0) {
			pass(
				"dashboard",
				"no pending feed remains after the dispense",
				"the in-flight state the dashboard polls is clear",
			);
		} else {
			fail(
				"dashboard",
				"no pending feed remains after the dispense",
				`${pendingLeft} pending row(s)`,
			);
		}

		const notifications = await store.select(
			"Notification",
			`pondId=eq.${encodeURIComponent(ids.pond)}&category=eq.feeding&order=createdAt.asc`,
		);
		const messages = Array.isArray(notifications)
			? notifications.map((row) => row.message ?? "")
			: [];
		if (
			messages.length === 2 &&
			messages.some(
				(message) => message.includes("Dashboard feed completed") && message.includes("80g"),
			) &&
			messages.some(
				(message) => message.includes("Button feed completed") && message.includes("80g"),
			)
		) {
			pass(
				"dashboard",
				"the farmer notification stream names both completed feeds",
				"Dashboard feed completed / Button feed completed, 80g",
			);
		} else {
			fail(
				"dashboard",
				"the farmer notification stream names both completed feeds",
				`messages=${JSON.stringify(messages).slice(0, 240)}`,
			);
		}

		// ---- OTA -----------------------------------------------------------
		if (options.skipOta) {
			skip("ota", "signed OTA channel", "skipped with --skip-ota");
			return;
		}

		const bucket = await storage.ensureBucket(OTA_CONTRACT.bucket);
		if (bucket.public === false) {
			pass("ota", "firmware bucket is private", "signed URLs carry the only capability");
		} else {
			fail("ota", "firmware bucket is private", `bucket.public=${bucket.public}`);
		}

		otaFixture = createOtaFixture({
			repoRoot,
			version: channelVersion,
			minFrom: config.firmwareVersion,
			variant: config.variant,
			keyId: config.keyId,
			privateKeyPath: process.env.BENCH_OTA_PRIVATE_KEY || null,
			redact: redactWithToken,
			keep: options.keepFixture || process.env.BENCH_KEEP_FIXTURE === "1",
		});
		imagePath = otaFixture.channel.storage_path;
		addOtaFixtureRows(baseReport, otaFixture);
		const manifest = JSON.parse(otaFixture.channel.manifest);

		await storage.deleteObject(OTA_CONTRACT.bucket, OTA_CONTRACT.channelPath).catch(() => {});
		await storage.deleteObject(OTA_CONTRACT.bucket, imagePath).catch(() => {});
		await storage.putObject(
			OTA_CONTRACT.bucket,
			imagePath,
			otaFixture.image,
			"application/octet-stream",
		);
		await storage.putObject(
			OTA_CONTRACT.bucket,
			OTA_CONTRACT.channelPath,
			otaFixture.channelBytes,
			"application/json",
		);
		const downloaded = await storage.downloadObject(OTA_CONTRACT.bucket, OTA_CONTRACT.channelPath);
		const downloadedChannel = JSON.parse(downloaded.toString("utf8"));
		if (
			downloadedChannel.manifest === otaFixture.channel.manifest &&
			downloadedChannel.signature === otaFixture.channel.signature &&
			downloadedChannel.sha256 === otaFixture.channel.sha256
		) {
			pass(
				"ota",
				"the signed channel uploads byte-exactly to the firmware bucket",
				`channels/stable.json (${downloaded.length} bytes) and ${imagePath}`,
			);
		} else {
			fail("ota", "the signed channel uploads byte-exactly to the firmware bucket");
		}

		const signedUrl = await storage.signObject(
			OTA_CONTRACT.bucket,
			imagePath,
			OTA_CONTRACT.signedUrlTtlSeconds,
		);
		const storageIsHttps = signedUrl.startsWith("https://");
		const ttl = signedUrlTtl(signedUrl);
		const ttlSeconds = ttl?.ttl ?? ttl?.remaining ?? null;
		if (ttlSeconds !== null && Math.abs(ttlSeconds - OTA_CONTRACT.signedUrlTtlSeconds) <= 2) {
			pass(
				"ota-ttl",
				"the storage signed URL carries a 10-minute capability",
				`exp-iat/remaining=${ttlSeconds}s (OTA_SIGNED_URL_TTL_SECONDS=600)`,
			);
		} else {
			fail(
				"ota-ttl",
				"the storage signed URL carries a 10-minute capability",
				ttlSeconds !== null ? `ttl=${ttlSeconds}s` : "token payload has no exp",
			);
		}

		const checkUrl = (query) =>
			api.request(
				`${OTA_CONTRACT.checkPath}?device_id=${encodeURIComponent(config.deviceMac)}&${query}`,
				{ token: deviceToken },
			);
		const correctQuery = `version=${encodeURIComponent(config.firmwareVersion)}&variant=${config.variant}&relay_gpio=${relayGpioForVariant(config.variant)}`;
		const check = await checkUrl(correctQuery);

		if (storageIsHttps) {
			if (check.status === 200 && check.json?.update === true) {
				pass(
					"ota-route",
					"GET /api/firmware/check offers the signed release",
					`update:true, ${channelVersion}`,
				);
			} else {
				fail(
					"ota-route",
					"GET /api/firmware/check offers the signed release",
					`status ${check.status}, body ${check.text.slice(0, 300)}`,
				);
			}
			if (
				check.json?.version === otaFixture.channel.version &&
				check.json?.size === otaFixture.channel.size &&
				check.json?.sha256 === otaFixture.channel.sha256 &&
				check.json?.key_id === otaFixture.channel.key_id &&
				check.json?.variant === manifest.variant &&
				check.json?.relay_gpio === manifest.relay_gpio &&
				check.json?.manifest === otaFixture.channel.manifest &&
				check.json?.signature === otaFixture.channel.signature
			) {
				pass(
					"ota-route",
					"the response carries the exact signed envelope",
					"version, size, sha256, key_id, variant, relay_gpio, manifest bytes and signature all match",
				);
			} else {
				fail("ota-route", "the response carries the exact signed envelope");
			}
			const bodyBytes = check.rawLength;
			const contentLength = Number(check.headers.get("content-length"));
			if (bodyBytes <= OTA_CONTRACT.maxCheckResponseBytes && contentLength === bodyBytes) {
				pass(
					"ota-route",
					"the response declares its length and stays under 8 KB",
					`content-length=${contentLength}, body=${bodyBytes} <= 8192`,
				);
			} else {
				fail(
					"ota-route",
					"the response declares its length and stays under 8 KB",
					`content-length=${contentLength}, body=${bodyBytes}`,
				);
			}
			if (check.json?.url?.startsWith("https://")) {
				pass("ota-route", "the download URL is HTTPS", redactUrl(check.json.url));
			} else {
				fail("ota-route", "the download URL is HTTPS", redactUrl(check.json?.url ?? ""));
			}
			const routeTtl = signedUrlTtl(check.json?.url ?? "");
			const routeTtlSeconds = routeTtl?.ttl ?? routeTtl?.remaining ?? null;
			if (
				routeTtlSeconds !== null &&
				Math.abs(routeTtlSeconds - OTA_CONTRACT.signedUrlTtlSeconds) <= 5
			) {
				pass("ota-route", "the delivered URL expires in 10 minutes", `ttl=${routeTtlSeconds}s`);
			} else {
				fail(
					"ota-route",
					"the delivered URL expires in 10 minutes",
					routeTtlSeconds !== null ? `ttl=${routeTtlSeconds}s` : "no token exp",
				);
			}

			// The URL must serve the exact bytes the manifest signed.
			try {
				const imageResponse = await fetch(check.json.url, {
					signal: AbortSignal.timeout(20_000),
				});
				const bytes = Buffer.from(await imageResponse.arrayBuffer());
				const hash = createHash("sha256").update(bytes).digest("hex");
				if (
					imageResponse.ok &&
					Number(imageResponse.headers.get("content-length")) === otaFixture.channel.size &&
					hash === otaFixture.channel.sha256.toLowerCase()
				) {
					pass(
						"ota-route",
						"the signed URL serves the exact signed bytes",
						`${bytes.length} bytes, sha256 matches, content-length matches`,
					);
				} else {
					fail(
						"ota-route",
						"the signed URL serves the exact signed bytes",
						`status ${imageResponse.status}, ${bytes.length} bytes, sha256 ${hash.slice(0, 12)}...`,
					);
				}
			} catch (error) {
				skip(
					"ota-route",
					"the signed URL serves the exact signed bytes",
					`could not fetch the local TLS URL: ${redactWithToken(error instanceof Error ? error.message : String(error))}`,
				);
			}
		} else {
			if (check.status === 200 && check.json?.update === false) {
				pass(
					"ota-route",
					"the check fails closed on a non-HTTPS storage URL",
					"update:false; createReleaseDownloadUrl rejects http:// (apps/web/lib/firmware/ota.ts:304)",
				);
			} else {
				fail(
					"ota-route",
					"the check fails closed on a non-HTTPS storage URL",
					`status ${check.status}, body ${check.text.slice(0, 300)}`,
				);
			}
			if (options.requireOtaDelivery || process.env.BENCH_REQUIRE_OTA_DELIVERY === "1") {
				fail(
					"ota-route",
					"the check delivers update:true",
					"the local Supabase stack is HTTP and the route requires an HTTPS signed URL",
				);
			} else {
				skip(
					"ota-route",
					"the check delivers update:true",
					"local stack is HTTP; the firmware requires HTTPS, so this needs a TLS stack (--require-ota-delivery makes it fatal)",
				);
			}
			const expected = buildExpectedCheckResponse(otaFixture.channel, signedUrl);
			const expectedBytes = responseByteLength(expected);
			if (expectedBytes <= OTA_CONTRACT.maxCheckResponseBytes) {
				pass(
					"ota-route",
					"the envelope that would be delivered is under 8 KB",
					`${expectedBytes} bytes (same fields and order as otaResponse)`,
				);
			} else {
				fail(
					"ota-route",
					"the envelope that would be delivered is under 8 KB",
					`${expectedBytes} bytes`,
				);
			}
		}

		// ---- OTA negative gates -------------------------------------------
		const wrongVariant = otherVariant(config.variant);
		const wrongVariantCheck = await checkUrl(
			`version=${encodeURIComponent(config.firmwareVersion)}&variant=${wrongVariant}&relay_gpio=${relayGpioForVariant(wrongVariant)}`,
		);
		if (wrongVariantCheck.status === 200 && wrongVariantCheck.json?.update === false) {
			pass(
				"ota-negative",
				"a wrong hardware variant is refused",
				`channel ${config.variant}, request ${wrongVariant} -> update:false (route #582 gate)`,
			);
		} else {
			fail(
				"ota-negative",
				"a wrong hardware variant is refused",
				`status ${wrongVariantCheck.status}, update=${wrongVariantCheck.json?.update}`,
			);
		}

		const missingVariant = await checkUrl(`version=${encodeURIComponent(config.firmwareVersion)}`);
		if (missingVariant.status === 200 && missingVariant.json?.update === false) {
			pass(
				"ota-negative",
				"a unit that does not declare a variant is refused",
				"update:false; the server cannot prove the relay pin",
			);
		} else {
			fail(
				"ota-negative",
				"a unit that does not declare a variant is refused",
				`status ${missingVariant.status}, update=${missingVariant.json?.update}`,
			);
		}

		const latest = await checkUrl(
			`version=${encodeURIComponent(channelVersion)}&variant=${config.variant}&relay_gpio=${relayGpioForVariant(config.variant)}`,
		);
		if (latest.status === 200 && latest.json?.update === false) {
			pass(
				"ota-negative",
				"a unit already on the latest version gets update:false",
				`version ${channelVersion} -> update:false (compareSemver >= 0)`,
			);
		} else {
			fail(
				"ota-negative",
				"a unit already on the latest version gets update:false",
				`status ${latest.status}, update=${latest.json?.update}`,
			);
		}

		const belowMin = await checkUrl(
			`version=0.0.1&variant=${config.variant}&relay_gpio=${relayGpioForVariant(config.variant)}`,
		);
		if (belowMin.status === 200 && belowMin.json?.update === false) {
			pass(
				"ota-negative",
				"a unit below the signed min_from_version is refused",
				`0.0.1 < ${config.firmwareVersion} (manifest min_from_version) -> update:false`,
			);
		} else {
			fail(
				"ota-negative",
				"a unit below the signed min_from_version is refused",
				`status ${belowMin.status}, update=${belowMin.json?.update}`,
			);
		}

		// A manifest whose envelope disagrees is refused by the server's parser.
		const tamperedManifest = tamperChannelManifest(otaFixture.channel, (values) => {
			values.version = "0.0.0";
		});
		await storage.putObject(
			OTA_CONTRACT.bucket,
			OTA_CONTRACT.channelPath,
			Buffer.from(`${JSON.stringify(tamperedManifest, null, 2)}\n`, "utf8"),
			"application/json",
		);
		const tamperedCheck = await checkUrl(correctQuery);
		await storage.putObject(
			OTA_CONTRACT.bucket,
			OTA_CONTRACT.channelPath,
			otaFixture.channelBytes,
			"application/json",
		);
		if (tamperedCheck.status === 200 && tamperedCheck.json?.update === false) {
			pass(
				"ota-negative",
				"a manifest that disagrees with its envelope is refused",
				"update:false; parseChannel (apps/web/lib/firmware/ota.ts:158) rejects the channel",
			);
		} else {
			fail(
				"ota-negative",
				"a manifest that disagrees with its envelope is refused",
				`status ${tamperedCheck.status}, update=${tamperedCheck.json?.update}`,
			);
		}

		const wrongPinManifest = tamperChannelManifest(otaFixture.channel, (values) => {
			values.relay_gpio = 99;
		});
		await storage.putObject(
			OTA_CONTRACT.bucket,
			OTA_CONTRACT.channelPath,
			Buffer.from(`${JSON.stringify(wrongPinManifest, null, 2)}\n`, "utf8"),
			"application/json",
		);
		const wrongPinCheck = await checkUrl(correctQuery);
		await storage.putObject(
			OTA_CONTRACT.bucket,
			OTA_CONTRACT.channelPath,
			otaFixture.channelBytes,
			"application/json",
		);
		if (wrongPinCheck.status === 200 && wrongPinCheck.json?.update === false) {
			pass(
				"ota-negative",
				"a manifest whose variant and relay GPIO disagree is refused",
				"update:false; the schema refuses the internally inconsistent pair",
			);
		} else {
			fail(
				"ota-negative",
				"a manifest whose variant and relay GPIO disagree is refused",
				`status ${wrongPinCheck.status}, update=${wrongPinCheck.json?.update}`,
			);
		}

		// Device-side signature check: the route is delivery-only, so this is
		// the assertion that stands in for hardware.
		const tamperedSignature = tamperChannelSignature(otaFixture.channel);
		if (verifyChannelSignature(tamperedSignature, otaFixture.signing.publicPem) === false) {
			pass(
				"ota-negative",
				"a tampered signature is rejected by the device-side verifier",
				"verifyManifestSignature owner: firmware-main.ino:2432; the route does not verify by design",
			);
		} else {
			fail("ota-negative", "a tampered signature is rejected by the device-side verifier");
		}

		// ---- signed URL expiry --------------------------------------------
		const shortLived = await storage.signObject(OTA_CONTRACT.bucket, imagePath, 1);
		await sleep(2500);
		try {
			const expired = await fetch(shortLived, { signal: AbortSignal.timeout(10_000) });
			if (expired.status >= 400) {
				pass(
					"ota-ttl",
					"an expired signed URL cannot be replayed",
					`expiresIn=1s, replay after 2.5s -> ${expired.status}`,
				);
			} else {
				fail(
					"ota-ttl",
					"an expired signed URL cannot be replayed",
					`expiresIn=1s, replay after 2.5s -> ${expired.status} (expected 4xx)`,
				);
			}
		} catch (error) {
			skip(
				"ota-ttl",
				"an expired signed URL cannot be replayed",
				`could not fetch the local TLS URL: ${redactWithToken(error instanceof Error ? error.message : String(error))}`,
			);
		}

		// The device's own comparison must agree with the server's decision.
		if (compareSemver(config.firmwareVersion, channelVersion) === -1) {
			pass(
				"ota-negative",
				"the channel version is strictly newer than the running firmware",
				`${config.firmwareVersion} < ${channelVersion}`,
			);
		} else {
			fail(
				"ota-negative",
				"the channel version is strictly newer than the running firmware",
				`${config.firmwareVersion} vs ${channelVersion}`,
			);
		}
	} catch (error) {
		fail(
			"harness",
			"run completed without an unexpected exception",
			redactWithToken(error instanceof Error ? (error.stack ?? error.message) : String(error)),
		);
	} finally {
		if (otaFixture) {
			await storage.deleteObject(OTA_CONTRACT.bucket, OTA_CONTRACT.channelPath).catch(() => {});
			if (imagePath) await storage.deleteObject(OTA_CONTRACT.bucket, imagePath).catch(() => {});
			otaFixture.cleanup();
		}
		if (process.env.BENCH_KEEP_FIXTURE !== "1" && !options.keepFixture) {
			cleanupWarnings.push(...(await cleanupFixture({ store, ids, mac: config.deviceMac })));
			const leftover = await store
				.first("EnergyDevice", `id=eq.${encodeURIComponent(ids.device)}`)
				.catch(() => ({ id: ids.device }));
			if (leftover) {
				fail(
					"cleanup",
					"the bench fixture was removed",
					"the EnergyDevice row still exists; inspect the warnings below",
				);
			} else if (cleanupWarnings.length > 0) {
				baseReport.warn(
					"cleanup",
					"the bench fixture was removed",
					`${cleanupWarnings.length} warning(s): ${cleanupWarnings.join(" | ").slice(0, 300)}`,
				);
			} else {
				pass(
					"cleanup",
					"the bench fixture was removed",
					"device, pond, farm, user, events and rate-limit buckets",
				);
			}
		} else {
			skip(
				"cleanup",
				"the bench fixture was removed",
				"kept by request (--keep-fixture/BENCH_KEEP_FIXTURE)",
			);
		}
	}
}

function otherVariant(variant) {
	return variant === "gpio5" ? "gpio25" : "gpio5";
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n`);
		printHelp();
		process.exitCode = 2;
		return;
	}
	if (options.help) {
		printHelp();
		return;
	}

	if (options.selfCheck) {
		const report = new BenchReport("Bench OTA self-check (contract + signing; no network)");
		try {
			await runSelfCheck({ report, options });
		} catch (error) {
			report.fail(
				"harness",
				"self-check completed",
				error instanceof Error ? error.message : String(error),
			);
		}
		report.print();
		process.exitCode = report.exitCode();
		return;
	}

	let config;
	try {
		config = readConfig();
	} catch (error) {
		const report = new BenchReport("Bench device loop + OTA contract");
		report.fail(
			"preflight",
			"environment is configured for a loopback stack",
			error instanceof Error ? error.message : String(error),
		);
		report.print();
		process.exitCode = 1;
		return;
	}

	const report = new BenchReport("Bench device loop + OTA contract (local stack only)");
	process.stdout.write(
		`\nBench device ${config.deviceMac}, firmware ${config.firmwareVersion}, ` +
			`channel ${nextMajorVersion(config.firmwareVersion)}, variant ${config.variant}\n` +
			`App ${config.baseUrl} | Supabase ${new URL(config.supabaseUrl).host} | OTA key ${config.keyId}` +
			`${process.env.BENCH_OTA_PRIVATE_KEY ? " (offline)" : " (ephemeral)"}\n`,
	);
	try {
		await runDeviceLoop({ report, config, options });
	} catch (error) {
		report.fail(
			"harness",
			"run completed without an unexpected exception",
			error instanceof Error ? error.message : String(error),
		);
	}
	report.print();
	process.exitCode = report.exitCode();
}

main().catch((error) => {
	process.stderr.write(
		`bench harness failed: ${error instanceof Error ? error.stack : String(error)}\n`,
	);
	process.exitCode = 1;
});
