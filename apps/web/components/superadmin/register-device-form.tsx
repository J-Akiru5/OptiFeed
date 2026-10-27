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
import { useTranslations } from "next-intl";
import { type FormEvent, useMemo, useRef, useState, useTransition } from "react";

const MIN_REASON = 10;

type Registered = { deviceId: string; mac: string; token: string | null };

/**
 * Register a feeder unit (plan v2, T15): the chip MAC, a label, and the org and
 * pond it serves. The server re-checks every field; this form only guides.
 */
export function RegisterDeviceForm({ options }: { options: OrgPondOption[] }) {
	const t = useTranslations("superadmin.registerDevice");
	const tCommon = useTranslations("superadmin.common");
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
				setError(err instanceof Error ? err.message : t("failed"));
			}
		});
	};

	const submit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!mac.trim()) return setError(t("macRequired"));
		if (!label.trim()) return setError(t("labelRequired"));
		if (!orgId || !pondId) return setError(t("orgPondRequired"));
		if (reason.trim().length < MIN_REASON) {
			return setError(tCommon("reasonMinLength", { count: MIN_REASON }));
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
		<div className={cn(CARD, "space-y-4 p-6")} data-help="superadmin-register-device">
			<h2 className="text-xs font-extrabold uppercase tracking-wider text-[#3D5568]">
				{t("title")}
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
						<Alert tone="success">{t("registered", { mac: registered.mac })}</Alert>
					)}
					<Link
						href={{ pathname: "/superadmin/devices/labels", query: { id: registered.deviceId } }}
						className={SECONDARY_BUTTON}
					>
						<Printer className="h-4 w-4" aria-hidden="true" />
						{t("printSticker", { mac: registered.mac })}
					</Link>
				</div>
			)}

			{assignable.length === 0 ? (
				<p className="text-sm text-[#3D5568]">{t("noPonds")}</p>
			) : (
				<form onSubmit={submit} className="space-y-4" aria-busy={isPending}>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-1.5">
							<label htmlFor="device-mac" className={FIELD_LABEL}>
								{t("mac")}
							</label>
							<input
								id="device-mac"
								value={mac}
								onChange={(e) => setMac(e.target.value)}
								disabled={isPending}
								placeholder={t("macPlaceholder")}
								autoComplete="off"
								spellCheck={false}
								aria-describedby="device-mac-hint"
								className={cn(FIELD_INPUT, "font-mono")}
							/>
							<p id="device-mac-hint" className={FIELD_HINT}>
								{t("macHintBefore")} <code>[DEVICE MAC]</code> {t("macHintAfter")}
							</p>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="device-label" className={FIELD_LABEL}>
								{t("label")}
							</label>
							<input
								id="device-label"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								disabled={isPending}
								maxLength={64}
								placeholder={t("labelPlaceholder")}
								className={FIELD_INPUT}
							/>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="device-org" className={FIELD_LABEL}>
								{t("org")}
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
								<option value="">{tCommon("choose")}</option>
								{assignable.map((o) => (
									<option key={o.orgId} value={o.orgId}>
										{o.orgName}
									</option>
								))}
							</select>
						</div>
						<div className="space-y-1.5">
							<label htmlFor="device-pond" className={FIELD_LABEL}>
								{t("pond")}
							</label>
							<select
								id="device-pond"
								value={pondId}
								onChange={(e) => setPondId(e.target.value)}
								disabled={isPending || !orgId}
								className={cn(FIELD_INPUT, "font-bold")}
							>
								<option value="">{orgId ? tCommon("choose") : t("chooseOrgFirst")}</option>
								{ponds.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name} ({p.ownerFarmId})
										{p.deviceCount > 0 ? ` ${t("alreadyDevices", { count: p.deviceCount })}` : ""}
									</option>
								))}
							</select>
						</div>
					</div>

					<div className="space-y-1.5">
						<label htmlFor="device-reason" className={FIELD_LABEL}>
							{tCommon("reasonRequired")}
						</label>
						<input
							id="device-reason"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							disabled={isPending}
							placeholder={t("reasonPlaceholder")}
							aria-describedby="device-reason-hint"
							className={FIELD_INPUT}
						/>
						<p id="device-reason-hint" className={FIELD_HINT}>
							{t("reasonHint")}
						</p>
					</div>

					{error && <Alert tone="error">{error}</Alert>}

					<button type="submit" disabled={isPending} className={PRIMARY_BUTTON}>
						{isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
						) : (
							<Cpu className="h-4 w-4" aria-hidden="true" />
						)}
						{t("button")}
					</button>
				</form>
			)}

			<StepUpDialog
				open={stepUpOpen}
				actionLabel={t("stepUpAction")}
				onClose={() => setStepUpOpen(false)}
				onVerified={onVerified}
			/>
		</div>
	);
}
