import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Round-trip for scripts/ota/sign-release.mjs.
 *
 * Keys are generated inside this test with node:crypto and never touch the
 * real signing keys or firmware/keys (which hold only the committed public
 * PEMs). The script signs the exact manifest string; the assertions verify
 * that string with the throwaway public key, as the firmware would.
 */

const cwd = process.cwd();
const repoRoot = existsSync(join(cwd, "firmware")) ? cwd : join(cwd, "..", "..");
const scriptPath = join(repoRoot, "scripts", "ota", "sign-release.mjs");
const firmwareSource = readFileSync(
	join(repoRoot, "firmware", "firmware-main", "firmware-main.ino"),
	"utf8",
);

const MAC_A = "A4:CF:12:7E:3B:09";
const MAC_B = "11:22:33:44:55:66";

let workDir: string;
let privatePem: string;
let publicPem: string;
let binPath: string;

function writeKeyPair(name: string) {
	const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
	const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
	const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
	const privPath = join(workDir, `${name}-private.pem`);
	const pubPath = join(workDir, `${name}-public.pem`);
	writeFileSync(privPath, priv, "utf8");
	writeFileSync(pubPath, pub, "utf8");
	return { priv, pub, privPath, pubPath };
}

function runScript(args: string[]) {
	return spawnSync(process.execPath, [scriptPath, ...args], {
		encoding: "utf8",
		cwd: workDir,
	});
}

function embeddedPem(constant: string): string {
	const match = new RegExp(`${constant} = R"KEY\\(\\r?\\n([\\s\\S]*?)\\)KEY";`).exec(
		firmwareSource,
	);
	expect(match, `${constant} must stay embedded in the firmware`).not.toBeNull();
	return (match?.[1] ?? "").replace(/\r\n/g, "\n").trim();
}

