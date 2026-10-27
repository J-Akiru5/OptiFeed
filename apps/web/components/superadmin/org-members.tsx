"use client";

import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import {
	Alert,
	Badge,
	FIELD_INPUT,
	FIELD_LABEL,
	FOCUS_RING,
	PRIMARY_BUTTON,
	SECONDARY_BUTTON,
} from "@/components/superadmin/ui";
import { UserAvatar } from "@/components/user-avatar";
import { useRouter } from "@/i18n/routing";
import {
	changeOrgMemberRole,
	inviteOrgMember,
	revokeOrgMembership,
	setOrgMemberPermission,
} from "@/lib/actions/platform/members";
import type { PlatformOrgMember } from "@/lib/actions/platform/members";
import { MEMBER_ROLES, isMemberRole } from "@/lib/auth/member-rules";
import type { Permission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import type { MemberRole } from "@prisma/client";
import { Check, ChevronDown, Copy, Loader2, ShieldAlert, UserPlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

type MutationResult = { success: true } | { error: string; code?: "step_up_required" };

type InviteResult = {
	loginEmail: string;
	temporaryPassword: string | null;
	createdUser: boolean;
	emailSent: boolean;
} | null;

function isRedirectError(error: unknown): boolean {
	if (typeof error !== "object" || error === null || !("digest" in error)) return false;
	const { digest } = error as { digest?: unknown };
	return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/**
 * Platform member management for one organization.
 *
 * Every mutation sends the shared reason, and a `step_up_required` answer opens
 * the same password dialog the device registry uses, then retries the exact
 * action. The server writes one audit row per successful mutation.
 */
export function OrgMembersPanel({
	orgId,
	members,
	permissions,
	joinedLabels,
}: {
	orgId: string;
	members: PlatformOrgMember[];
	permissions: readonly Permission[];
	/** Server-formatted join dates keyed by membership id (logger-safe dates). */
	joinedLabels: Record<string, string>;
}) {
	const t = useTranslations("superadmin.orgMembers");
	const tCommon = useTranslations("superadmin.common");
	const tRoot = useTranslations("superadmin");
	const router = useRouter();

	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [pending, setPending] = useState<string | null>(null);

	const [inviteOpen, setInviteOpen] = useState(false);
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteName, setInviteName] = useState("");
	const [inviteRole, setInviteRole] = useState<MemberRole>("OPERATOR");
	const [inviteResult, setInviteResult] = useState<InviteResult>(null);
	const [copied, setCopied] = useState(false);

	const [expanded, setExpanded] = useState<string | null>(null);
	const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);

	const [stepUp, setStepUp] = useState<{
		open: boolean;
		label: string;
		retry: (() => void) | null;
	}>({ open: false, label: "", retry: null });

	const reasonReady = reason.trim().length >= 10;

	function buildReason(): string | null {
		const trimmed = reason.trim();
		if (trimmed.length < 10) {
			setError(t("reasonRequired"));
			return null;
		}
		return trimmed;
	}

	async function run<T extends MutationResult>(
		key: string,
		label: string,
		action: () => Promise<T>,
		onSuccess?: (result: Extract<T, { success: true }>) => void,
		allowStepUpRetry = true,
	) {
		setPending(key);
		setError(null);
		setNotice(null);
		try {
			const result = await action();
			if ("error" in result) {
				if (allowStepUpRetry && result.code === "step_up_required") {
					setStepUp({
						open: true,
						label,
						retry: () => {
							void run(key, label, action, onSuccess, false);
						},
					});
					return;
				}
				setError(result.error);
				return;
			}
			onSuccess?.(result as Extract<T, { success: true }>);
			setNotice(t("saved"));
			router.refresh();
		} catch (e) {
			if (isRedirectError(e)) throw e;
			setError(t("actionFailed"));
		} finally {
			setPending(null);
		}
	}

	function handleStepUpVerified() {
		const retry = stepUp.retry;
		setStepUp({ open: false, label: "", retry: null });
		retry?.();
	}

	function handleRoleChange(member: PlatformOrgMember, value: string) {
		if (!isMemberRole(value) || value === member.role) return;
		const reasonValue = buildReason();
		if (!reasonValue) {
			router.refresh();
			return;
		}
		void run(`role:${member.userId}`, t("stepUpActions.role"), () =>
			changeOrgMemberRole({
				orgId,
				userId: member.userId,
				role: value,
				reason: reasonValue,
			}),
		);
	}

	function handlePermission(member: PlatformOrgMember, permission: Permission, granted: boolean) {
		const reasonValue = buildReason();
		if (!reasonValue) return;
		void run(`perm:${member.membershipId}:${permission}`, t("stepUpActions.permission"), () =>
			setOrgMemberPermission({
				orgId,
				userId: member.userId,
				permission,
				granted,
				reason: reasonValue,
			}),
		);
	}

	function handleRevoke(member: PlatformOrgMember) {
		const reasonValue = buildReason();
		if (!reasonValue) return;
		void run(
			`revoke:${member.userId}`,
			t("stepUpActions.revoke"),
			() => revokeOrgMembership({ orgId, userId: member.userId, reason: reasonValue }),
			() => setRevokeConfirm(null),
		);
	}

	async function submitInvite() {
		const reasonValue = buildReason();
		if (!reasonValue) return;
		if (!inviteEmail.trim()) {
			setError(t("emailRequired"));
			return;
		}
		if (!inviteName.trim()) {
			setError(t("nameRequired"));
			return;
		}
		await run(
			"invite",
			t("stepUpActions.invite"),
			() =>
				inviteOrgMember({
					orgId,
					email: inviteEmail.trim(),
					displayName: inviteName.trim(),
					role: inviteRole,
					reason: reasonValue,
				}),
			(result) => {
				setInviteResult({
					loginEmail: result.loginEmail,
					temporaryPassword: result.temporaryPassword,
					createdUser: result.createdUser,
					emailSent: result.inviteEmailSent,
				});
				setInviteOpen(false);
				setInviteEmail("");
				setInviteName("");
				setCopied(false);
			},
		);
	}

	async function copyPassword() {
		const password = inviteResult?.temporaryPassword;
		if (!password) return;
		try {
			await navigator.clipboard.writeText(password);
			setCopied(true);
		} catch {
			setError(t("copyFailed"));
		}
	}

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="font-black text-[#0A3D62]">{tCommon("members")}</h2>
					<p className="mt-1 text-xs text-[#3D5568]">
						{t("description", { count: members.length })}
					</p>
				</div>
				<button
					type="button"
					onClick={() => {
						setInviteOpen((open) => !open);
						setError(null);
					}}
					aria-expanded={inviteOpen}
					aria-controls="platform-invite-panel"
					className={cn(PRIMARY_BUTTON, "px-3 py-2 text-xs font-black")}
				>
					<UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
					{t("invite")}
				</button>
			</div>

			<div className="rounded-xl border border-[#E85A2A]/30 bg-[#FFF3E8] p-4">
				<label
					htmlFor="platform-member-reason"
					className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[#B45309]"
				>
					<ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
					{t("reasonLabel")}
				</label>
				<textarea
					id="platform-member-reason"
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					rows={2}
					placeholder={t("reasonPlaceholder")}
					aria-describedby="platform-member-reason-hint"
					className="mt-1.5 w-full rounded-xl border border-[#E85A2A]/30 bg-white px-3 py-2 text-sm text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
				/>
				<p id="platform-member-reason-hint" className="mt-1 text-[10px] font-medium text-[#B45309]">
					{t("charCount", { count: reason.trim().length })}
				</p>
			</div>

			{error && (
				<Alert tone="error" onDismiss={() => setError(null)} dismissLabel={tCommon("dismissError")}>
					{error}
				</Alert>
			)}

			{notice && (
				<Alert
					tone="success"
					onDismiss={() => setNotice(null)}
					dismissLabel={tCommon("dismissNotice")}
				>
					{notice}
				</Alert>
			)}

			{inviteOpen && (
				<div
					id="platform-invite-panel"
					className="rounded-xl border border-gray-200 bg-[#F4F7F6] p-4"
				>
					<p className="text-sm font-black text-[#0A3D62]">{t("inviteTitle")}</p>
					<p className="mt-1 text-[11px] leading-relaxed text-[#3D5568]">{t("inviteDesc")}</p>
					<div className="mt-3 grid gap-3 sm:grid-cols-3">
						<div className="space-y-1">
							<label htmlFor="invite-email" className={FIELD_LABEL}>
								{tCommon("email")}
							</label>
							<input
								id="invite-email"
								type="email"
								value={inviteEmail}
								onChange={(event) => setInviteEmail(event.target.value)}
								placeholder={t("emailPlaceholder")}
								className={FIELD_INPUT}
							/>
						</div>
						<div className="space-y-1">
							<label htmlFor="invite-name" className={FIELD_LABEL}>
								{tCommon("displayName")}
							</label>
							<input
								id="invite-name"
								type="text"
								value={inviteName}
								onChange={(event) => setInviteName(event.target.value)}
								className={FIELD_INPUT}
							/>
						</div>
						<div className="space-y-1">
							<label htmlFor="invite-role" className={FIELD_LABEL}>
								{tCommon("role")}
							</label>
							<select
								id="invite-role"
								value={inviteRole}
								onChange={(event) => {
									if (isMemberRole(event.target.value)) {
										setInviteRole(event.target.value);
									}
								}}
								className={cn(FIELD_INPUT, "font-bold")}
							>
								{MEMBER_ROLES.map((role) => (
									<option key={role} value={role}>
										{tRoot(`roles.${role}`)}
									</option>
								))}
							</select>
						</div>
					</div>
					<div className="mt-3 flex gap-2">
						<button
							type="button"
							onClick={submitInvite}
							disabled={pending === "invite" || !reasonReady}
							className={cn(
								PRIMARY_BUTTON,
								"bg-[#0A3D62] px-3 py-2 text-xs font-black hover:bg-[#082f4d]",
							)}
						>
							{pending === "invite" && (
								<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
							)}
							{pending === "invite" ? t("inviting") : t("invite")}
						</button>
						<button
							type="button"
							onClick={() => setInviteOpen(false)}
							disabled={pending === "invite"}
							className={cn(SECONDARY_BUTTON, "px-3 py-2")}
						>
							{tCommon("cancel")}
						</button>
					</div>
				</div>
			)}

			{inviteResult && (
				<div className="rounded-xl border border-[#1E7B34]/30 bg-[#E8F5EC] p-4">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<p className="text-sm font-black text-[#1E7B34]">
								{inviteResult.createdUser ? t("loginCreated") : t("existingAttached")}
							</p>
							<p className="mt-1 text-[11px] text-[#1E7B34]">
								{t("login", { email: inviteResult.loginEmail })}
							</p>
							{inviteResult.temporaryPassword && (
								<>
									<p className="mt-1 text-[11px] font-bold text-[#1E7B34]">
										{inviteResult.emailSent ? t("emailSent") : t("emailNotSent")}
									</p>
									<div className="mt-2 flex flex-wrap items-center gap-2">
										<code className="break-all rounded-lg bg-white px-3 py-1.5 font-mono text-sm font-bold text-[#0A3D62] ring-1 ring-[#1E7B34]/20">
											{inviteResult.temporaryPassword}
										</code>
										<button
											type="button"
											onClick={copyPassword}
											className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-black text-[#1E7B34] ring-1 ring-[#1E7B34]/20 hover:bg-[#f3fbf5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E7B34]"
										>
											{copied ? (
												<Check className="h-3.5 w-3.5" aria-hidden="true" />
											) : (
												<Copy className="h-3.5 w-3.5" aria-hidden="true" />
											)}
											{copied ? tCommon("copied") : tCommon("copyPassword")}
										</button>
									</div>
								</>
							)}
						</div>
						<button
							type="button"
							onClick={() => setInviteResult(null)}
							aria-label={t("dismissInvite")}
							className={cn("rounded-lg p-1 text-[#1E7B34] hover:bg-white/70", FOCUS_RING)}
						>
							<X className="h-4 w-4" aria-hidden="true" />
						</button>
					</div>
				</div>
			)}

			<div className="overflow-hidden rounded-xl border border-gray-200">
				<div className="overflow-x-auto">
					<table className="w-full min-w-[44rem] text-sm">
						<caption className="sr-only">{t("caption")}</caption>
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6]">
								{[
									t("columnMember"),
									t("columnRole"),
									t("columnPermissions"),
									t("columnJoined"),
									t("columnActions"),
								].map((heading) => (
									<th
										key={heading}
										scope="col"
										className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-wider text-[#3D5568]"
									>
										{heading}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{members.map((member) => {
								const name = member.displayName || member.farmId;
								const isExpanded = expanded === member.membershipId;
								const pendingRole = pending === `role:${member.userId}`;
								const pendingInvite = pending === "invite";
								const pendingRevoke = pending === `revoke:${member.userId}`;

								return (
									<tr
										key={member.membershipId}
										className="border-b border-gray-50 align-top last:border-0"
									>
										<td className="px-4 py-3">
											<div className="flex items-start gap-3">
												<UserAvatar
													src={member.avatarUrl}
													name={name}
													size="md"
													className="mt-0.5 rounded-xl bg-[#0A3D62]"
												/>
												<div className="min-w-0">
													<div className="flex flex-wrap items-center gap-1.5">
														<p className="font-black text-[#0A3D62]">{name}</p>
														{member.isPlatformAdmin && (
															<Badge tone="accent">{tCommon("platformAdmin")}</Badge>
														)}
													</div>
													<p className="text-[11px] text-[#3D5568]">{member.email}</p>
													<p className="font-mono text-[10px] text-[#3D5568]">{member.farmId}</p>
												</div>
											</div>
										</td>

										<td className="px-4 py-3">
											<select
												value={member.role}
												onChange={(event) => handleRoleChange(member, event.target.value)}
												disabled={pendingRole || pendingInvite || pendingRevoke}
												aria-label={t("roleAria", { name })}
												className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:opacity-60"
											>
												{MEMBER_ROLES.map((role) => (
													<option key={role} value={role}>
														{tRoot(`roles.${role}`)}
													</option>
												))}
											</select>
										</td>

										<td className="px-4 py-3">
											<button
												type="button"
												onClick={() =>
													setExpanded((current) =>
														current === member.membershipId ? null : member.membershipId,
													)
												}
												aria-expanded={isExpanded}
												aria-controls={`permissions-${member.membershipId}`}
												className={cn(SECONDARY_BUTTON, "px-2.5 py-1.5 text-[10px]")}
											>
												<ChevronDown
													className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
													aria-hidden="true"
												/>
												{t("granted", { count: member.permissions.length })}
											</button>
											{isExpanded && (
												<ul
													id={`permissions-${member.membershipId}`}
													className="mt-2 w-56 space-y-1"
												>
													{permissions.map((permission) => {
														const checked = member.permissions.includes(permission);
														const key = `perm:${member.membershipId}:${permission}`;
														return (
															<li key={permission}>
																<label className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1 hover:bg-[#F4F7F6]">
																	<input
																		type="checkbox"
																		checked={checked}
																		disabled={pending === key || !reasonReady}
																		onChange={(event) =>
																			handlePermission(member, permission, event.target.checked)
																		}
																		className="mt-0.5 h-3.5 w-3.5 accent-[#E85A2A]"
																	/>
																	<span className="text-[11px] font-bold text-[#0A3D62]">
																		{tRoot(`permissions.${permission}`)}
																		<span className="block font-mono text-[9px] font-medium text-[#3D5568]">
																			{permission}
																		</span>
																	</span>
																</label>
															</li>
														);
													})}
												</ul>
											)}
										</td>

										<td className="px-4 py-3 text-xs text-[#3D5568]">
											{joinedLabels[member.membershipId] ?? "—"}
										</td>

										<td className="px-4 py-3">
											{revokeConfirm === member.membershipId ? (
												<div className="flex flex-wrap gap-1.5">
													<button
														type="button"
														onClick={() => handleRevoke(member)}
														disabled={pendingRevoke}
														className={cn(
															"inline-flex items-center gap-1 rounded-lg bg-[#C42B3A] px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-[#a92330] disabled:opacity-60",
															FOCUS_RING,
														)}
													>
														{pendingRevoke && (
															<Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
														)}
														{t("confirmRevoke")}
													</button>
													<button
														type="button"
														onClick={() => setRevokeConfirm(null)}
														disabled={pendingRevoke}
														className={cn(SECONDARY_BUTTON, "px-2.5 py-1.5 text-[10px]")}
													>
														{tCommon("cancel")}
													</button>
												</div>
											) : (
												<button
													type="button"
													onClick={() => setRevokeConfirm(member.membershipId)}
													disabled={!reasonReady}
													className={cn(
														"rounded-lg border border-[#C42B3A]/30 px-2.5 py-1.5 text-[10px] font-black text-[#C42B3A] transition-colors hover:bg-[#FDE8EA] disabled:cursor-not-allowed disabled:opacity-50",
														FOCUS_RING,
													)}
												>
													{t("revoke")}
												</button>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>

				{members.length === 0 && (
					<p className="p-6 text-center text-sm text-[#3D5568]">{t("empty")}</p>
				)}
			</div>

			<StepUpDialog
				open={stepUp.open}
				actionLabel={stepUp.label}
				onClose={() => setStepUp({ open: false, label: "", retry: null })}
				onVerified={handleStepUpVerified}
			/>
		</div>
	);
}
