import { OpsNav } from "@/components/superadmin/ops-nav";
import {
	Alert,
	Badge,
	Card,
	EmptyState,
	MobileCard,
	PageHeader,
	SECONDARY_BUTTON,
	StatCard,
	TableFrame,
} from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { STEP_UP_TTL_MS } from "@/lib/auth/step-up";
import { formatDateTimeLocal } from "@/lib/date-local";
import { OVERSIGHT_ROW_LIMIT, getSecurityOversight } from "@/lib/platform/security-oversight";
import {
	SENSITIVE_ACTIONS,
	groupBySurface,
	reasonOnlyActions,
	summarizeSensitiveActions,
} from "@/lib/platform/sensitive-actions-rules";
import { KeyRound, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Operations → security and oversight (issue #479, M3C.7).
 *
 * Two halves. The first is the guard contract: every command-center action that
 * can destroy, disable or reach into a tenant, with the credential it demands.
 * The second is what actually happened: recent audit rows for those same actions
 * and whether a step-up credential was present, so a gap is visible instead of
 * assumed away.
 *
 * The catalog is the only list — the page renders it and the test suite asserts
 * it against the server-action source, so neither can drift alone. Read-only, no
 * client JavaScript, no polling.
 */

export default async function OperationsSecurityPage() {
	await requirePlatformAdmin();

	const [oversight, t, tDates] = await Promise.all([
		getSecurityOversight(),
		getTranslations("superadmin.security"),
		getTranslations("dates"),
	]);

	const summary = summarizeSensitiveActions();
	const groups = groupBySurface();
	const exceptions = reasonOnlyActions();
	const ttlMinutes = Math.round(STEP_UP_TTL_MS / 60_000);

	const columns = [
		{ key: "action", label: t("columnAction") },
		{ key: "surface", label: t("columnSurface") },
		{ key: "requirement", label: t("columnRequirement") },
		{ key: "audit", label: t("columnAudit") },
	];

	const oversightColumns = [
		{ key: "when", label: t("columnWhen") },
		{ key: "action", label: t("columnAction") },
		{ key: "actor", label: t("columnActor") },
		{ key: "org", label: t("columnOrg") },
		{ key: "stepUp", label: t("columnStepUp") },
		{ key: "reason", label: t("columnReason") },
	];

	const actionLabel = (id: string | null, fallback: string) =>
		id && SENSITIVE_ACTIONS.some((entry) => entry.id === id) ? t(`actions.${id}`) : fallback;

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("title")}
				description={t("description", { count: summary.total })}
				actions={
					<Link href="/superadmin/operations/audit" className={SECONDARY_BUTTON}>
						<ScrollText className="h-4 w-4" aria-hidden="true" />
						{t("viewAudit")}
					</Link>
				}
			/>
			<OpsNav />

			<section
				aria-label={t("summaryLabel")}
				className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
			>
				<StatCard
					label={t("total")}
					value={summary.total}
					hint={t("totalHint", { count: summary.surfaces })}
					icon={ShieldCheck}
				/>
				<StatCard
					label={t("stepUp")}
					value={summary.stepUp}
					hint={t("stepUpHint")}
					icon={KeyRound}
				/>
				<StatCard
					label={t("reasonOnly")}
					value={summary.reasonAndAudit}
					hint={t("reasonOnlyHint")}
					icon={ShieldAlert}
				/>
				<StatCard label={t("ttl")} value={ttlMinutes} hint={t("ttlHint")} icon={KeyRound} />
			</section>

			{oversight.sourceError ? <Alert tone="error">{t("oversightErrorBody")}</Alert> : null}

			{!oversight.sourceError && oversight.missingStepUp > 0 ? (
				<Alert tone="error">
					<strong>{t("oversightMissingAlert", { count: oversight.missingStepUp })}</strong>{" "}
					{t("oversightMissingBody")}
				</Alert>
			) : null}

			<section className="space-y-3">
				<h2 className="text-sm font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
					{t("guardedTitle")}
				</h2>
				<p className="text-[11px] text-[#3D5568] dark:text-gray-400">{t("guardedDescription")}</p>

				<TableFrame label={t("tableLabel")} columns={columns} minWidth="min-w-[56rem]">
					{groups.flatMap((group) =>
						group.actions.map((entry) => (
							<tr key={entry.id} className="border-b border-gray-100 last:border-0">
								<th
									scope="row"
									className="px-6 py-3 text-left text-sm font-bold text-[#0A3D62] dark:text-gray-100"
								>
									{t(`actions.${entry.id}`)}
								</th>
								<td className="px-6 py-3 text-sm text-[#3D5568] dark:text-gray-400">
									{t(`surfaces.${entry.surface}`)}
								</td>
								<td className="px-6 py-3">
									<Badge tone={entry.requirement === "step-up" ? "success" : "warning"}>
										{t(`requirement.${entry.requirement}`)}
									</Badge>
								</td>
								<td className="px-6 py-3 text-[11px] text-[#3D5568] dark:text-gray-400">
									{entry.auditActions.length === 0 ? (
										t("noAuditCode")
									) : (
										<ul className="space-y-0.5">
											{entry.auditActions.map((code) => (
												<li key={code}>
													<code className="rounded bg-[#F4F7F6] dark:bg-[#0B1220] px-1.5 py-0.5 text-[11px]">
														{code}
													</code>
												</li>
											))}
										</ul>
									)}
								</td>
							</tr>
						)),
					)}
				</TableFrame>

				{/* Mobile: the same rows as cards, no horizontal scrolling. */}
				<ul className="space-y-3 md:hidden">
					{groups.flatMap((group) =>
						group.actions.map((entry) => (
							<MobileCard key={entry.id}>
								<div className="flex items-start justify-between gap-2">
									<p className="min-w-0 text-sm font-bold text-[#0A3D62] dark:text-gray-100">
										{t(`actions.${entry.id}`)}
									</p>
									<Badge tone={entry.requirement === "step-up" ? "success" : "warning"}>
										{t(`requirement.${entry.requirement}`)}
									</Badge>
								</div>
								<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
									{t(`surfaces.${entry.surface}`)}
								</p>
								{entry.auditActions.length > 0 ? (
									<p className="truncate text-[11px] text-[#3D5568] dark:text-gray-400">
										<code>{entry.auditActions.join(", ")}</code>
									</p>
								) : (
									<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
										{t("noAuditCode")}
									</p>
								)}
							</MobileCard>
						)),
					)}
				</ul>
			</section>

			<section className="space-y-3">
				<h2 className="text-sm font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
					{t("exceptionsTitle")}
				</h2>
				<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
					{t("exceptionsDescription")}
				</p>
				<ul className="grid gap-3 sm:grid-cols-2">
					{exceptions.map((entry) => (
						<MobileCard key={entry.id}>
							<p className="text-sm font-bold text-[#0A3D62] dark:text-gray-100">
								{t(`actions.${entry.id}`)}
							</p>
							<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
								{t(`surfaces.${entry.surface}`)}
							</p>
							<p className="text-[11px] leading-snug text-[#3D5568] dark:text-gray-400">
								{entry.note ? t(`notes.${entry.note}`) : ""}
							</p>
						</MobileCard>
					))}
				</ul>
			</section>

			<section className="space-y-3">
				<h2 className="text-sm font-black uppercase tracking-wider text-[#3D5568] dark:text-gray-400">
					{t("oversightTitle")}
				</h2>
				<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
					{t("oversightDescription", { count: OVERSIGHT_ROW_LIMIT })}
				</p>

				{oversight.rows.length === 0 ? (
					<Card>
						<EmptyState
							icon={ScrollText}
							title={t("oversightEmptyTitle")}
							description={oversight.sourceError ? t("oversightErrorBody") : t("oversightEmpty")}
						/>
					</Card>
				) : (
					<>
						<TableFrame
							label={t("oversightTableLabel")}
							columns={oversightColumns}
							minWidth="min-w-[64rem]"
						>
							{oversight.rows.map((row) => (
								<tr key={row.id} className="border-b border-gray-100 last:border-0">
									<td className="px-6 py-3 text-sm text-[#3D5568] dark:text-gray-400">
										{formatDateTimeLocal(row.createdAt, tDates).full}
									</td>
									<th
										scope="row"
										className="px-6 py-3 text-left text-sm font-bold text-[#0A3D62] dark:text-gray-100"
									>
										<Link
											href={`/superadmin/operations/audit?action=${encodeURIComponent(row.auditAction)}`}
											className="underline decoration-dotted"
										>
											{actionLabel(row.actionId, row.auditAction)}
										</Link>
									</th>
									<td className="px-6 py-3 text-sm text-[#3D5568] dark:text-gray-400">
										{row.actorLabel}
									</td>
									<td className="px-6 py-3 text-sm text-[#3D5568] dark:text-gray-400">
										{row.orgName ?? t("orgUnknown")}
									</td>
									<td className="px-6 py-3">
										<Badge
											tone={
												row.requirement === "step-up"
													? row.stepUpAt
														? "success"
														: "danger"
													: "neutral"
											}
										>
											{row.requirement === "step-up"
												? row.stepUpAt
													? t("stepUpPresent")
													: t("stepUpMissing")
												: t("requirement.reason-and-audit")}
										</Badge>
									</td>
									<td className="px-6 py-3 text-sm text-[#3D5568] dark:text-gray-400">
										{row.reason}
									</td>
								</tr>
							))}
						</TableFrame>

						<ul className="space-y-3 md:hidden">
							{oversight.rows.map((row) => (
								<MobileCard key={row.id}>
									<div className="flex items-start justify-between gap-2">
										<p className="min-w-0 text-sm font-bold text-[#0A3D62] dark:text-gray-100">
											{actionLabel(row.actionId, row.auditAction)}
										</p>
										<Badge
											tone={
												row.requirement === "step-up"
													? row.stepUpAt
														? "success"
														: "danger"
													: "neutral"
											}
										>
											{row.requirement === "step-up"
												? row.stepUpAt
													? t("stepUpPresent")
													: t("stepUpMissing")
												: t("requirement.reason-and-audit")}
										</Badge>
									</div>
									<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
										{formatDateTimeLocal(row.createdAt, tDates).full} · {row.actorLabel}
									</p>
									<p className="text-[11px] text-[#3D5568] dark:text-gray-400">{row.reason}</p>
								</MobileCard>
							))}
						</ul>
					</>
				)}
			</section>
		</div>
	);
}
