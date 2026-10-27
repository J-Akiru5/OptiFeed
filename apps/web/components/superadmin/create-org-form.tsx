"use client";

import {
	Alert,
	CARD,
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	PRIMARY_BUTTON,
} from "@/components/superadmin/ui";
import { createOrg } from "@/lib/actions/superadmin";
import { cn } from "@/lib/utils";
import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";

const ORG_TYPES = ["INDIVIDUAL", "COOPERATIVE", "COMPANY", "LGU", "ACADEMIC"] as const;

type OrgType = (typeof ORG_TYPES)[number];

export function CreateOrgForm() {
	const t = useTranslations("superadmin.createOrg");
	const tCommon = useTranslations("superadmin.common");
	const tRoot = useTranslations("superadmin");
	const [isPending, startTransition] = useTransition();
	const [name, setName] = useState("");
	const [type, setType] = useState<OrgType>("INDIVIDUAL");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!name.trim()) return setError(t("nameRequired"));
		if (reason.trim().length < 10) return setError(tCommon("reasonMinLength", { count: 10 }));

		startTransition(async () => {
			const result = await createOrg({ name, type, reason: reason.trim() });
			if ("error" in result) {
				setError(result.error);
				return;
			}
			setSuccess(true);
			setName("");
			setReason("");
			// Caller revalidates via server action; just clear the form state.
			setTimeout(() => setSuccess(false), 2000);
		});
	};

	return (
		<form onSubmit={handleSubmit} className={cn(CARD, "space-y-4 p-6")} aria-busy={isPending}>
			<h2 className="text-xs font-extrabold uppercase tracking-wider text-[#3D5568]">
				{t("title")}
			</h2>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div className="space-y-1.5">
					<label htmlFor="org-name" className={FIELD_LABEL}>
						{t("name")}
					</label>
					<input
						id="org-name"
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						disabled={isPending}
						placeholder={t("namePlaceholder")}
						className={FIELD_INPUT}
					/>
				</div>

				<div className="space-y-1.5">
					<label htmlFor="org-type" className={FIELD_LABEL}>
						{tCommon("type")} *
					</label>
					<select
						id="org-type"
						value={type}
						onChange={(e) => setType(e.target.value as OrgType)}
						disabled={isPending}
						className={cn(FIELD_INPUT, "font-bold")}
					>
						{ORG_TYPES.map((option) => (
							<option key={option} value={option}>
								{tRoot(`orgTypes.${option}`)}
							</option>
						))}
					</select>
				</div>
			</div>

			<div className="space-y-1.5">
				<label htmlFor="org-reason" className={FIELD_LABEL}>
					{tCommon("reasonRequired")}
				</label>
				<input
					id="org-reason"
					type="text"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={isPending}
					placeholder={t("reasonPlaceholder")}
					aria-describedby="org-reason-hint"
					className={FIELD_INPUT}
				/>
				<p id="org-reason-hint" className={FIELD_HINT}>
					{t("reasonHint")}
				</p>
			</div>

			{error && <Alert tone="error">{error}</Alert>}

			{success && <Alert tone="success">{t("created")}</Alert>}

			<button type="submit" disabled={isPending || success} className={PRIMARY_BUTTON}>
				{isPending ? (
					<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
				) : (
					<Plus className="h-4 w-4" aria-hidden="true" />
				)}
				{t("submit")}
			</button>
		</form>
	);
}
