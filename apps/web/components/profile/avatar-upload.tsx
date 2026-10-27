"use client";

import { UserAvatar } from "@/components/user-avatar";
import { useRouter } from "@/i18n/routing";
import type { AvatarErrorCode } from "@/lib/actions/profile-avatar";
import { removeAvatar, uploadAvatar } from "@/lib/actions/profile-avatar";
import { AVATAR_MAX_BYTES, AVATAR_TARGET_PX } from "@/lib/avatar-image";
import { cn } from "@/lib/utils";
import { ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Upload / replace / remove the signed-in user's own picture (#198, E20).
 *
 * The file never leaves the browser as-is: it is centre-cropped to a square and
 * re-encoded to a 512 px WebP on a canvas (no new dependency), previewed, and
 * only uploaded when the user confirms. The server action validates the bytes
 * again and owns the target account.
 */

const ACCEPTED: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);
const ACCEPT_ATTRIBUTE = "image/jpeg,image/png,image/webp";

const focusRing =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900";

const primaryButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-4 text-sm font-black text-white transition-colors hover:bg-[#9A3412] disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#0A3D62]/20 bg-white px-4 text-sm font-black text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700";
const dangerButton =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#C42B3A]/30 bg-white px-4 text-sm font-black text-[#C42B3A] transition-colors hover:bg-[#FDE8EA] disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/40";

/**
 * Centre-crop to a square and encode at `AVATAR_TARGET_PX`.
 * Throws for an image the browser cannot decode or encode.
 */
async function cropToSquareWebp(file: File): Promise<Blob> {
	const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
	try {
		const side = Math.min(bitmap.width, bitmap.height);
		if (!Number.isFinite(side) || side <= 0) throw new Error("empty image");
		const sourceX = Math.max(0, Math.floor((bitmap.width - side) / 2));
		const sourceY = Math.max(0, Math.floor((bitmap.height - side) / 2));

		const canvas = document.createElement("canvas");
		canvas.width = AVATAR_TARGET_PX;
		canvas.height = AVATAR_TARGET_PX;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("canvas unavailable");
		context.imageSmoothingQuality = "high";
		context.drawImage(
			bitmap,
			sourceX,
			sourceY,
			side,
			side,
			0,
			0,
			AVATAR_TARGET_PX,
			AVATAR_TARGET_PX,
		);

		const blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, "image/webp", 0.9);
		});
		if (!blob) throw new Error("encode failed");
		return blob;
	} finally {
		// `close` is not in every DOM lib; guard instead of widening the types.
		(bitmap as ImageBitmap & { close?: () => void }).close?.();
	}
}

