import { Badge } from "@/components/superadmin/ui";
import { Link } from "@/i18n/routing";
import type { StickerRatingValues } from "@/lib/constants/sticker-rating";
import type { EmailConfiguration } from "@/lib/settings/email-status";
import type { FirmwareStatus } from "@/lib/settings/firmware-status";
import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Read-only configuration-centre cards (I-14).
 *
 * These sections summarise configuration that lives elsewhere (the print page,
 * the AI provider chain, the environment, the OTA channel). They never write
 * anything, and they only expose presence booleans and public sender
 * addresses — never a secret value.
 */

const CARD =
	"rounded-2xl border border-gray-200 dark:border-[#24304A] bg-white dark:bg-[#111A2C] p-5 shadow-sm";

function Row({
	label,
	value,
	configured,
	notConfiguredLabel,
}: {
	label: string;
	value: string;
	configured?: boolean;
	notConfiguredLabel?: string;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-[#1B2740] py-2.5 last:border-0">
			<span className="text-sm font-bold text-[#0A3D62] dark:text-slate-100">{label}</span>
			<span className="flex items-center gap-2 text-sm text-[#3D5568] dark:text-slate-400">
				{typeof configured === "boolean" && (
					<Badge tone={configured ? "success" : "warning"}>
						{configured ? "✓" : "—"} {configured ? value : notConfiguredLabel}
					</Badge>
				)}
				{typeof configured !== "boolean" && <span>{value}</span>}
			</span>
		</div>
	);
}

export async function StickerDefaultCard({ rating }: { rating: StickerRatingValues | null }) {
	const t = await getTranslations("superadmin.settings");

	return (
		<div className={`${CARD} space-y-4`}>
			<div className="rounded-xl bg-[#F4F7F6] dark:bg-[#0B1220] p-3">
				<p className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
					{t("stickers.currentTitle")}
				</p>
				{rating ? (
					<>
						<p className="mt-1 text-lg font-black text-[#0A3D62] dark:text-slate-100">
							{t("stickers.ratingSummary", {
								voltage: rating.voltageV,
								hz: rating.frequencyHz,
								amps: rating.currentA,
								va: rating.powerVA,
							})}
						</p>
						<p className="mt-1 text-xs text-[#3D5568] dark:text-slate-400">
							{rating.measured && rating.measuredAt
								? t("stickers.measuredOn", { date: rating.measuredAt })
								: t("stickers.estimated")}
						</p>
					</>
				) : (
					<p className="mt-1 text-sm text-[#3D5568] dark:text-slate-400">{t("stickers.none")}</p>
				)}
			</div>

			<p className="text-sm text-[#3D5568] dark:text-slate-400">{t("stickers.manageHint")}</p>
			<Link
				href="/superadmin/devices"
				className="inline-flex items-center gap-1.5 rounded-xl border border-[#0A3D62]/20 bg-white dark:bg-[#111A2C] px-3 py-2 text-xs font-black text-[#0A3D62] dark:text-slate-100 transition-colors hover:bg-[#F4F7F6] dark:hover:bg-[#162238]"
			>
				{t("stickers.manage")}
				<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
			</Link>
		</div>
	);
}

export async function AiProvidersCard({
	enabled,
	total,
}: {
	enabled: number;
	total: number;
}) {
	const t = await getTranslations("superadmin.settings");

	return (
		<div className={`${CARD} space-y-4`}>
			<p className="text-sm text-[#3D5568] dark:text-slate-400">
				{t("ai.summary", { enabled, total })}
			</p>
			<p className="text-sm text-[#3D5568] dark:text-slate-400">{t("ai.openHint")}</p>
			<Link
				href="/superadmin/ai-providers"
				className="inline-flex items-center gap-1.5 rounded-xl border border-[#0A3D62]/20 bg-white dark:bg-[#111A2C] px-3 py-2 text-xs font-black text-[#0A3D62] dark:text-slate-100 transition-colors hover:bg-[#F4F7F6] dark:hover:bg-[#162238]"
			>
				{t("ai.open")}
				<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
			</Link>
		</div>
	);
}

export async function EmailStatusCard({ configuration }: { configuration: EmailConfiguration }) {
	const t = await getTranslations("superadmin.settings");

	return (
		<div className={`${CARD} space-y-4`}>
			<div className="flex flex-wrap gap-2">
				<Badge tone={configuration.inviteReady ? "success" : "warning"}>
					{configuration.inviteReady ? t("email.inviteReady") : t("email.inviteNotReady")}
				</Badge>
				<Badge tone={configuration.reminderReady ? "success" : "warning"}>
					{configuration.reminderReady ? t("email.reminderReady") : t("email.reminderNotReady")}
				</Badge>
			</div>

			<div>
				<Row
					label={t("email.resendLabel")}
					value={t("email.configured")}
					notConfiguredLabel={t("email.notConfigured")}
					configured={configuration.resendConfigured}
				/>
				<Row
					label={t("email.inviteFromLabel")}
					value={t("email.configured")}
					notConfiguredLabel={t("email.notConfigured")}
					configured={configuration.inviteFromConfigured}
				/>
				<Row
					label={t("email.baseUrlLabel")}
					value={t("email.configured")}
					notConfiguredLabel={t("email.notConfigured")}
					configured={configuration.baseUrlConfigured}
				/>
				<Row
					label={t("email.reminderFromLabel")}
					value={t("email.configured")}
					notConfiguredLabel={t("email.notConfigured")}
					configured={configuration.reminderFromConfigured}
				/>
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<div className="rounded-xl bg-[#F4F7F6] dark:bg-[#0B1220] p-3">
					<p className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
						{t("email.inviteSenderLabel")}
					</p>
					<p className="mt-1 break-words text-sm font-bold text-[#0A3D62] dark:text-slate-100">
						{configuration.inviteFrom}
					</p>
				</div>
				<div className="rounded-xl bg-[#F4F7F6] dark:bg-[#0B1220] p-3">
					<p className="text-[10px] font-extrabold uppercase tracking-wider text-[#3D5568] dark:text-slate-400">
						{t("email.reminderSenderLabel")}
					</p>
					<p className="mt-1 break-words text-sm font-bold text-[#0A3D62] dark:text-slate-100">
						{configuration.reminderFrom ?? t("email.noReminderSender")}
					</p>
				</div>
			</div>

			<p className="text-xs text-[#3D5568] dark:text-slate-400">{t("email.defaultSenderNote")}</p>
		</div>
	);
}

export async function FirmwareStatusCard({ status }: { status: FirmwareStatus }) {
	const t = await getTranslations("superadmin.settings");

	return (
		<div className={`${CARD} space-y-4`}>
			<div className="flex flex-wrap gap-2">
				<Badge tone={status.storageConfigured ? "success" : "warning"}>
					{status.storageConfigured
						? t("firmware.storageConfigured")
						: t("firmware.storageNotConfigured")}
				</Badge>
				<Badge tone={status.channelAvailable ? "brand" : "neutral"}>
					{status.channelAvailable ? t("firmware.releaseAvailable") : t("firmware.noRelease")}
				</Badge>
				<Badge tone="neutral">
					{t("firmware.windowValue", { start: status.windowStart, end: status.windowEnd })}
				</Badge>
			</div>

			<dl className="space-y-2 text-sm">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<dt className="font-bold text-[#0A3D62] dark:text-slate-100">
						{t("firmware.channelPathLabel")}
					</dt>
					<dd className="font-mono text-xs text-[#3D5568] dark:text-slate-400">
						{status.channelPath}
					</dd>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<dt className="font-bold text-[#0A3D62] dark:text-slate-100">
						{t("firmware.versionLabel")}
					</dt>
					<dd className="text-[#3D5568] dark:text-slate-400">
						{status.channelVersion ?? t("firmware.noRelease")}
					</dd>
				</div>
			</dl>

			<p className="text-xs text-[#3D5568] dark:text-slate-400">{t("firmware.readOnlyNote")}</p>
		</div>
	);
}
