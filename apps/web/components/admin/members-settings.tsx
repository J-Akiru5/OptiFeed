"use client";

import { UserPermissionsDialog } from "@/components/admin/user-permissions-dialog";
import { useRouter } from "@/i18n/routing";
import { changeMemberRole, inviteMember, revokeMember } from "@/lib/actions/admin";
import type { TenantMemberRow } from "@/lib/actions/admin";
import { MEMBER_ROLES, isMemberRole } from "@/lib/auth/member-rules";
import type { Permission } from "@/lib/auth/permissions";
import type { MemberRole } from "@prisma/client";
import { Check, Copy, Loader2, ShieldCheck, UserPlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

/**
 * `requireTenantAdmin` redirects by throwing a control-flow error with a
 * NEXT_REDIRECT digest. Swallowing it would turn a real redirect into a generic
 * failure the admin cannot act on.
 */
function isRedirectError(error: unknown): boolean {
	if (typeof error !== "object" || error === null || !("digest" in error)) return false;
	const { digest } = error as { digest?: unknown };
	return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

type InviteFormState = {
	membershipId: string;
	userId: string;
	loginEmail: string;
	temporaryPassword: string | null;
	createdUser: boolean;
} | null;

export function MembersSettings({
	members,
	permissions,
	canManage,
}: {
	members: TenantMemberRow[];
	permissions: readonly Permission[];
	canManage: boolean;
}) {
	const t = useTranslations("dashboard.adminMembers");
	const router = useRouter();

	const [inviteOpen, setInviteOpen] = useState(false);
	const [invitePending, setInvitePending] = useState(false);
	const [inviteError, setInviteError] = useState<string | null>(null);
	const [inviteResult, setInviteResult] = useState<InviteFormState>(null);
	const [copied, setCopied] = useState(false);

	const [pending, setPending] = useState<string | null>(null);
	const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	const orgNames = [...new Set(members.map((member) => member.orgName))];
	const showOrgColumn = orgNames.length > 1;

	// Invites must name their target org explicitly when the caller administers
	// more than one; otherwise the action falls back to the first org.
	const orgOptions: { id: string; name: string }[] = [];
	for (const member of members) {
		if (!orgOptions.some((org) => org.id === member.orgId)) {
			orgOptions.push({ id: member.orgId, name: member.orgName });
		}
	}

	const [inviteOrgId, setInviteOrgId] = useState(orgOptions[0]?.id ?? "");
	const selectedCallerRole = members.find(
		(member) => member.isSelf && member.orgId === inviteOrgId,
	)?.callerRole;
	const canInviteOwner = selectedCallerRole === "OWNER";

	async function handleInvite(formData: FormData) {
		setInviteError(null);
		setInviteResult(null);
		setCopied(false);

		const email = String(formData.get("email") ?? "").trim();
		const displayName = String(formData.get("displayName") ?? "").trim();
		const roleValue = String(formData.get("role") ?? "OPERATOR");
		const role: MemberRole = isMemberRole(roleValue) ? roleValue : "OPERATOR";

		if (!email) {
			setInviteError(t("emailRequired"));
			return;
		}
		if (!displayName) {
			setInviteError(t("displayNameRequired"));
			return;
		}

		setInvitePending(true);
		try {
			const result = await inviteMember({
				email,
				displayName,
				role,
				...(inviteOrgId ? { orgId: inviteOrgId } : {}),
			});
			if ("error" in result) {
				setInviteError(result.error);
				return;
			}
			setInviteResult(result);
			setInviteOpen(false);
			toast.success(result.createdUser ? t("inviteSuccess") : t("inviteExistingSuccess"));
			router.refresh();
		} catch (e) {
			if (isRedirectError(e)) throw e;
			setInviteError(t("inviteError"));
		} finally {
			setInvitePending(false);
		}
	}

	async function handleRoleChange(member: TenantMemberRow, value: string) {
		if (!isMemberRole(value) || value === member.role) return;
		const key = `role:${member.userId}`;
		setPending(key);
		setActionError(null);
		try {
			const result = await changeMemberRole(member.userId, value);
			if ("error" in result) {
				setActionError(result.error);
				router.refresh();
				return;
			}
			toast.success(t("roleSuccess"));
			router.refresh();
		} catch (e) {
			if (isRedirectError(e)) throw e;
			setActionError(t("roleError"));
			router.refresh();
		} finally {
			setPending(null);
		}
	}

	async function handleRevoke(member: TenantMemberRow) {
		const key = `revoke:${member.userId}`;
		setPending(key);
		setActionError(null);
		try {
			const result = await revokeMember(member.userId);
			if ("error" in result) {
				setActionError(result.error);
				setRevokeConfirm(null);
				return;
			}
			setRevokeConfirm(null);
			toast.success(t("revokeSuccess"));
			router.refresh();
		} catch (e) {
			if (isRedirectError(e)) throw e;
			setActionError(t("revokeError"));
		} finally {
			setPending(null);
		}
	}

	async function copyPassword() {
		const password = inviteResult?.temporaryPassword;
		if (!password) return;
		try {
			await navigator.clipboard.writeText(password);
			setCopied(true);
		} catch {
			toast.error(t("copyFailed"));
		}
	}

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="font-black text-[#0A3D62]">{t("membersTitle")}</h2>
					<p className="mt-1 text-xs text-[#3D5568]">
						{t("membersDesc", { count: members.length })}
					</p>
				</div>
				{canManage && (
					<button
						type="button"
						onClick={() => {
							setInviteOpen((open) => !open);
							setInviteError(null);
						}}
						className="inline-flex items-center gap-1.5 rounded-xl bg-[#E85A2A] px-3 py-2 text-xs font-black text-white shadow-sm transition-colors hover:bg-[#d04a1f]"
					>
						<UserPlus className="h-3.5 w-3.5" />
						{t("inviteButton")}
					</button>
				)}
			</div>

			{!canManage && (
				<div className="rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-xs font-bold text-[#3D5568]">
					{t("notAllowed")}
				</div>
			)}

			{inviteOpen && canManage && (
				<form action={handleInvite} className="rounded-xl border border-gray-200 bg-[#F4F7F6] p-4">
					<div className="mb-3">
						<p className="text-sm font-black text-[#0A3D62]">{t("inviteTitle")}</p>
						<p className="mt-1 text-[11px] leading-relaxed text-[#3D5568]">{t("inviteDesc")}</p>
					</div>

					{inviteError && (
						<p className="mb-3 rounded-lg border border-[#C42B3A]/30 bg-[#FDE8EA] px-3 py-2 text-xs font-bold text-[#C42B3A]">
							{inviteError}
						</p>
					)}

					{orgOptions.length > 1 && (
						<label className="mb-3 block text-xs font-bold text-[#3D5568]">
							{t("columnOrganization")}
							<select
								value={inviteOrgId}
								onChange={(event) => setInviteOrgId(event.target.value)}
								className="mt-1 w-full max-w-sm rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
							>
								{orgOptions.map((org) => (
									<option key={org.id} value={org.id}>
										{org.name}
									</option>
								))}
							</select>
						</label>
					)}

					<div className="grid gap-3 md:grid-cols-3">
						<label className="block text-xs font-bold text-[#3D5568]">
							{t("emailLabel")}
							<input
								name="email"
								type="email"
								required
								autoComplete="email"
								placeholder="member@example.com"
								className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
							/>
							<span className="mt-1 block text-[10px] font-medium text-[#3D5568]">
								{t("emailHint")}
							</span>
						</label>

						<label className="block text-xs font-bold text-[#3D5568]">
							{t("displayNameLabel")}
							<input
								name="displayName"
								type="text"
								required
								maxLength={80}
								className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
							/>
						</label>

						<label className="block text-xs font-bold text-[#3D5568]">
							{t("roleLabel")}
							<select
								name="role"
								defaultValue="OPERATOR"
								className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A]"
							>
								{MEMBER_ROLES.map((role) => (
									<option key={role} value={role} disabled={role === "OWNER" && !canInviteOwner}>
										{t(`role.${role}`)}
									</option>
								))}
							</select>
						</label>
					</div>

					<div className="mt-3 flex gap-2">
						<button
							type="submit"
							disabled={invitePending}
							className="inline-flex items-center gap-1.5 rounded-xl bg-[#0A3D62] px-3 py-2 text-xs font-black text-white transition-colors hover:bg-[#082f4c] disabled:opacity-60"
						>
							{invitePending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
							{invitePending ? t("inviting") : t("inviteSubmit")}
						</button>
						<button
							type="button"
							onClick={() => {
								setInviteOpen(false);
								setInviteError(null);
							}}
							disabled={invitePending}
							className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#3D5568] ring-1 ring-gray-200 transition-colors hover:bg-gray-50 disabled:opacity-60"
						>
							{t("cancel")}
						</button>
					</div>
				</form>
			)}

			{inviteResult && (
				<div className="rounded-xl border border-[#1E7B34]/30 bg-[#E8F5EC] p-4">
					<div className="flex items-start justify-between gap-3">
						<div>
							<p className="flex items-center gap-1.5 text-sm font-black text-[#1E7B34]">
								<ShieldCheck className="h-4 w-4" />
								{inviteResult.createdUser
									? t("temporaryPasswordTitle")
									: t("inviteExistingSuccess")}
							</p>
							{inviteResult.temporaryPassword && (
								<>
									<p className="mt-1 text-[11px] text-[#1E7B34]">
										{t("temporaryPasswordHint", { email: inviteResult.loginEmail })}
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
											{copied ? t("copied") : t("copyPassword")}
										</button>
									</div>
								</>
							)}
						</div>
						<button
							type="button"
							onClick={() => setInviteResult(null)}
							aria-label={t("done")}
							className="rounded-lg p-1 text-[#1E7B34] hover:bg-white/70"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				</div>
			)}

			{actionError && (
				<div className="flex items-start justify-between gap-3 rounded-xl border border-[#C42B3A]/30 bg-[#FDE8EA] px-4 py-3">
					<p className="text-xs font-bold text-[#C42B3A]">{actionError}</p>
					<button
						type="button"
						onClick={() => setActionError(null)}
						aria-label={t("dismiss")}
						className="rounded p-0.5 text-[#C42B3A] hover:bg-white/60"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			)}

			<div className="overflow-hidden rounded-xl border border-gray-200">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-gray-100 bg-[#F4F7F6]">
								{[
									t("columnMember"),
									...(showOrgColumn ? [t("columnOrganization")] : []),
									t("columnRole"),
									t("columnPermissions"),
									t("columnJoined"),
									t("columnActions"),
								].map((heading) => (
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
								const roleKey = `role:${member.userId}`;
								const revokeKey = `revoke:${member.userId}`;
								const isPending = pending === roleKey || pending === revokeKey;
								const isOwnerTarget = member.role === "OWNER";
								const ownerLocked = isOwnerTarget && member.callerRole !== "OWNER";
								const canEditRole =
									canManage && !member.isSelf && !member.isPlatformAdmin && !ownerLocked;
								const canEditPermissions = canManage && !member.isPlatformAdmin && !ownerLocked;
								const canRevoke =
									canManage &&
									!member.isSelf &&
									!member.isPlatformAdmin &&
									!member.isLastOwner &&
									!ownerLocked;
								const name = member.displayName || member.farmId;

								return (
									<tr key={member.membershipId} className="border-b border-gray-50">
										<td className="px-4 py-3">
											<div className="flex flex-wrap items-center gap-1.5">
												<p className="font-black text-[#0A3D62]">{name}</p>
												{member.isSelf && (
													<span className="rounded-full bg-[#E8EEF5] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#0A3D62]">
														{t("selfBadge")}
													</span>
												)}
												{member.isPlatformAdmin && (
													<span className="rounded-full bg-[#E85A2A] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">
														{t("platformAdminBadge")}
													</span>
												)}
												{member.isLastOwner && (
													<span className="rounded-full bg-[#FDE8EA] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#C42B3A]">
														{t("lastOwnerBadge")}
													</span>
												)}
											</div>
											<p className="text-[11px] text-[#3D5568]">{member.email}</p>
											<p className="font-mono text-[10px] text-[#3D5568]/80">{member.farmId}</p>
										</td>

										{showOrgColumn && (
											<td className="px-4 py-3 text-xs font-bold text-[#3D5568]">
												{member.orgName}
											</td>
										)}

										<td className="px-4 py-3">
											{canEditRole ? (
												<>
													<select
														value={member.role}
														onChange={(event) => handleRoleChange(member, event.target.value)}
														disabled={isPending}
														aria-label={t("changeRole", { name })}
														className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-[#0A3D62] focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:opacity-60"
													>
														{MEMBER_ROLES.map((role) => (
															<option
																key={role}
																value={role}
																disabled={
																	(role === "OWNER" && member.callerRole !== "OWNER") ||
																	(member.isLastOwner && role !== "OWNER")
																}
															>
																{t(`role.${role}`)}
															</option>
														))}
													</select>
													{member.isLastOwner && (
														<p className="mt-1 max-w-[10rem] text-[10px] font-medium text-[#C42B3A]">
															{t("lastOwnerLocked")}
														</p>
													)}
												</>
											) : (
												<span className="inline-flex rounded-full bg-[#0A3D62] px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white">
													{t(`role.${member.role}`)}
												</span>
											)}
											{member.isSelf && (
												<p className="mt-1 max-w-[10rem] text-[10px] font-medium text-[#3D5568]">
													{t("selfRoleLocked")}
												</p>
											)}
											{member.isPlatformAdmin && (
												<p className="mt-1 max-w-[10rem] text-[10px] font-medium text-[#3D5568]">
													{t("platformAdminLocked")}
												</p>
											)}
											{ownerLocked && (
												<p className="mt-1 max-w-[10rem] text-[10px] font-medium text-[#3D5568]">
													{t("ownerLocked")}
												</p>
											)}
										</td>

										<td className="px-4 py-3">
											<p className="mb-1 text-[11px] font-bold text-[#3D5568]">
												{t("permissionsSummary", { count: member.permissions.length })}
											</p>
											{canEditPermissions ? (
												<UserPermissionsDialog
													userId={member.userId}
													userName={name}
													permissions={permissions}
													isSelf={member.isSelf}
												/>
											) : (
												<span className="text-[10px] font-medium text-[#3D5568]">
													{t("viewOnly")}
												</span>
											)}
										</td>

										<td className="px-4 py-3 text-xs text-[#3D5568]">
											{new Date(member.joinedAt).toLocaleDateString()}
										</td>

										<td className="px-4 py-3">
											{canRevoke ? (
												revokeConfirm === member.membershipId ? (
													<div className="flex flex-wrap gap-1.5">
														<button
															type="button"
															onClick={() => handleRevoke(member)}
															disabled={isPending}
															className="inline-flex items-center gap-1 rounded-lg bg-[#C42B3A] px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-[#a92330] disabled:opacity-60"
														>
															{isPending && <Loader2 className="h-3 w-3 animate-spin" />}
															{t("confirmRevoke")}
														</button>
														<button
															type="button"
															onClick={() => setRevokeConfirm(null)}
															disabled={isPending}
															className="rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-black text-[#3D5568] ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-60"
														>
															{t("cancel")}
														</button>
													</div>
												) : (
													<button
														type="button"
														onClick={() => setRevokeConfirm(member.membershipId)}
														className="rounded-lg border border-[#C42B3A]/30 px-2.5 py-1.5 text-[10px] font-black text-[#C42B3A] transition-colors hover:bg-[#FDE8EA]"
													>
														{t("revokeButton")}
													</button>
												)
											) : (
												<span className="text-[10px] font-medium text-[#3D5568]">—</span>
											)}
											{member.isLastOwner && (
												<p className="mt-1 max-w-[10rem] text-[10px] font-medium text-[#C42B3A]">
													{t("lastOwnerLocked")}
												</p>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>

				{members.length === 0 && (
					<p className="p-6 text-center text-sm text-[#3D5568]">{t("membersEmpty")}</p>
				)}
			</div>
		</div>
	);
}
