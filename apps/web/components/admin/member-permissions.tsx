"use client";

import { useRouter } from "@/i18n/routing";
import {
	type UserPermissionState,
	getUserPermissionState,
	setUserPermission,
} from "@/lib/actions/admin";
import type { Permission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { Loader2, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

interface MemberPermissionsProps {
	userId: string;
	/** Every permission the server knows about; passed in so the client never imports the server auth module. */
	permissions: readonly Permission[];
	/** Stored state read on the server by the page, using the same guarded action as before. */
	initialState: UserPermissionState;
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
 * Per-member permission editor, rendered as a page instead of the old modal.
 *
 * Every checkbox edit is local draft state: nothing is written until "Save
 * changes" is pressed, and each changed permission is then applied one at a
 * time through `setUserPermission`. If a write fails partway, the editor
 * re-reads the stored state instead of pretending the draft was applied.
 */
export function MemberPermissions({
	userId,
	permissions,
	initialState,
	isSelf,
}: MemberPermissionsProps) {
	const t = useTranslations("dashboard.adminUsers");
	const tMembers = useTranslations("dashboard.adminMembers");
	const router = useRouter();
	const [state, setState] = useState<UserPermissionState>(initialState);
	const [draft, setDraft] = useState<Record<string, boolean>>(() =>
		draftFrom(initialState, permissions),
	);
	const [saving, setSaving] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const busy = saving || resetting;

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

	/** Apply one permission at a time; on failure show what the server actually holds. */
	async function applyChanges(changes: Permission[], nextDraft: Record<string, boolean>) {
		let latest = state;
		for (const permission of changes) {
			const result = await setUserPermission(userId, permission, nextDraft[permission] === true);
			if (!result.success) {
				setError(result.error);
				await refreshStoredState();
				return null;
			}
			latest = result;
		}
		return latest;
	}

	async function handleSave() {
		if (busy) return;

		const changes = permissions.filter(
			(permission) => draft[permission] !== isGranted(permission, state),
		);
		if (changes.length === 0) return;

		setSaving(true);
		setError(null);
		try {
			const latest = await applyChanges(changes, draft);
			if (!latest) return;
			setState(latest);
			setDraft(draftFrom(latest, permissions));
			toast.success(t("saveSuccess"));
			router.refresh();
		} catch (e) {
			if (isRedirectError(e)) throw e;
			setError(t("saveError"));
			await refreshStoredState();
		} finally {
			setSaving(false);
		}
	}

	async function handleReset() {
		if (busy) return;

		// Reset means "what the role gets by default": grant what the role has and
		// revoke what it does not, clearing the member's explicit overrides.
		const defaults: Record<string, boolean> = {};
		for (const permission of permissions) {
			defaults[permission] = state.defaults.includes(permission);
		}
		const changes = permissions.filter((permission) => draft[permission] !== defaults[permission]);
		if (changes.length === 0) return;

		setResetting(true);
		setError(null);
		try {
			const latest = await applyChanges(changes, defaults);
			if (!latest) return;
			setState(latest);
			setDraft(draftFrom(latest, permissions));
			toast.success(t("resetSuccess"));
			router.refresh();
		} catch (e) {
			if (isRedirectError(e)) throw e;
			setError(t("resetError"));
			await refreshStoredState();
		} finally {
			setResetting(false);
		}
	}

	const dirty = permissions.some(
		(permission) => draft[permission] !== isGranted(permission, state),
	);
	const canReset = permissions.some(
		(permission) => draft[permission] !== state.defaults.includes(permission),
	);

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 dark:border-gray-700/60 dark:bg-gray-800/60">
				<span className="text-[10px] font-black tracking-wider text-[#3D5568] uppercase dark:text-gray-300">
					{t("roleLabel")}
				</span>
				<span className="rounded-full bg-[#0A3D62] px-2.5 py-1 text-[10px] font-black tracking-wider text-white uppercase dark:bg-[#8fc0ea]/20 dark:text-[#8fc0ea]">
					{tMembers(`role.${state.role}`)}
				</span>
			</div>

			{error && (
				<div
					role="alert"
					className="rounded-xl border border-[#C42B3A]/30 bg-[#FDE8EA] px-4 py-3 dark:bg-red-950/40"
				>
					<p className="text-xs font-bold text-[#C42B3A] dark:text-red-300">{error}</p>
				</div>
			)}

			<ul className="space-y-2">
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
							? "bg-[#FDE8EA] text-[#C42B3A] dark:bg-red-950/50 dark:text-red-300"
							: override?.granted
								? "bg-[#E8F5EC] text-[#1E7B34] dark:bg-green-950/50 dark:text-green-300"
								: isDefault
									? "bg-[#E8EEF5] text-[#0A3D62] dark:bg-white/10 dark:text-[#8fc0ea]"
									: "bg-[#F4F7F6] text-[#3D5568] dark:bg-gray-800 dark:text-gray-300";

					return (
						<li key={permission}>
							<label
								className={cn(
									"grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-xl border border-gray-200 px-4 py-3 transition-colors hover:bg-[#F4F7F6]/70 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#0A3D62] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center dark:border-gray-700/60 dark:hover:bg-gray-800/60 dark:focus-within:outline-[#8fc0ea]",
									locked ? "cursor-not-allowed opacity-60" : "",
								)}
							>
								<input
									type="checkbox"
									checked={checked}
									disabled={locked || busy}
									onChange={(event) =>
										setDraft((previous) => ({
											...previous,
											[permission]: event.target.checked,
										}))
									}
									className="mt-0.5 h-5 w-5 shrink-0 accent-[#E85A2A] sm:mt-0"
								/>
								<span className="min-w-0">
									<span className="block text-sm font-bold break-words text-[#0A3D62] dark:text-gray-100">
										{t(`permission.${permission}`)}
									</span>
									<span className="block font-mono text-[10px] break-all text-[#3D5568] dark:text-gray-400">
										{permission}
									</span>
								</span>
								<span className="col-span-2 flex sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:justify-end">
									<span
										data-testid={`permission-status-${permission}`}
										className={cn(
											"shrink-0 rounded-full px-2 py-1 text-[9px] font-black tracking-wider uppercase",
											statusClass,
										)}
									>
										{status}
									</span>
								</span>
							</label>
							{locked && (
								<p className="mt-1 px-1 text-[10px] font-medium text-[#C42B3A] dark:text-red-300">
									{t("manageMembersLocked")}
								</p>
							)}
						</li>
					);
				})}
			</ul>

			<div className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
				<div className="min-w-0">
					<button
						type="button"
						onClick={handleReset}
						disabled={busy || !canReset}
						className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#0A3D62]/20 bg-white px-4 text-sm font-black text-[#0A3D62] transition-colors hover:bg-[#F4F7F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-[#8fc0ea] dark:hover:bg-gray-800 dark:focus-visible:outline-[#8fc0ea]"
					>
						{resetting ? (
							<Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
						) : (
							<RotateCcw aria-hidden="true" className="h-4 w-4" />
						)}
						{t("resetToRoleDefaults")}
					</button>
					<p className="mt-2 max-w-prose text-[11px] text-[#3D5568] dark:text-gray-400">
						{t("resetHint")}
					</p>
				</div>

				<button
					type="button"
					onClick={handleSave}
					disabled={busy || !dirty}
					aria-busy={saving}
					className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-[#C2410C] px-5 text-sm font-extrabold text-white shadow-lg transition-all hover:bg-[#9A3412] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A3D62] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 disabled:shadow-none dark:focus-visible:outline-[#8fc0ea]"
				>
					{saving ? t("saving") : t("save")}
				</button>
			</div>
		</div>
	);
}
