import { OpsNav } from "@/components/superadmin/ops-nav";
import {
	Badge,
	Card,
	PageHeader,
	SECONDARY_BUTTON,
	SectionTitle,
} from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { getAuditEntry } from "@/lib/platform/audit-log";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

function jsonBlock(value: unknown): string {
	if (value === null || value === undefined) return "—";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/**
 * One platform audit row, including the before/after JSON (E16.4, task I-15).
 *
 * The detail is the evidence for a change: who acted, on what, why, whether a
 * step-up happened, the request origin, and the recorded state either side.
 */
export default async function OperationsAuditDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	await requirePlatformAdmin();

	const { id } = await params;
	const entry = await getAuditEntry(id);
	if (!entry) notFound();

	const [t, tCommon, tDates] = await Promise.all([
		getTranslations("superadmin.operations"),
		getTranslations("superadmin.common"),
		getTranslations("dates"),
	]);

	const formatted = (date: Date | null) =>
		date ? formatDateTimeLocal(date, tDates).full : tCommon("never");

	const facts: { label: string; value: string }[] = [
		{ label: t("audit.detail.action"), value: entry.action },
		{ label: t("audit.detail.actor"), value: entry.actorLabel },
		{
			label: t("audit.detail.actorFarm"),
			value: entry.actorFarmId ?? t("audit.noOrg"),
		},
		{ label: t("audit.detail.targetType"), value: entry.targetType },
		{ label: t("audit.detail.targetId"), value: entry.targetId ?? tCommon("none") },
		{ label: t("audit.detail.org"), value: entry.orgName ?? t("audit.noOrg") },
		{ label: t("audit.detail.when"), value: formatted(entry.createdAt) },
		{ label: t("audit.detail.stepUp"), value: formatted(entry.stepUpAt) },
		{
			label: t("audit.detail.temporaryGrant"),
			value: entry.temporaryGrant ? t("audit.detail.yes") : t("audit.detail.no"),
		},
		{ label: t("audit.detail.impersonation"), value: entry.impersonationId ?? tCommon("none") },
		{ label: t("audit.detail.ip"), value: entry.ip ?? tCommon("none") },
		{ label: t("audit.detail.userAgent"), value: entry.userAgent ?? tCommon("none") },
	];

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("audit.detail.title")}
				description={t("audit.detail.description")}
				actions={
					<Link href="/superadmin/operations/audit" className={SECONDARY_BUTTON}>
						<ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
						{t("audit.detail.back")}
					</Link>
				}
			/>
			<OpsNav />

			<Card className="p-5">
				<div className="flex flex-wrap items-center gap-2">
					<Badge tone="brand" icon={ShieldCheck}>
						{entry.action}
					</Badge>
					<span className="font-mono text-xs text-[#3D5568]">{entry.id}</span>
				</div>
				<p className="mt-3 text-sm font-bold text-[#0A3D62]">{entry.reason}</p>

				<dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{facts.map((fact) => (
						<div key={fact.label} className="min-w-0">
							<dt className="text-[10px] font-extrabold tracking-wider text-[#3D5568] uppercase">
								{fact.label}
							</dt>
							<dd className="mt-1 text-xs font-bold break-words text-[#0A3D62]">{fact.value}</dd>
						</div>
					))}
				</dl>
			</Card>

			<div className="grid gap-4 lg:grid-cols-2">
				<Card>
					<SectionTitle title={t("audit.detail.before")} />
					<pre className="overflow-x-auto px-5 py-4 font-mono text-xs whitespace-pre-wrap text-[#3D5568]">
						{jsonBlock(entry.before)}
					</pre>
				</Card>
				<Card>
					<SectionTitle title={t("audit.detail.after")} />
					<pre className="overflow-x-auto px-5 py-4 font-mono text-xs whitespace-pre-wrap text-[#3D5568]">
						{jsonBlock(entry.after)}
					</pre>
				</Card>
			</div>
		</div>
	);
}
