#!/usr/bin/env node
// Demo-only heartbeat simulator. Posts a realistic ESP32 heartbeat so the
// device stays inside the 15-minute online window for the whole demo.
// Never runs against production: point DEMO_BASE_URL at the local server.

const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const DEVICE_TOKEN = process.env.DEMO_DEVICE_TOKEN ?? "demo-token-dev-only-001";
const DEVICE_MAC = process.env.DEMO_DEVICE_MAC ?? "DE:AD:DE:MO:00:01";
const INTERVAL_MS = Number(process.env.DEMO_HEARTBEAT_MS ?? 60_000);

let level = Number(process.env.DEMO_START_LEVEL ?? 82);
let waterTemp = 27.2;
let stopping = false;

function nextLevel() {
	const drift = (Math.random() * 2 - 1) * 0.6;
	level = Math.min(95, Math.max(40, level + drift));
	return Number(level.toFixed(1));
}

function cmForPercent(percent) {
	return Number((5 + (95 - percent) * 0.35).toFixed(1));
}

async function sendHeartbeat() {
	const percent = nextLevel();
	waterTemp = Math.min(29.5, Math.max(26.5, waterTemp + (Math.random() * 2 - 1) * 0.2));
	const body = {
		device_id: DEVICE_MAC,
		event_type: "heartbeat",
		timestamp: new Date().toISOString(),
		rtc_ok: true,
		feeder_active: false,
		feed_level_percent: percent,
		feed_level_cm: cmForPercent(percent),
		water_temp_c: Number(waterTemp.toFixed(1)),
		water_temp_ok: true,
	};

	try {
		const response = await fetch(`${BASE_URL}/api/ingest`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-device-token": DEVICE_TOKEN,
			},
			body: JSON.stringify(body),
		});
		const text = await response.text();
		const time = new Date().toLocaleTimeString();
		if (response.ok) {
			console.log(
				`[heartbeat] ${time}  ${response.status}  feed=${percent}%  temp=${body.water_temp_c}C`,
			);
		} else {
			console.error(`[heartbeat] ${time}  ${response.status}  ${text.slice(0, 200)}`);
		}
	} catch (error) {
		console.error(`[heartbeat] ${new Date().toLocaleTimeString()}  request failed:`, error.message);
	}
}

async function main() {
	console.log(`Demo heartbeat -> ${BASE_URL}  device=${DEVICE_MAC}  every ${INTERVAL_MS / 1000}s`);
	console.log("Press Ctrl+C to stop.\n");
	await sendHeartbeat();
	const timer = setInterval(() => {
		if (!stopping) void sendHeartbeat();
	}, INTERVAL_MS);

	process.on("SIGINT", () => {
		stopping = true;
		clearInterval(timer);
		console.log("\n[heartbeat] stopped");
		process.exit(0);
	});
}

void main();
