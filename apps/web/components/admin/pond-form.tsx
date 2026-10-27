"use client";

import {
	adminButtonPrimary,
	adminButtonSecondary,
	adminField,
	adminHint,
	adminLabel,
	adminSurface,
} from "@/components/admin/admin-classes";
import { useRouter } from "@/i18n/routing";
import { createTenantPond, updateTenantPond } from "@/lib/actions/ponds";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

export type PondFormOwner = {
	farmId: string;
	ownerName: string;
	farmName: string | null;
};

export type PondFormDefaults = {
	name: string;
	ownerFarmId: string;
	population: string;
	sampleIntervalDays: string;
	feedingRatePct: string;
	feedsPerDay: string;
	scheduleStart: string;
	scheduleEnd: string;
	stockingDate: string;
};

/**
 * Create/edit form for a pond (#202).
 *
 * One component serves both modes so the fields, validation hints and error
 * surface cannot drift apart. The owner list is resolved on the server from the
 * caller's org scope; the action re-checks every id, so the select is a
 * convenience rather than a guard.
 */
export function PondForm({
	mode,
	owners,
	pondId,
	defaults,
}: {
	mode: "create" | "edit";
	owners: PondFormOwner[];
	pondId?: string;
	defaults: PondFormDefaults;
}) {
	const t = useTranslations("dashboard.adminPondForm");
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const hasOwners = owners.length > 0;

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);

		const formData = new FormData(event.currentTarget);
		const stockingDate = String(formData.get("stockingDate") ?? "").trim();
		const populationRaw = String(formData.get("population") ?? "").trim();
		const population = populationRaw === "" ? null : Number.parseInt(populationRaw, 10);

		if (mode === "create" && stockingDate && (population === null || Number.isNaN(population))) {
			setError(t("stockingDateWarning"));
			return;
		}

		const shared: {
			name: string;
			ownerFarmId: string;
			population: number | null;
			sampleIntervalDays: number;
			feedingRatePct: number;
			feedsPerDay: number;
			scheduleStart: string;
			scheduleEnd: string;
		} = {
			name: String(formData.get("name") ?? ""),
			ownerFarmId: String(formData.get("ownerFarmId") ?? ""),
			population: population !== null && !Number.isNaN(population) ? population : null,
			sampleIntervalDays: Number.parseInt(String(formData.get("sampleIntervalDays") ?? ""), 10),
			feedingRatePct: Number.parseFloat(String(formData.get("feedingRatePct") ?? "")),
			feedsPerDay: Number.parseInt(String(formData.get("feedsPerDay") ?? ""), 10),
			scheduleStart: String(formData.get("scheduleStart") ?? ""),
			scheduleEnd: String(formData.get("scheduleEnd") ?? ""),
		};

		setPending(true);
		try {
			const result =
				mode === "create"
					? await createTenantPond({
							...shared,
							stockingDate: stockingDate || null,
						})
					: await updateTenantPond({ ...shared, pondId: pondId ?? "" });

			if ("error" in result) {
				setError(result.error);
				return;
			}

			router.push("pondId" in result ? `/admin/ponds/${result.pondId}` : `/admin/ponds/${pondId}`);
			router.refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : t("errorGeneric"));
		} finally {
			setPending(false);
		}
	}

	return (
		<form onSubmit={onSubmit} className={`${adminSurface} space-y-6 p-4 sm:p-6`}>
			{error && (
				<div
					role="alert"
					className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-[#C42B3A] dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
				>
					{error}
				</div>
			)}

			{!hasOwners && (
				<p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-[#8A4B08] dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300">
					{t("noOwners")}
				</p>
			)}

			<fieldset className="m-0 space-y-4 border-0 p-0">
				<legend className="mb-1.5 block text-xs font-black tracking-wider text-[#0A3D62] uppercase dark:text-[#8fc0ea]">
					{t("pondLegend")}
				</legend>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label htmlFor="pond-name" className={adminLabel}>
							{t("nameLabel")}
						</label>
						<input
							id="pond-name"
							name="name"
							required
							maxLength={80}
							defaultValue={defaults.name}
							placeholder={t("namePlaceholder")}
							className={adminField}
						/>
					</div>
					<div>
						<label htmlFor="pond-owner" className={adminLabel}>
							{t("ownerLabel")}
						</label>
						<select
							id="pond-owner"
							name="ownerFarmId"
							required
							defaultValue={defaults.ownerFarmId}
							disabled={!hasOwners}
							className={adminField}
						>
							{!hasOwners && <option value="">{t("noOwnersOption")}</option>}
							{owners.map((owner) => (
								<option key={owner.farmId} value={owner.farmId}>
									{owner.ownerName}
									{owner.farmName ? ` — ${owner.farmName}` : ""}
								</option>
							))}
						</select>
						<p className={adminHint}>{t("ownerHint")}</p>
					</div>
				</div>

				<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
					<div>
						<label htmlFor="pond-population" className={adminLabel}>
							{t("populationLabel")}
						</label>
						<input
							id="pond-population"
							name="population"
							type="number"
							min="1"
							max="1000000"
							defaultValue={defaults.population}
							placeholder={t("populationPlaceholder")}
							className={adminField}
						/>
					</div>
					<div>
						<label htmlFor="pond-feeding-rate" className={adminLabel}>
							{t("feedingRateLabel")}
						</label>
						<input
							id="pond-feeding-rate"
							name="feedingRatePct"
							type="number"
							step="0.1"
							min="0.1"
							max="10"
							required
							defaultValue={defaults.feedingRatePct}
							className={adminField}
						/>
					</div>
					<div>
						<label htmlFor="pond-feeds-per-day" className={adminLabel}>
							{t("feedsPerDayLabel")}
						</label>
						<input
							id="pond-feeds-per-day"
							name="feedsPerDay"
							type="number"
							min="1"
							max="24"
							required
							defaultValue={defaults.feedsPerDay}
							className={adminField}
						/>
					</div>
					<div>
						<label htmlFor="pond-sample-interval" className={adminLabel}>
							{t("sampleIntervalLabel")}
						</label>
						<input
							id="pond-sample-interval"
							name="sampleIntervalDays"
							type="number"
							min="1"
							max="365"
							required
							defaultValue={defaults.sampleIntervalDays}
							className={adminField}
						/>
						<p className={adminHint}>{t("sampleIntervalHint")}</p>
					</div>
				</div>

				<div className="grid grid-cols-2 gap-4">
					<div>
						<label htmlFor="pond-schedule-start" className={adminLabel}>
							{t("scheduleStartLabel")}
						</label>
						<input
							id="pond-schedule-start"
							name="scheduleStart"
							type="time"
							required
							defaultValue={defaults.scheduleStart}
							className={adminField}
						/>
					</div>
					<div>
						<label htmlFor="pond-schedule-end" className={adminLabel}>
							{t("scheduleEndLabel")}
						</label>
						<input
							id="pond-schedule-end"
							name="scheduleEnd"
							type="time"
							required
							defaultValue={defaults.scheduleEnd}
							className={adminField}
						/>
					</div>
				</div>
			</fieldset>

			{mode === "create" && (
				<fieldset className="m-0 space-y-4 border-0 border-t border-gray-100 p-0 pt-5 dark:border-gray-800">
					<legend className="mb-1.5 block text-xs font-black tracking-wider text-[#0A3D62] uppercase dark:text-[#8fc0ea]">
						{t("stockingLegend")}
					</legend>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div>
							<label htmlFor="pond-stocking-date" className={adminLabel}>
								{t("stockingDateLabel")}
							</label>
							<input
								id="pond-stocking-date"
								name="stockingDate"
								type="date"
								defaultValue={defaults.stockingDate}
								className={adminField}
							/>
							<p className={adminHint}>{t("stockingDateHint")}</p>
						</div>
					</div>
				</fieldset>
			)}

			<div className="flex flex-wrap items-center gap-3">
				<button
					type="submit"
					disabled={pending || !hasOwners}
					aria-busy={pending}
					className={adminButtonPrimary}
				>
					{pending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
					{pending ? t("submitting") : mode === "create" ? t("submitCreate") : t("submitEdit")}
				</button>
				<button
					type="button"
					onClick={() => router.back()}
					disabled={pending}
					className={adminButtonSecondary}
				>
					{t("cancel")}
				</button>
			</div>
		</form>
	);
}