describe("scripts/ota/sign-release.mjs", () => {
	beforeAll(() => {
		workDir = mkdtempSync(join(tmpdir(), "ota-sign-"));
		const keys = writeKeyPair("throwaway");
		privatePem = keys.priv;
		publicPem = keys.pub;
		binPath = join(workDir, "firmware.bin");
		writeFileSync(binPath, Buffer.from("fake esp32 image bytes for the signing round trip"));
	});

	afterAll(() => {
		rmSync(workDir, { recursive: true, force: true });
	});

	it("signs the exact manifest string and writes channels/stable.json", () => {
		const keys = writeKeyPair("roundtrip");
		const outDir = join(workDir, "out-roundtrip");
		const result = runScript([
			"--bin",
			binPath,
			"--version",
			"1.4.1",
			"--key",
			keys.privPath,
			"--key-id",
			"primary",
			"--min-from",
			"1.4.0",
			"--targets",
			`${MAC_A.toLowerCase()},${MAC_B}`,
			"--public-key",
			keys.pubPath,
			"--out",
			outDir,
		]);

		expect(result.status, result.stderr).toBe(0);
		// The private key is never printed, not even partially.
		expect(result.stdout).not.toContain("PRIVATE KEY");
		expect(result.stdout).not.toContain(keys.priv.trim());
		expect(result.stdout).toContain("releases/1.4.1/firmware.bin");
		expect(result.stdout).toContain("channels/stable.json");

		const channelPath = join(outDir, "channels", "stable.json");
		const channel = JSON.parse(readFileSync(channelPath, "utf8")) as {
			version: string;
			storage_path: string;
			size: number;
			sha256: string;
			manifest: string;
			signature: string;
			key_id: string;
			targets: string[] | "*";
		};

		const image = readFileSync(binPath);
		expect(channel.version).toBe("1.4.1");
		expect(channel.storage_path).toBe("releases/1.4.1/firmware.bin");
		expect(channel.size).toBe(image.length);
		expect(channel.sha256).toBe(createHash("sha256").update(image).digest("hex"));
		expect(channel.key_id).toBe("primary");
		expect(channel.targets).toEqual([MAC_A, MAC_B]);

		// The firmware parses `manifest` as JSON and verifies the signature over
		// the untouched string.
		const manifest = JSON.parse(channel.manifest) as Record<string, unknown>;
		expect(manifest).toEqual({
			board: "wroom32u",
			key_id: "primary",
			min_from_version: "1.4.0",
			sha256: channel.sha256,
			size: channel.size,
			version: "1.4.1",
		});

		const publicKey = createPublicKey(keys.pub);
		const signature = Buffer.from(channel.signature, "base64");
		expect(verify("sha256", Buffer.from(channel.manifest, "utf8"), publicKey, signature)).toBe(
			true,
		);

		// One changed byte must invalidate it, exactly like the device check.
		const tampered = channel.manifest.replace("1.4.1", "1.4.2");
		expect(verify("sha256", Buffer.from(tampered, "utf8"), publicKey, signature)).toBe(false);
	});

	it('writes targets "*" for --targets all', () => {
		const keys = writeKeyPair("all-targets");
		const outDir = join(workDir, "out-all");
		const result = runScript([
			"--bin",
			binPath,
			"--version",
			"1.4.1",
			"--key",
			keys.privPath,
			"--key-id",
			"primary",
			"--targets",
			"all",
			"--public-key",
			keys.pubPath,
			"--out",
			outDir,
		]);
		expect(result.status, result.stderr).toBe(0);

		const channel = JSON.parse(readFileSync(join(outDir, "channels", "stable.json"), "utf8")) as {
			targets: unknown;
			manifest: string;
		};
		expect(channel.targets).toBe("*");
		expect(JSON.parse(channel.manifest)).not.toHaveProperty("min_from_version");
	});

	it("refuses to write when the private key does not match the public PEM", () => {
		const keys = writeKeyPair("mismatch-private");
		const other = writeKeyPair("mismatch-public");
		const outDir = join(workDir, "out-mismatch");

		const result = runScript([
			"--bin",
			binPath,
			"--version",
			"1.4.1",
			"--key",
			keys.privPath,
			"--key-id",
			"primary",
			"--targets",
			"all",
			"--public-key",
			other.pubPath,
			"--out",
			outDir,
		]);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("does not verify");
		expect(existsSync(join(outDir, "channels", "stable.json"))).toBe(false);
	});

	it("rejects a min-from newer than the release version", () => {
		const keys = writeKeyPair("bad-min-from");
		const outDir = join(workDir, "out-bad-min-from");
		const result = runScript([
			"--bin",
			binPath,
			"--version",
			"1.4.1",
			"--key",
			keys.privPath,
			"--key-id",
			"primary",
			"--min-from",
			"1.5.0",
			"--public-key",
			keys.pubPath,
			"--out",
			outDir,
		]);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("newer than --version");
		expect(existsSync(join(outDir, "channels", "stable.json"))).toBe(false);
	});

	it("rejects an invalid target MAC without writing a channel", () => {
		const keys = writeKeyPair("bad-mac");
		const outDir = join(workDir, "out-bad-mac");
		const result = runScript([
			"--bin",
			binPath,
			"--version",
			"1.4.1",
			"--key",
			keys.privPath,
			"--key-id",
			"primary",
			"--targets",
			"not-a-mac",
			"--public-key",
			keys.pubPath,
			"--out",
			outDir,
		]);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("invalid MAC");
		expect(existsSync(join(outDir, "channels", "stable.json"))).toBe(false);
	});

	it("rejects an image larger than the OTA slot", () => {
		const keys = writeKeyPair("too-big");
		const hugePath = join(workDir, "huge.bin");
		mkdirSync(workDir, { recursive: true });
		writeFileSync(hugePath, Buffer.alloc(1_966_081));
		const result = runScript([
			"--bin",
			hugePath,
			"--version",
			"1.4.1",
			"--key",
			keys.privPath,
			"--key-id",
			"primary",
			"--public-key",
			keys.pubPath,
			"--out",
			join(workDir, "out-big"),
		]);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("1966080");
	});

	it("committed public PEMs match the keys embedded in the firmware", () => {
		for (const [keyId, constant] of [
			["primary", "OTA_KEY_PRIMARY_PEM"],
			["spare", "OTA_KEY_SPARE_PEM"],
		] as const) {
			const committed = readFileSync(
				join(repoRoot, "firmware", "keys", `pakaonai-ota-${keyId}-public.pem`),
				"utf8",
			)
				.replace(/\r\n/g, "\n")
				.trim();
			expect(committed).toBe(embeddedPem(constant));

			const key = createPublicKey(committed);
			expect(key.asymmetricKeyType).toBe("ec");
			expect(key.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
		}
	});

	it("does not leak the throwaway private key in any written file", () => {
		// The round-trip test above already used this key; guard against a future
		// change that copies key material into the channel file or output.
		expect(privatePem).toContain("PRIVATE KEY");
		expect(publicPem).toContain("PUBLIC KEY");
		const channelPath = join(workDir, "out-roundtrip", "channels", "stable.json");
		if (existsSync(channelPath)) {
			expect(readFileSync(channelPath, "utf8")).not.toContain("PRIVATE KEY");
		}
	});
});
