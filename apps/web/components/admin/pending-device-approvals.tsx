"use client";

import { adminButtonSecondary } from "@/components/admin/admin-classes";
import { useRouter } from "@/i18n/routing";
import { approveTenantDevice, rejectTenantDevice } from "@/lib/actions/device-registration";
import { Check, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Pending-approval queue for org-owned feeders (issue #190).
 *
 * A device registered under ADMIN_APPROVAL has a token but no access until an
 * OWNER/ADMIN with `claim_feeder` approves it. Approving makes the unit usable
 * (and its token revealable); rejecting keeps it blocked. Both write a device
 * audit event in the action.
 */

export type PendingDeviceRow = {
	id: string;
	label: string;
	mac: string;
	pondName: string | null;
};

export function PendingDeviceApprovals({ devices }: { devices: PendingDeviceRow[] }) {
	const t = useTranslations("dashboard.adminDevices");
	const router = useRouter();
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	if (devices.length === 0) return null;

	async function decide(deviceId: string, approve: boolean) {
		setPendingId(deviceId);
		setError(null);
		try {
			const result = approve
				? await approveTenantDevice(deviceId)
				: await rejectTenantDevice(deviceId);
			if ("error" in result) {
				setError(result.error);
				toast.error(result.error);
				return;
			}
			toast.success(approve ? t("approveSuccess") : t("rejectSuccess"));
			router.refresh();
		} catch {
			setError(t("decisionError"));
			toast.error(t("decisionError"));
		} finally {
			setPendingId(null);
		}
	}

	return (
		<section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700/60 dark:bg-amber-950/30">
			<h2 className="font-black text-[#8A4B08] dark:text-amber-300">
				{t("pendingTitle", { count: devices.length })}
			</h2>
			<p className="mt-1 text-xs font-bold text-[#8A4B08] dark:text-amber-200">
				{t("pendingDesc")}
			</p>

			{error && (
				<div role="alert" className="mt-3 text-sm font-bold text-[#C42B3A] dark:text-red-300">
					{error}
				</div>
			)}

			<ul className="mt-3 space-y-2">
				{devices.map((device) => (
					<li
						key={device.id}
						className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-3 dark:border-amber-800/60 dark:bg-gray-900"
					>
						<div className="min-w-0">
							<p className="truncate font-black text-[#0A3D62] dark:text-gray-100">
								{device.label}
							</p>
							<p className="font-mono text-[11px] font-bold text-[#3D5568] dark:text-gray-400">
								{device.mac}
							</p>
							<p className="text-[11px] text-[#3D5568] dark:text-gray-400">
								{t("pendingPond", { pond: device.pondName ?? t("unassigned") })}
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() => decide(device.id, true)}
								disabled={pendingId !== null}
								aria-label={t("approveDevice", { label: device.label })}
								className={adminButtonSecondary}
							>
								{pendingId === device.id ? (
									<Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Check aria-hidden="true" className="h-3.5 w-3.5" />
								)}
								{t("approve")}
							</button>
							<button
								type="button"
								onClick={() => decide(device.id, false)}
								disabled={pendingId !== null}
								aria-label={t("rejectDevice", { label: device.label })}
								className={adminButtonSecondary}
							>
								<X aria-hidden="true" className="h-3.5 w-3.5" />
								{t("reject")}
							</button>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}
