"use client";

import {
	type UserPermissionState,
	getUserPermissionState,
	setUserPermission,
} from "@/lib/actions/admin";
import type { Permission } from "@/lib/auth/permissions";
import { KeyRound, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface UserPermissionsDialogProps {
	userId: string;
	userName: string;
	/** Every permission the server knows about; passed in so the client never imports the server auth module. */
	permissions: readonly Permission[];
	/** True when the row belongs to the signed-in admin, which locks their own `manage_members`. */
	isSelf: boolean;
}

/**
 * `requireRole` redirects an unauthorized caller by throwing a control-flow
 * error with a `NEXT_REDIRECT` digest. Swallowing it here would turn a working
 * redirect into a generic error the admin cannot act on.
 */
function isRedirectError(error: unknown): boolean {
	if (typeof error !== "object" || error === null || !("digest" in error)) return false;
	const { digest } = error as { digest?: unknown };
	return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/** Stored overrides win over the role defaults; an override always records a grant or a denial. */
function isGranted(permission: Permission, state: UserPermissionState): boolean {
	const override = state.overrides.find((row) => row.permission === permission);
	if (override) return override.granted;
	return state.defaults.includes(permission);
}

function draftFrom(
	state: UserPermissionState,
	permissions: readonly Permission[],
): Record<string, boolean> {
	const next: Record<string, boolean> = {};
	for (const permission of permissions) {
		next[permission] = isGranted(permission, state);
	}
	return next;
}

/**
 * Per-member permission editor.
 *
 * Every checkbox edit is local draft state: nothing is written until "Save
 * changes" is pressed, and each changed permission is then applied one at a
 * time through `setUserPermission`. If a write fails partway, the dialog
 * re-reads the stored state instead of pretending the draft was applied.
 */
export function UserPermissionsDialog({
	userId,
	userName,
	permissions,
	isSelf,
}: UserPermissionsDialogProps) {
	const t = useTranslations("dashboard.adminUsers");
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [state, setState] = useState<UserPermissionState | null>(null);
	const [draft, setDraft] = useState<Record<string, boolean>>({});

	function reset() {
		setError(null);
		setState(null);
		setDraft({});
	}

	function handleClose() {
		if (saving) return;
		setOpen(false);
		reset();
	}

	useEffect(() => {
		if (!open) return;

		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape" || saving) return;
			setOpen(false);
			setError(null);
			setState(null);
			setDraft({});
		}

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, saving]);

	async function handleOpen() {
		setOpen(true);
		reset();
		setLoading(true);

		try {
			const result = await getUserPermissionState(userId);
			if (!result.success) {
				setError(result.error);
				return;
			}
			setState(result);
			setDraft(draftFrom(result, permissions));
		} catch (e) {
			if (isRedirectError(e)) throw e;
			setError(t("loadError"));
		} finally {
			setLoading(false);
		}
	}

	async function refreshStoredState() {
		try {
			const result = await getUserPermissionState(userId);
			if (!result.success) return;
			setState(result);
			setDraft(draftFrom(result, permissions));
		} catch {
			// The original error is already on screen; a failed refresh must not replace it.
		}
	}

	async function handleSave() {
		if (!state || saving) return;

		const changes = permissions.filter(
			(permission) => draft[permission] !== isGranted(permission, state),
		);
		if (changes.length === 0) {
			handleClose();
			return;
		}

		setSaving(true);
		setError(null);

		let latest = state;
		try {
			for (const permission of changes) {
				const result = await setUserPermission(userId, permission, draft[permission] === true);
				if (!result.success) {
					setError(result.error);
					// Earlier permissions in the loop may already be stored, so show
					// what the server actually holds rather than the unchecked draft.
					await refreshStoredState();
					return;
				}
				latest = result;
			}

			setState(latest);
			setDraft(draftFrom(latest, permissions));
			toast.success(t("saveSuccess"));
			setOpen(false);
		} catch (e) {
			if (isRedirectError(e)) throw e;
			setError(t("saveError"));
			await refreshStoredState();
		} finally {
			setSaving(false);
		}
	}

	const dirty =
		state !== null &&
		permissions.some((permission) => draft[permission] !== isGranted(permission, state));

	return (
		<>
			<button
				type="button"
				onClick={handleOpen}
				aria-label={`${t("permissionsButton")} — ${userName}`}
				className="inline-flex items-center gap-1.5 rounded-xl border border-[#0A3D62]/20 px-3 py-2 text-xs font-black text-[#0A3D62] hover:bg-[#F4F7F6] transition-colors"
			>
				<KeyRound className="h-3.5 w-3.5" />
				{t("permissionsButton")}
			</button>

			{open && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) handleClose();
					}}
				>
					<dialog
						open
						aria-modal="true"
						aria-labelledby="user-permissions-title"
						className="static max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[32px] border border-gray-200 bg-white p-6 shadow-2xl md:p-8"
					>
						<div className="flex items-start justify-between gap-4">
							<div>
								<h2
									id="user-permissions-title"
									className="text-xl font-black uppercase tracking-tight text-[#0A3D62] md:text-2xl"
								>
									{t("permissionsTitle", { name: userName })}
								</h2>
								<p className="mt-2 text-sm leading-relaxed text-[#3D5568]">
									{t("permissionsDesc")}
								</p>
							</div>
							<button
								type="button"
								onClick={handleClose}
								disabled={saving}
								aria-label={t("close")}
								className="rounded-xl border border-[#0A3D62]/20 p-2 text-[#3D5568] hover:bg-[#F4F7F6] transition-colors disabled:opacity-50"
							>
								<X className="h-4 w-4" />
							</button>
						</div>

						{error && (
							<div className="mt-4 rounded-xl border border-[#C42B3A]/30 bg-[#FDE8EA] px-4 py-3">
								<p className="text-xs font-bold text-[#C42B3A]">{error}</p>
							</div>
						)}

						{loading && (
							<div className="flex items-center justify-center gap-2 py-12 text-sm font-bold text-[#3D5568]">
								<Loader2 className="h-4 w-4 animate-spin" />
								{t("loading")}
							</div>
						)}

						{state && !loading && (
							<>
								<div className="mt-5 flex items-center justify-between rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3">
									<span className="text-[10px] font-black uppercase tracking-wider text-[#3D5568]">
										{t("roleLabel")}
									</span>
									<span className="rounded-full bg-[#0A3D62] px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white">
										{state.role}
									</span>
								</div>

								<ul className="mt-4 space-y-2">
									{permissions.map((permission) => {
										const override = state.overrides.find((row) => row.permission === permission);
										const isDefault = state.defaults.includes(permission);
										const checked = draft[permission] === true;
										const locked = isSelf && permission === "manage_members";

										const status = override
											? override.granted
												? t("granted")
												: t("revoked")
											: isDefault
												? t("roleDefault")
												: t("notGranted");
										const statusClass =
											override && !override.granted
												? "bg-[#FDE8EA] text-[#C42B3A]"
												: override?.granted
													? "bg-[#E8F5EC] text-[#1E7B34]"
													: isDefault
														? "bg-[#E8EEF5] text-[#0A3D62]"
														: "bg-[#F4F7F6] text-[#3D5568]";

										return (
											<li key={permission}>
												<label
													className={`flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 transition-colors hover:bg-[#F4F7F6]/70 ${
														locked ? "cursor-not-allowed opacity-60" : ""
													}`}
												>
													<input
														type="checkbox"
														checked={checked}
														disabled={locked || saving}
														onChange={(event) =>
															setDraft((previous) => ({
																...previous,
																[permission]: event.target.checked,
															}))
														}
														className="h-4 w-4 accent-[#E85A2A]"
													/>
													<span className="min-w-0 flex-1">
														<span className="block text-sm font-bold text-[#0A3D62]">
															{t(`permission.${permission}`)}
														</span>
														<span className="block font-mono text-[10px] text-[#3D5568]">
															{permission}
														</span>
													</span>
													<span
														className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${statusClass}`}
													>
														{status}
													</span>
												</label>
												{locked && (
													<p className="mt-1 px-1 text-[10px] font-medium text-[#C42B3A]">
														{t("manageMembersLocked")}
													</p>
												)}
											</li>
										);
									})}
								</ul>

								<div className="mt-6 flex gap-3">
									<button
										type="button"
										onClick={handleClose}
										disabled={saving}
										className="flex-1 rounded-xl bg-[#F4F7F6] py-3.5 text-sm font-bold text-[#3D5568] hover:bg-gray-100 transition-all disabled:opacity-50"
									>
										{t("cancel")}
									</button>
									<button
										type="button"
										onClick={handleSave}
										disabled={saving || !dirty}
										className="flex-1 rounded-xl bg-[#E85A2A] py-3.5 text-sm font-extrabold text-white shadow-lg hover:bg-[#d04a1f] transition-all disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 disabled:shadow-none"
									>
										{saving ? t("saving") : t("save")}
									</button>
								</div>
							</>
						)}
					</dialog>
				</div>
			)}
		</>
	);
}