export function AvatarUpload({
	avatarUrl,
	name,
	canEdit,
}: {
	avatarUrl: string | null;
	name: string | null;
	canEdit: boolean;
}) {
	const t = useTranslations("dashboard.profileSettings.avatar");
	const router = useRouter();

	const inputRef = useRef<HTMLInputElement>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [draft, setDraft] = useState<Blob | null>(null);
	const [pending, setPending] = useState<"saving" | "removing" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [confirmRemove, setConfirmRemove] = useState(false);

	const errors: Record<AvatarErrorCode, string> = {
		not_authenticated: t("errors.notAuthenticated"),
		not_allowed: t("errors.notAllowed"),
		empty: t("errors.empty"),
		too_large: t("errors.tooLarge"),
		invalid_type: t("errors.invalidType"),
		invalid_dimensions: t("errors.invalidDimensions"),
		upload_failed: t("errors.uploadFailed"),
		save_failed: t("errors.saveFailed"),
	};

	// Object URLs survive until the draft is replaced, saved or unmounted.
	useEffect(() => {
		const current = previewUrl;
		return () => {
			if (current) URL.revokeObjectURL(current);
		};
	}, [previewUrl]);

	function clearDraft() {
		setDraft(null);
		setPreviewUrl(null);
		if (inputRef.current) inputRef.current.value = "";
	}

	async function handleFile(file: File | undefined) {
		if (!file) return;
		setError(null);
		setNotice(null);
		setConfirmRemove(false);

		// Some browsers report an empty type; the server still checks the bytes.
		if (file.type && !ACCEPTED.has(file.type)) {
			setError(errors.invalid_type);
			return;
		}
		if (file.size > AVATAR_MAX_BYTES) {
			setError(errors.too_large);
			return;
		}

		try {
			const cropped = await cropToSquareWebp(file);
			setDraft(cropped);
			setPreviewUrl(URL.createObjectURL(cropped));
		} catch {
			setError(errors.invalid_type);
		}
	}

	async function handleSave() {
		if (!draft) return;
		setPending("saving");
		setError(null);
		setNotice(null);
		try {
			const formData = new FormData();
			formData.set("avatar", new File([draft], "avatar", { type: draft.type || "image/webp" }));
			const result = await uploadAvatar(formData);
			if ("error" in result) {
				setError(errors[result.error] ?? errors.save_failed);
				return;
			}
			clearDraft();
			setNotice(t("saved"));
			toast.success(t("saved"));
			router.refresh();
		} catch {
			setError(errors.upload_failed);
		} finally {
			setPending(null);
		}
	}

	async function handleRemove() {
		setPending("removing");
		setError(null);
		setNotice(null);
		try {
			const result = await removeAvatar();
			if ("error" in result) {
				setError(errors[result.error] ?? errors.save_failed);
				return;
			}
			clearDraft();
			setConfirmRemove(false);
			setNotice(t("removed"));
			toast.success(t("removed"));
			router.refresh();
		} catch {
			setError(errors.save_failed);
		} finally {
			setPending(null);
		}
	}

	const shownUrl = previewUrl ?? avatarUrl;
	const busy = pending !== null;
	const canRemove = canEdit && !previewUrl && Boolean(avatarUrl);

	return (
		<div className="flex flex-col gap-5 sm:flex-row sm:items-start">
			<div className="flex flex-col items-center gap-2">
				<UserAvatar
					src={shownUrl}
					name={name}
					size="lg"
					className="h-24 w-24 rounded-3xl bg-[#0A3D62] text-2xl shadow-sm"
				/>
				{previewUrl && (
					<p className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-400">
						{t("previewLabel")}
					</p>
				)}
			</div>

			<div className="min-w-0 flex-1 space-y-3">
				<p className="text-xs leading-relaxed text-[#3D5568] dark:text-gray-400">{t("hint")}</p>

				{!canEdit ? (
					<p className="rounded-xl border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-xs font-bold text-[#3D5568] dark:border-gray-700/60 dark:bg-gray-800/60 dark:text-gray-300">
						{t("readOnly")}
					</p>
				) : (
					<>
						<input
							ref={inputRef}
							id="profile-avatar-file"
							type="file"
							accept={ACCEPT_ATTRIBUTE}
							className="sr-only"
							tabIndex={-1}
							aria-hidden="true"
							onChange={(event) => {
								void handleFile(event.target.files?.[0]);
							}}
						/>

						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								disabled={busy}
								onClick={() => {
									setError(null);
									setNotice(null);
									inputRef.current?.click();
								}}
								className={cn(draft || !avatarUrl ? primaryButton : secondaryButton, focusRing)}
							>
								<ImagePlus aria-hidden="true" className="h-4 w-4" />
								{avatarUrl ? t("replace") : t("choose")}
							</button>

							{draft && (
								<>
									<button
										type="button"
										disabled={busy}
										aria-busy={pending === "saving"}
										onClick={handleSave}
										className={cn(primaryButton, focusRing)}
									>
										{pending === "saving" && (
											<Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
										)}
										{pending === "saving" ? t("saving") : t("save")}
									</button>
									<button
										type="button"
										disabled={busy}
										onClick={clearDraft}
										className={cn(secondaryButton, focusRing)}
									>
										<X aria-hidden="true" className="h-4 w-4" />
										{t("cancel")}
									</button>
								</>
							)}

							{canRemove &&
								(confirmRemove ? (
									<>
										<button
											type="button"
											disabled={busy}
											aria-busy={pending === "removing"}
											onClick={handleRemove}
											className={cn(dangerButton, focusRing)}
										>
											{pending === "removing" && (
												<Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
											)}
											{pending === "removing" ? t("removing") : t("confirmRemove")}
										</button>
										<button
											type="button"
											disabled={busy}
											onClick={() => setConfirmRemove(false)}
											className={cn(secondaryButton, focusRing)}
										>
											{t("cancel")}
										</button>
									</>
								) : (
									<button
										type="button"
										disabled={busy}
										onClick={() => setConfirmRemove(true)}
										className={cn(dangerButton, focusRing)}
									>
										<Trash2 aria-hidden="true" className="h-4 w-4" />
										{t("remove")}
									</button>
								))}
						</div>
					</>
				)}

				{error && (
					<p
						role="alert"
						className="rounded-xl border border-[#C42B3A]/30 bg-[#FDE8EA] px-3 py-2 text-xs font-bold text-[#C42B3A] dark:bg-red-950/40 dark:text-red-300"
					>
						{error}
					</p>
				)}
				{notice && (
					<output className="block text-xs font-bold text-[#1E7B34] dark:text-green-300">
						{notice}
					</output>
				)}
			</div>
		</div>
	);
}
