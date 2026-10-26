"use client";

import { DeviceTokenOnce } from "@/components/superadmin/device-token-once";
import { Link, useRouter } from "@/i18n/routing";
import { type OrgPondOption, registerDevice } from "@/lib/actions/platform/devices";
import { Cpu, Loader2, Printer, ShieldAlert } from "lucide-react";
import { type FormEvent, useMemo, useState, useTransition } from "react";

const MIN_REASON = 10;

const inputClass =
	"w-full px-4 py-3 bg-[#F4F7F6] text-[#0A3D62] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#E85A2A] transition-all disabled:opacity-60";
const labelClass = "block text-[10px] uppercase font-extrabold tracking-wider text-[#3D5568]";

type Registered = { deviceId: string; mac: string; token: string | null };

/**
 * Register a feeder unit (plan v2, T15): the chip MAC, a label, and the org and
 * pond it serves. The server re-checks every field; this form only guides.
 */
export function RegisterDeviceForm({ options }: { options: OrgPondOption[] }) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [mac, setMac] = useState("");
	const [label, setLabel] = useState("");
	const [orgId, setOrgId] = useState("");
	const [pondId, setPondId] = useState("");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [registered, setRegistered] = useState<Registered | null>(null);

	const ponds = useMemo(
		() => options.find((o) => o.orgId === orgId)?.ponds ?? [],
		[options, orgId],
	);
	const assignable = options.filter((o) => o.ponds.length > 0);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!mac.trim()) return setError("Enter the chip MAC.");
		if (!label.trim()) return setError("A device label is required.");
		if (!orgId || !pondId) return setError("Choose an organization and a pond.");
		if (reason.trim().length < MIN_REASON) {
			return setError(`Reason must be at least ${MIN_REASON} characters.`);
		}

		startTransition(async () => {
			try {
				const result = await registerDevice({ mac, label, orgId, pondId, reason: reason.trim() });
				if ("error" in result) {
					setError(result.error);
					return;
				}
				setRegistered({ deviceId: result.deviceId, mac: result.mac, token: result.token });
				setMac("");
				setLabel("");
				setPondId("");
				setReason("");
				router.refresh();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Registration failed.");
			}
		});
	};

	return (
		<div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
			<p className="text-xs uppercase font-extrabold tracking-wider text-[#3D5568]">
				Register device
			</p>

			{registered && (
				<div className="space-y-3">
					{registered.token ? (
						<DeviceTokenOnce
							token={registered.token}
							mac={registered.mac}
							onDone={() => setRegistered((r) => (r ? { ...r, token: null } : r))}
						/>
					) : (
						<p className="text-xs font-bold text-[#1E7B34]">
							Registered {registered.mac}. The token is no longer on screen.
						</p>
					)}
					<Link
						href={{ pathname: "/superadmin/devices/labels", query: { id: registered.deviceId } }}
						className="inline-flex items-center gap-2 rounded-xl border border-[#0A3D62]/20 px-4 py-2 text-xs font-black text-[#0A3D62] hover:bg-[#F4F7F6]"
					>
						<Printer className="w-4 h-4" />
						Print sticker for {registered.mac}
					</Link>
				</div>
			)}

			{assignable.length === 0 ? (
				<p className="text-sm text-[#3D5568]">
					No active organization has a pond yet. Create the organization and its farmer account
					first; a device is always registered onto a pond.
				</p>
			) : (
				<form onSubmit={submit} className="space-y-4">
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div className="space-y-1.5">
							<label htmlFor="device-mac" className={labelClass}>
								Chip MAC *
							</label>
							<input
								id="device-mac"
								value={mac}
								onChange={(e) => setMac(e.target.value)}
								disabled={isPending}
								placeholder="A4:CF:12:7E:3B:09"
								autoComplete="off"
								spellCheck={false}
								className={`${inputClass} font-mono`}
							/>
							<p className="text-[11px] text-[#3D5568]">
								The <code>[DEVICE MAC]</code> line in the unit&apos;s boot log. The setup Wi-Fi name
								and the sticker are built from it.
							</p>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="device-label" className={labelClass}>
								Label *
							</label>
							<input
								id="device-label"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								disabled={isPending}
								maxLength={64}
								placeholder="e.g. Pond 2 feeder"
								className={inputClass}
							/>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="device-org" className={labelClass}>
								Organization *
							</label>
							<select
								id="device-org"
								value={orgId}
								onChange={(e) => {
									setOrgId(e.target.value);
									setPondId("");
								}}
								disabled={isPending}
								className={`${inputClass} font-bold`}
							>
								<option value="">Choose…</option>
								{assignable.map((o) => (
									<option key={o.orgId} value={o.orgId}>
										{o.orgName}
									</option>
								))}
							</select>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="device-pond" className={labelClass}>
								Pond *
							</label>
							<select
								id="device-pond"
								value={pondId}
								onChange={(e) => setPondId(e.target.value)}
								disabled={isPending || !orgId}
								className={`${inputClass} font-bold`}
							>
								<option value="">{orgId ? "Choose…" : "Choose an organization first"}</option>
								{ponds.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name} ({p.ownerFarmId})
										{p.deviceCount > 0
											? ` · already ${p.deviceCount} device${p.deviceCount === 1 ? "" : "s"}`
											: ""}
									</option>
								))}
							</select>
						</div>
					</div>

					<div className="space-y-1.5">
						<label htmlFor="device-reason" className={labelClass}>
							Reason *
						</label>
						<input
							id="device-reason"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							disabled={isPending}
							placeholder="e.g. New unit installed for San Pablo coop, pond 2"
							className={inputClass}
						/>
						<p className="text-[11px] text-[#3D5568]">
							Recorded in the platform audit log. At least 10 characters.
						</p>
					</div>

					{error && (
						<div className="bg-red-50 text-[#C42B3A] text-xs p-3 rounded-xl border border-red-200 flex items-start gap-2">
							<ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
							<span className="font-bold">{error}</span>
						</div>
					)}

					<button
						type="submit"
						disabled={isPending}
						className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#E85A2A] text-white font-bold text-sm rounded-xl hover:bg-[#d04a1f] transition-colors shadow-sm disabled:opacity-60"
					>
						{isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
						Register device
					</button>
				</form>
			)}
		</div>
	);
}
