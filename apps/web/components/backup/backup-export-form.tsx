"use client";

import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import { useRouter } from "@/i18n/routing";
import { BACKUP_STEP_UP_REQUIRED_CODE, BACKUP_TRAILER_MARKER } from "@/lib/backup/constants";
import { cn } from "@/lib/utils";
import { Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";

/**
 * Download control for a database export (issue #353).
 *
 * A POST (not a link) keeps the reason out of URLs and access logs, and lets a
 * non-2xx answer be shown as a readable message instead of a browser error
 * page. The response is streamed by the server; this component only collects
 * the bytes so it can verify the checksum before saving.
 *
 * Step-up is handled the platform way: the route answers
 * `details.code = "step_up_required"`, the existing dialog re-checks the
 * password, and the same export is retried automatically.
 */

export interface BackupExportFormProps {
	endpoint: string;
	/** Translation namespace: `dashboard.adminBackup` or `superadmin.backup`. */
	namespace: string;
	/** A reason is mandatory for a full database export. */
	requiresReason: boolean;
	requiresStepUp: boolean;
	rowLimit: number;
	sizeLimitMb: number;
}

function filenameFrom(disposition: string | null): string | null {
	if (!disposition) return null;
	const match = /filename="([^"]+)"/.exec(disposition);
	return match?.[1] ?? null;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
	if (needle.length === 0 || haystack.length < needle.length) return -1;
	const last = haystack.length - needle.length;
	for (let index = 0; index <= last; index += 1) {
		let matched = true;
		for (let offset = 0; offset < needle.length; offset += 1) {
			if (haystack[index + offset] !== needle[offset]) {
				matched = false;
				break;
			}
		}
		if (matched) return index;
	}
	return -1;
}

/**
 * SHA-256 of the payload: every byte before the trailer marker, exactly the
 * range the server hashed. `null` when the marker is missing (a truncated
 * download) or when Web Crypto is unavailable.
 */
async function payloadChecksum(blob: Blob): Promise<string | null> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) return null;
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const marker = new TextEncoder().encode(`\n${BACKUP_TRAILER_MARKER}`);
	const boundary = indexOfBytes(bytes, marker);
	if (boundary < 0) return null;
	const digest = await subtle.digest("SHA-256", bytes.subarray(0, boundary));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.rel = "noopener";
	document.body.append(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

type Result = { filename: string; sha256: string | null; bytes: number };

export function BackupExportForm({
	endpoint,
	namespace,
	requiresReason,
	requiresStepUp,
	rowLimit,
	sizeLimitMb,
}: BackupExportFormProps) {
	const t = useTranslations(namespace);
	const router = useRouter();
	const fieldId = useId();
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<Result | null>(null);
	const [stepUpOpen, setStepUpOpen] = useState(false);
	const [isPending, startTransition] = useTransition();

	const runExport = async (submittedReason: string) => {
		setError(null);
		setResult(null);
		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ reason: submittedReason }),
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as {
					error?: { message?: unknown; details?: { code?: unknown } };
				} | null;
				if (payload?.error?.details?.code === BACKUP_STEP_UP_REQUIRED_CODE) {
					setStepUpOpen(true);
					return;
				}
				setError(typeof payload?.error?.message === "string" ? payload.error.message : t("failed"));
				return;
			}

			const blob = await response.blob();
			const filename = filenameFrom(response.headers.get("content-disposition")) ?? "backup.sql";
			const sha256 = await payloadChecksum(blob);
			saveBlob(blob, filename);
			setResult({ filename, sha256, bytes: blob.size });
			router.refresh();
		} catch {
			setError(t("failed"));
		}
	};

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (requiresReason && reason.trim().length < 10) {
			setError(t("reasonRequired"));
			return;
		}
		startTransition(async () => {
			await runExport(reason.trim());
		});
	};

	return (
		<div className="space-y-4">
			<form onSubmit={submit} className="space-y-3">
				{requiresReason && (
					<div>
						<label
							htmlFor={fieldId}
							className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#3D5568] dark:text-gray-300"
						>
							{t("reasonLabel")}
						</label>
						<textarea
							id={fieldId}
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							disabled={isPending}
							rows={2}
							maxLength={500}
							aria-describedby={`${fieldId}-hint`}
							className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-[#0A3D62] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:ring-offset-1 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
						/>
						<p
							id={`${fieldId}-hint`}
							className="mt-1 text-[11px] text-[#3D5568] dark:text-gray-400"
						>
							{t("reasonHint")}
						</p>
					</div>
				)}

				<button
					type="submit"
					disabled={isPending}
					aria-busy={isPending}
					className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-[#9A3412] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:outline-[#8fc0ea]"
				>
					{isPending ? (
						<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
					) : (
						<Download className="h-4 w-4" aria-hidden="true" />
					)}
					{isPending ? t("exporting") : t("exportButton")}
				</button>

				<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
					{t("sizeLimitHint", { rows: rowLimit, mb: sizeLimitMb })}
				</p>
			</form>

			{error && (
				<p
					role="alert"
					className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-[#C42B3A] dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
				>
					{error}
				</p>
			)}

			{result && (
				<output
					className={cn(
						"block rounded-xl border px-4 py-3 text-xs font-bold",
						result.sha256
							? "border-green-200 bg-green-50 text-[#1E7B34] dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300"
							: "border-amber-300 bg-amber-50 text-[#B54708] dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
					)}
				>
					{result.sha256
						? t("downloadBody", {
								filename: result.filename,
								sha256: result.sha256,
							})
						: t("incomplete", { filename: result.filename })}
				</output>
			)}

			{requiresStepUp && (
				<StepUpDialog
					open={stepUpOpen}
					actionLabel={t("stepUpAction")}
					onClose={() => setStepUpOpen(false)}
					onVerified={() => {
						setStepUpOpen(false);
						startTransition(async () => {
							await runExport(reason.trim());
						});
					}}
				/>
			)}
		</div>
	);
}
