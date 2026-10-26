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
import { type FormEvent, useState, useTransition } from "react";

const ORG_TYPES = ["INDIVIDUAL", "COOPERATIVE", "COMPANY", "LGU", "ACADEMIC"] as const;

type OrgType = (typeof ORG_TYPES)[number];

export function CreateOrgForm() {
	const [isPending, startTransition] = useTransition();
	const [name, setName] = useState("");
	const [type, setType] = useState<OrgType>("INDIVIDUAL");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		if (!name.trim()) return setError("Organization name is required.");
		if (reason.trim().length < 10) return setError("Reason must be at least 10 characters.");

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
				Create organization
			</h2>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div className="space-y-1.5">
					<label htmlFor="org-name" className={FIELD_LABEL}>
						Name *
					</label>
					<input
						id="org-name"
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						disabled={isPending}
						placeholder="e.g. San Pablo Fish Farmers Coop"
						className={FIELD_INPUT}
					/>
				</div>

				<div className="space-y-1.5">
					<label htmlFor="org-type" className={FIELD_LABEL}>
						Type *
					</label>
					<select
						id="org-type"
						value={type}
						onChange={(e) => setType(e.target.value as OrgType)}
						disabled={isPending}
						className={cn(FIELD_INPUT, "font-bold")}
					>
						{ORG_TYPES.map((t) => (
							<option key={t} value={t}>
								{t}
							</option>
						))}
					</select>
				</div>
			</div>

			<div className="space-y-1.5">
				<label htmlFor="org-reason" className={FIELD_LABEL}>
					Reason *
				</label>
				<input
					id="org-reason"
					type="text"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={isPending}
					placeholder="e.g. Tenant onboarding for partner cooperative"
					aria-describedby="org-reason-hint"
					className={FIELD_INPUT}
				/>
				<p id="org-reason-hint" className={FIELD_HINT}>
					Recorded in the platform audit log. At least 10 characters.
				</p>
			</div>

			{error && <Alert tone="error">{error}</Alert>}

			{success && <Alert tone="success">Organization created.</Alert>}

			<button type="submit" disabled={isPending || success} className={PRIMARY_BUTTON}>
				{isPending ? (
					<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
				) : (
					<Plus className="h-4 w-4" aria-hidden="true" />
				)}
				Create Organization
			</button>
		</form>
	);
}
