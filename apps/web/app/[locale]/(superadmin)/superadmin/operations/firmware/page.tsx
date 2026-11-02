import { OpsNav } from "@/components/superadmin/ops-nav";
import {
	Badge,
	Card,
	EmptyState,
	MetaPair,
	MobileCard,
	PageHeader,
	SectionTitle,
	TableFrame,
} from "@/components/superadmin/ui";
import { ItemCardGrid } from "@/components/ui/item-card";
import { ListView } from "@/components/ui/view-toggle";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { formatDateTimeLocal } from "@/lib/date-local";
import { FIRMWARE_DEVICE_LIMIT, getFirmwareFleet } from "@/lib/platform/firmware";
import { Cpu, Download, ShieldCheck, ShieldX, Wifi, WifiOff } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Operations → firmware fleet (E16.4, task I-15).
 *
 * Reports only what the platform can prove: the OTA lifecycle rows each unit
 * wrote, the signed channel version read from the private bucket, and each
 * feeder's last contact. A missing version is shown as "unknown", never
 * guessed from a build date or a device label.
 */
export default async function OperationsFirmwarePage() {
	await requirePlatformAdmin();

	const [fleet, t, tCommon, tDates] = await Promise.all([
		getFirmwareFleet(),
		getTranslations("superadmin.operations"),
		getTranslations("superadmin.common"),
		getTranslations("dates"),
	]);

	const lastSeen = (value: Date | null) =>
		value ? formatDateTimeLocal(value, tDates).full : tCommon("never");
	// An unknown event type (a future firmware state) is shown verbatim rather
	// than as a missing message key.
	const eventLabel = (eventType: string) => {
		const key = `firmware.eventTypes.${eventType}`;
		return t.has(key) ? t(key) : eventType;
	};
	const channel = fleet.channel;

	return (
		<div className="space-y-6">
			<PageHeader title={t("firmware.title")} description={t("firmware.description")} />
			<OpsNav />

			<Card className="p-5">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 className="font-black text-[#0A3D62] dark:text-slate-100">
							{t("firmware.channelTitle")}
						</h2>
						<p className="mt-1 text-xs text-[#3D5568] dark:text-slate-400">
							{t("firmware.channelDescription")}
						</p>
					</div>
					<Badge
						tone={channel.channelAvailable ? "success" : "neutral"}
						icon={channel.channelAvailable ? ShieldCheck : ShieldX}
					>
						{channel.channelAvailable ? t("firmware.releaseAvailable") : t("firmware.noRelease")}
					</Badge>
				</div>
				<dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<div>
						<dt className="text-[10px] font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400 uppercase">
							{t("firmware.stableVersion")}
						</dt>
						<dd className="mt-1 font-mono text-sm font-black text-[#0A3D62] dark:text-slate-100">
							{channel.channelVersion ?? t("firmware.unknown")}
						</dd>
					</div>
					<div>
						<dt className="text-[10px] font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400 uppercase">
							{t("firmware.storage")}
						</dt>
						<dd className="mt-1 text-sm font-bold text-[#3D5568] dark:text-slate-400">
							{channel.storageConfigured
								? t("firmware.storageConfigured")
								: t("firmware.storageNotConfigured")}
						</dd>
					</div>
					<div className="min-w-0">
						<dt className="text-[10px] font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400 uppercase">
							{t("firmware.channelPath")}
						</dt>
						<dd className="mt-1 truncate font-mono text-xs text-[#3D5568] dark:text-slate-400">
							{channel.channelPath}
						</dd>
					</div>
					<div>
						<dt className="text-[10px] font-extrabold tracking-wider text-[#3D5568] dark:text-slate-400 uppercase">
							{t("firmware.window")}
						</dt>
						<dd className="mt-1 text-sm font-bold text-[#3D5568] dark:text-slate-400">
							{t("firmware.windowValue", {
								start: channel.windowStart,
								end: channel.windowEnd,
							})}
						</dd>
					</div>
				</dl>
				<p className="mt-4 text-[11px] text-[#3D5568] dark:text-slate-400">
					{t("firmware.readOnlyNote")}
				</p>
			</Card>

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<Card>
					<SectionTitle
						title={t("firmware.devicesTitle", { count: fleet.devices.length })}
						description={t("firmware.devicesDescription")}
					/>
					{fleet.devices.length === 0 ? (
						<EmptyState icon={Cpu} title={t("firmware.emptyTitle")} />
					) : (
						<ListView
							pageKey="superadmin-operations-firmware"
							listLabel={tCommon("viewToggle.list")}
							cardsLabel={tCommon("viewToggle.cards")}
							toggleLabel={tCommon("viewToggle.label")}
						>
							<ItemCardGrid label={t("firmware.devicesCaption")}>
								{fleet.devices.map((device) => (
									<MobileCard key={device.id}>
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0">
												<p className="truncate font-black text-[#0A3D62] dark:text-slate-100">
													{device.label}
												</p>
												<p className="truncate font-mono text-[11px] font-bold text-[#3D5568] dark:text-slate-400">
													{device.mac}
												</p>
											</div>
											<Badge tone={device.online ? "success" : "danger"}>
												{device.online ? tCommon("online") : tCommon("offline")}
											</Badge>
										</div>
										<dl className="grid grid-cols-2 gap-2">
											<MetaPair label={t("firmware.columnVersion")}>
												{device.reportedVersion ?? t("firmware.unknown")}
											</MetaPair>
											<MetaPair label={t("firmware.columnPond")}>
												{device.pondName ?? tCommon("unassigned")}
											</MetaPair>
											<MetaPair label={t("firmware.columnLastContact")}>
												{lastSeen(device.lastSeenAt)}
											</MetaPair>
											<MetaPair label={t("firmware.columnVersionSource")}>
												{device.versionEvent
													? eventLabel(device.versionEvent.eventType)
													: t("firmware.unknown")}
											</MetaPair>
										</dl>
									</MobileCard>
								))}
							</ItemCardGrid>

							<TableFrame
								className="hidden md:block"
								label={t("firmware.devicesCaption")}
								minWidth="min-w-[52rem]"
								columns={[
									{ key: "device", label: t("firmware.columnDevice") },
									{ key: "mac", label: t("firmware.columnMac") },
									{ key: "pond", label: t("firmware.columnPond") },
									{ key: "version", label: t("firmware.columnVersion") },
									{ key: "source", label: t("firmware.columnVersionSource") },
									{ key: "lastContact", label: t("firmware.columnLastContact") },
									{ key: "status", label: t("firmware.columnStatus") },
								]}
							>
								{fleet.devices.map((device) => (
									<tr
										key={device.id}
										className="border-b border-gray-50 dark:border-[#1B2740] align-middle last:border-0 hover:bg-[#F4F7F6] dark:hover:bg-[#162238]/50 dark:hover:bg-[#162238]/60"
									>
										<td className="px-6 py-3 font-black text-[#0A3D62] dark:text-slate-100">
											{device.label}
										</td>
										<td className="px-6 py-3 font-mono text-xs font-bold text-[#3D5568] dark:text-slate-400">
											{device.mac}
										</td>
										<td className="px-6 py-3 text-xs font-bold text-[#3D5568] dark:text-slate-400">
											{device.pondName ?? tCommon("unassigned")}
										</td>
										<td className="px-6 py-3 font-mono text-xs font-black text-[#0A3D62] dark:text-slate-100">
											{device.reportedVersion ?? t("firmware.unknown")}
										</td>
										<td className="px-6 py-3 text-xs text-[#3D5568] dark:text-slate-400">
											{device.versionEvent ? (
												<span className="flex flex-col">
													<span>{eventLabel(device.versionEvent.eventType)}</span>
													<span className="text-[11px]">
														{lastSeen(device.versionEvent.createdAt)}
													</span>
												</span>
											) : (
												t("firmware.unknown")
											)}
										</td>
										<td className="px-6 py-3 text-xs text-[#3D5568] dark:text-slate-400">
											{lastSeen(device.lastSeenAt)}
										</td>
										<td className="px-6 py-3">
											<Badge tone={device.online ? "success" : "danger"}>
												{device.online ? tCommon("online") : tCommon("offline")}
											</Badge>
										</td>
									</tr>
								))}
							</TableFrame>
						</ListView>
					)}
					{fleet.devicesTruncated && (
						<p className="border-t border-gray-100 dark:border-[#1B2740] px-5 py-3 text-xs font-bold text-[#B45309] dark:text-amber-300">
							{t("firmware.truncated", { limit: FIRMWARE_DEVICE_LIMIT })}
						</p>
					)}
				</Card>

				<div className="space-y-4">
					<Card>
						<SectionTitle
							title={t("firmware.versionTitle")}
							description={t("firmware.versionDescription")}
						/>
						<ul className="space-y-2 px-5 py-4">
							{fleet.versionCounts.map((entry) => (
								<li
									key={entry.version ?? "unknown"}
									className="flex items-center justify-between gap-3 text-sm"
								>
									<span className="font-mono font-bold text-[#0A3D62] dark:text-slate-100">
										{entry.version ?? t("firmware.unknown")}
									</span>
									<span className="tabular-nums font-black text-[#3D5568] dark:text-slate-400">
										{entry.count}
									</span>
								</li>
							))}
							{fleet.unknownCount > 0 && (
								<li className="flex items-center justify-between gap-3 border-t border-gray-100 dark:border-[#1B2740] pt-2 text-sm">
									<span className="font-bold text-[#3D5568] dark:text-slate-400">
										{t("firmware.noVersion")}
									</span>
									<span className="tabular-nums font-black text-[#3D5568] dark:text-slate-400">
										{fleet.unknownCount}
									</span>
								</li>
							)}
						</ul>
					</Card>

					<Card>
						<SectionTitle
							title={t("firmware.otaTitle")}
							description={t("firmware.otaDescription")}
						/>
						{fleet.otaEvents.length === 0 ? (
							<EmptyState icon={Download} title={t("firmware.noOtaTitle")} />
						) : (
							<ul className="divide-y divide-gray-100">
								{fleet.otaEvents.map((event) => (
									<li key={event.id} className="px-5 py-3">
										<div className="flex items-center justify-between gap-2">
											<Badge tone={event.eventType === "ota_rolled_back" ? "warning" : "brand"}>
												{eventLabel(event.eventType)}
											</Badge>
											<span className="font-mono text-[11px] font-bold text-[#0A3D62] dark:text-slate-100">
												{event.version ?? t("firmware.unknown")}
											</span>
										</div>
										<p className="mt-1 truncate text-xs font-bold text-[#3D5568] dark:text-slate-400">
											{event.deviceLabel}
										</p>
										<p className="text-[11px] text-[#3D5568] dark:text-slate-400">
											{lastSeen(event.createdAt)}
										</p>
									</li>
								))}
							</ul>
						)}
					</Card>

					<Card className="flex items-start gap-3 p-5">
						<Wifi
							className="mt-0.5 h-4 w-4 shrink-0 text-[#1E7B34] dark:text-emerald-300"
							aria-hidden="true"
						/>
						<p className="text-xs text-[#3D5568] dark:text-slate-400">
							{t("firmware.versionSourceNote")}
						</p>
					</Card>
					<Card className="flex items-start gap-3 p-5">
						<WifiOff
							className="mt-0.5 h-4 w-4 shrink-0 text-[#C42B3A] dark:text-red-300"
							aria-hidden="true"
						/>
						<p className="text-xs text-[#3D5568] dark:text-slate-400">
							{t("firmware.unknownNote")}
						</p>
					</Card>
				</div>
			</div>
		</div>
	);
}
