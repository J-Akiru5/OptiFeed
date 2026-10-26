"use client";

import { DeviceTokenOnce } from "@/components/superadmin/device-token-once";
import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import {
	Alert,
	CARD,
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	PRIMARY_BUTTON,
	SECONDARY_BUTTON,
} from "@/components/superadmin/ui";
import { Link, useRouter } from "@/i18n/routing";
import { type OrgPondOption, registerDevice } from "@/lib/actions/platform/devices";
import { cn } from "@/lib/utils";
import { Cpu, Loader2, Printer } from "lucide-react";
import { type FormEvent, useMemo, useRef, useState, useTransition } from "react";

const MIN_REASON = 10;

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
	const [stepUpOpen, setStepUpOpen] = useState(false);
	const retryRef = useRef<(() => void) | null>(null);

	const ponds = useMemo(
		() => options.find((o) => o.orgId === orgId)?.ponds ?? [],
		[options, orgId],
	);
	const assignable = options.filter((o) => o.ponds.length > 0);

	const run = (input: {
		mac: string;
		label: string;
		orgId: string;
		pondId: string;
		reason: string;
	}) => {
		startTransition(async () => {
			try {
				const result = await registerDevice(input);
				if ("error" in result) {
					if (result.code === "step_up_required") {
						retryRef.current = () => run(input);
						setStepUpOpen(true);
						return;
					}
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

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!mac.trim()) return setError("Enter the chip MAC.");
		if (!label.trim()) return setError("A device label is required.");
		if (!orgId || !pondId) return setError("Choose an organization and a pond.");
		if (reason.trim().length < MIN_REASON) {
			return setError(`Reason must be at least ${MIN_REASON} characters.`);
		}

		run({ mac, label, orgId, pondId, reason: reason.trim() });
	};

	const onVerified = () => {
		setStepUpOpen(false);
		const retry = retryRef.current;
		retryRef.current = null;
		retry?.();
	};

	return (
		<div className={cn(CARD, "space-y-4 p-6")}>
			<h2 className="text-xs font-extrabold uppercase tracking-wider text-[#3D5568]">
				Register device
			</h2>

			{registered && (
				<div className="space-y-3">
					{registered.token ? (
						<DeviceTokenOnce
							token={registered.token}
							mac={registered.mac}
							onDone={() => setRegistered((r) => (r ? { ...r, token: null } : r))}
						/>
					) : (
						<Alert tone="success">
							Registered {registered.mac}. The token is no longer on screen.
						</Alert>
					)}
					<Link
						href={{ pathname: "/superadmin/devices/labels", query: { id: registered.deviceId } }}
						className={SECONDARY_BUTTON}
					>
						<Printer className="h-4 w-4" aria-hidden="true" />
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
				<form onSubmit={submit} className="space-y-4" aria-busy={isPending}>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-1.5">
							<label htmlFor="device-mac" className={FIELD_LABEL}>
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
								aria-describedby="device-mac-hint"
								className={cn(FIELD_INPUT, "font-mono")}
							/>
							<p id="device-mac-hint" className={FIELD_HINT}>
								The <code>[DEVICE MAC]</code> line in the unit&apos;s boot log. The setup Wi-Fi name
								and the sticker are built from it.
							</p>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="device-label" className={FIELD_LABEL}>
								Label *
							</label>
							<input
								id="device-label"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								disabled={isPending}
								maxLength={64}
								placeholder="e.g. Pond 2 feeder"
								className={FIELD_INPUT}
							/>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="device-org" className={FIELD_LABEL}>
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
								className={cn(FIELD_INPUT, "font-bold")}
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
							<label htmlFor="device-pond" className={FIELD_LABEL}>
								Pond *
							</label>
							<select
								id="device-pond"
								value={pondId}
								onChange={(e) => setPondId(e.target.value)}
								disabled={isPending || !orgId}
								className={cn(FIELD_INPUT, "font-bold")}
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
						<label htmlFor="device-reason" className={FIELD_LABEL}>
							Reason *
						</label>
						<input
							id="device-reason"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							disabled={isPending}
							placeholder="e.g. New unit installed for San Pablo coop, pond 2"
							aria-describedby="device-reason-hint"
							className={FIELD_INPUT}
						/>
						<p id="device-reason-hint" className={FIELD_HINT}>
							Recorded in the platform audit log. At least 10 characters.
						</p>
					</div>

					{error && <Alert tone="error">{error}</Alert>}

					<button type="submit" disabled={isPending} className={PRIMARY_BUTTON}>
						{isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
						) : (
							<Cpu className="h-4 w-4" aria-hidden="true" />
						)}
						Register device
					</button>
				</form>
			)}

			<StepUpDialog
				open={stepUpOpen}
				actionLabel="register this device"
				onClose={() => setStepUpOpen(false)}
				onVerified={onVerified}
			/>
		</div>
	);
}
