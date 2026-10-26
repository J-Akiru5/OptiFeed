"use client";

import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
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
import type { MemberRole } from "@prisma/client";
import { Check, ChevronDown, Copy, Loader2, ShieldAlert, UserPlus, X } from "lucide-react";
import { useState } from "react";

const PERMISSION_LABELS: Record<Permission, string> = {
	view_dashboard: "View dashboard",
	view_reports: "View reports",
	manage_members: "Manage members",
	manage_farms_ponds: "Manage farms and ponds",
	manage_schedule: "Manage schedule",
	manage_crop_cycle: "Manage crop cycle",
	claim_feeder: "Claim feeder",
	control_feeder: "Control feeder",
	record_dispatch: "Record dispatch",
	view_billing: "View billing",
};

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
 * God-mode member management for one organization.
 *
 * Every mutation sends the shared reason, and a `step_up_required` answer opens
 * the same password dialog the device registry uses, then retries the exact
 * action. The server writes one audit row per successful mutation.
 */
export function OrgMembersPanel({
	orgId,
	members,
	permissions,
}: {
	orgId: string;
	members: PlatformOrgMember[];
	permissions: readonly Permission[];
}) {
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
			setError("A reason of at least 10 characters is required for every change.");
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
			setNotice("Saved. The audit log has one new membership row.");
			router.refresh();
		} catch (e) {
			if (isRedirectError(e)) throw e;
			setError("The action failed. Try again.");
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
		void run(`role:${member.userId}`, "change this member's role", () =>
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
		void run(`perm:${member.membershipId}:${permission}`, "update this member's permissions", () =>
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
			"revoke this membership",
			() => revokeOrgMembership({ orgId, userId: member.userId, reason: reasonValue }),
			() => setRevokeConfirm(null),
		);
	}

	async function submitInvite() {
		const reasonValue = buildReason();
		if (!reasonValue) return;
		if (!inviteEmail.trim()) {
			setError("Enter the member's email.");
			return;
		}
		if (!inviteName.trim()) {
			setError("Enter the member's display name.");
			return;
		}
		await run(
			"invite",
			"invite this member",
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
			setError("Copy failed — select the password and copy it manually.");
		}
	}

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="font-black text-[#0A3D62]">Members</h2>
					<p className="mt-1 text-xs text-[#3D5568]">
						{members.length} active member{members.length === 1 ? "" : "s"}. Changes here bypass the
						tenant last-owner guard and are recorded in the platform audit log.
					</p>
				</div>
				<button
					type="button"
					onClick={() => {
						setInviteOpen((open) => !open);
						setError(null);
					}}
					className="inline-flex items-center gap-1.5 rounded-xl bg-[#E85A2A] px-3 py-2 text-xs font-black text-white shadow-sm transition-colors hover:bg-[#d04a1f]"
				>
					<UserPlus className="h-3.5 w-3.5" />
					Invite member
				</button>
			</div>

			<div className="rounded-xl border border-[#E85A2A]/30 bg-[#FFF3E8] p-4">
				<label
					htmlFor="platform-member-reason"
					className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-[#B45309]"
				>
					<ShieldAlert className="h-3.5 w-3.5" />
					Reason for every change (required, 10+ characters)
				</label>
				<textarea
					id="platform-member-reason"
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					rows={2}
					placeholder="e.g. Owner asked us to correct a wrong role after a staff handover"
					className="mt-1.5 w-full rounded-xl border border-[#E85A2A]/30 bg-white px-3 py-2 text-sm text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
				/>
				<p className="mt-1 text-[10px] font-medium text-[#B45309]">
					{reason.trim().length}/10 characters. A dangerous action also asks for your password
					(step-up) before it runs.
				</p>
			</div>

			{error && (
				<div className="flex items-start justify-between gap-3 rounded-xl border border-[#C42B3A]/30 bg-[#FDE8EA] px-4 py-3">
					<p className="text-xs font-bold text-[#C42B3A]">{error}</p>
					<button
						type="button"
						onClick={() => setError(null)}
						aria-label="Dismiss error"
						className="rounded p-0.5 text-[#C42B3A] hover:bg-white/60"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			)}

			{notice && (
				<div className="flex items-start justify-between gap-3 rounded-xl border border-[#1E7B34]/30 bg-[#E8F5EC] px-4 py-3">
					<p className="text-xs font-bold text-[#1E7B34]">{notice}</p>
					<button
						type="button"
						onClick={() => setNotice(null)}
						aria-label="Dismiss notice"
						className="rounded p-0.5 text-[#1E7B34] hover:bg-white/60"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			)}

			{inviteOpen && (
				<div className="rounded-xl border border-gray-200 bg-[#F4F7F6] p-4">
					<p className="text-sm font-black text-[#0A3D62]">Invite a member</p>
					<p className="mt-1 text-[11px] leading-relaxed text-[#3D5568]">
						An existing account is attached by address. Otherwise a login is provisioned and the
						login details are emailed to the address you enter; the one-time password is also shown
						once below.
					</p>
					<div className="mt-3 grid gap-3 md:grid-cols-3">
						<label className="block text-xs font-bold text-[#3D5568]">
							Email
							<input
								type="email"
								value={inviteEmail}
								onChange={(event) => setInviteEmail(event.target.value)}
								placeholder="member@example.com"
								className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
							/>
						</label>
						<label className="block text-xs font-bold text-[#3D5568]">
							Display name
							<input
								type="text"
								value={inviteName}
								onChange={(event) => setInviteName(event.target.value)}
								className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
							/>
						</label>
						<label className="block text-xs font-bold text-[#3D5568]">
							Role
							<select
								value={inviteRole}
								onChange={(event) => {
									if (isMemberRole(event.target.value)) {
										setInviteRole(event.target.value);
									}
								}}
								className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
							>
								{MEMBER_ROLES.map((role) => (
									<option key={role} value={role}>
										{role}
									</option>
								))}
							</select>
						</label>
					</div>
					<div className="mt-3 flex gap-2">
						<button
							type="button"
							onClick={submitInvite}
							disabled={pending === "invite" || !reasonReady}
							className="inline-flex items-center gap-1.5 rounded-xl bg-[#0A3D62] px-3 py-2 text-xs font-black text-white transition-colors hover:bg-[#082f4c] disabled:opacity-60"
						>
							{pending === "invite" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							{pending === "invite" ? "Inviting…" : "Invite member"}
						</button>
						<button
							type="button"
							onClick={() => setInviteOpen(false)}
							disabled={pending === "invite"}
							className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#3D5568] ring-1 ring-gray-200 transition-colors hover:bg-gray-50 disabled:opacity-60"
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			{inviteResult && (
				<div className="rounded-xl border border-[#1E7B34]/30 bg-[#E8F5EC] p-4">
					<div className="flex items-start justify-between gap-3">
						<div>
							<p className="text-sm font-black text-[#1E7B34]">
								{inviteResult.createdUser
									? "Login created — temporary password (shown once)"
									: "Existing account attached to this organization"}
							</p>
							<p className="mt-1 text-[11px] text-[#1E7B34]">
								Login: <span className="font-mono">{inviteResult.loginEmail}</span>
							</p>
							{inviteResult.temporaryPassword && (
								<>
									<p className="mt-1 text-[11px] font-bold text-[#1E7B34]">
										{inviteResult.emailSent
											? "Invitation email sent."
											: "Invitation email not sent (email delivery is unconfigured or failed). Share the password below directly."}
									</p>
									<div className="mt-2 flex flex-wrap items-center gap-2">
										<code className="rounded-lg bg-white px-3 py-1.5 font-mono text-sm font-bold text-[#0A3D62] ring-1 ring-[#1E7B34]/20">
											{inviteResult.temporaryPassword}
										</code>
										<button
											type="button"
											onClick={copyPassword}
											className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-black text-[#1E7B34] ring-1 ring-[#1E7B34]/20 hover:bg-[#f3fbf5]"
										>
											{copied ? (
												<Check className="h-3.5 w-3.5" />
											) : (
												<Copy className="h-3.5 w-3.5" />
											)}
											{copied ? "Copied" : "Copy password"}
										</button>
									</div>
								</>
							)}
						</div>
						<button
							type="button"
							onClick={() => setInviteResult(null)}
							aria-label="Dismiss invite result"
							className="rounded-lg p-1 text-[#1E7B34] hover:bg-white/70"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				</div>
			)}

			<div className="overflow-hidden rounded-xl border border-gray-200">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6]">
								{["Member", "Role", "Permissions", "Joined", "Actions"].map((heading) => (
									<th
										key={heading}
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
									<tr key={member.membershipId} className="border-b border-gray-50 align-top">
										<td className="px-4 py-3">
											<div className="flex flex-wrap items-center gap-1.5">
												<p className="font-black text-[#0A3D62]">{name}</p>
												{member.isPlatformAdmin && (
													<span className="rounded-full bg-[#E85A2A] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">
														Platform admin
													</span>
												)}
											</div>
											<p className="text-[11px] text-[#3D5568]">{member.email}</p>
											<p className="font-mono text-[10px] text-[#3D5568]/80">{member.farmId}</p>
										</td>

										<td className="px-4 py-3">
											<select
												value={member.role}
												onChange={(event) => handleRoleChange(member, event.target.value)}
												disabled={pendingRole || pendingInvite || pendingRevoke}
												aria-label={`Role for ${name}`}
												className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:opacity-60"
											>
												{MEMBER_ROLES.map((role) => (
													<option key={role} value={role}>
														{role}
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
												className="inline-flex items-center gap-1 rounded-lg border border-[#0A3D62]/20 px-2.5 py-1.5 text-[10px] font-black text-[#0A3D62] hover:bg-[#F4F7F6]"
											>
												<ChevronDown
													className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
												/>
												{member.permissions.length} granted
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
																		{PERMISSION_LABELS[permission]}
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
											{new Date(member.joinedAt).toLocaleDateString()}
										</td>

										<td className="px-4 py-3">
											{revokeConfirm === member.membershipId ? (
												<div className="flex flex-wrap gap-1.5">
													<button
														type="button"
														onClick={() => handleRevoke(member)}
														disabled={pendingRevoke}
														className="inline-flex items-center gap-1 rounded-lg bg-[#C42B3A] px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-[#a92330] disabled:opacity-60"
													>
														{pendingRevoke && <Loader2 className="h-3 w-3 animate-spin" />}
														Confirm revoke
													</button>
													<button
														type="button"
														onClick={() => setRevokeConfirm(null)}
														disabled={pendingRevoke}
														className="rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-black text-[#3D5568] ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-60"
													>
														Cancel
													</button>
												</div>
											) : (
												<button
													type="button"
													onClick={() => setRevokeConfirm(member.membershipId)}
													disabled={!reasonReady}
													className="rounded-lg border border-[#C42B3A]/30 px-2.5 py-1.5 text-[10px] font-black text-[#C42B3A] transition-colors hover:bg-[#FDE8EA] disabled:cursor-not-allowed disabled:opacity-50"
												>
													Revoke
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
					<p className="p-6 text-center text-sm text-[#3D5568]">
						This organization has no active members.
					</p>
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
