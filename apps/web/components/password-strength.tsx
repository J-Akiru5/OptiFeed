"use client";

import { getPasswordStrength, passwordChecks } from "@/lib/auth/password";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";

const STRENGTH_COLORS = {
	weak: "bg-[#D92D20]",
	medium: "bg-[#E85A2A]",
	strong: "bg-[#1E7B34]",
} as const;

const STRENGTH_TEXT = {
	weak: "text-[#D92D20] dark:text-red-400",
	medium: "text-[#B54708] dark:text-amber-400",
	strong: "text-[#1E7B34] dark:text-green-400",
} as const;

export function PasswordStrength({ password }: { password: string }) {
	const t = useTranslations("password");

	if (!password) return null;

	const strength = getPasswordStrength(password);
	const checks = passwordChecks(password);
	const filled = strength === "weak" ? 1 : strength === "medium" ? 2 : 3;

	return (
		<div className="mt-2 space-y-2" aria-live="polite">
			<div className="flex gap-1.5" aria-hidden="true">
				{[0, 1, 2].map((index) => (
					<span
						key={index}
						className={cn(
							"h-1.5 flex-1 rounded-full transition-colors",
							index < filled ? STRENGTH_COLORS[strength] : "bg-gray-200 dark:bg-gray-700",
						)}
					/>
				))}
			</div>
			<div className="flex items-center justify-between gap-3 text-[11px]">
				<span className="text-[#3D5568] dark:text-slate-400">{t("strength.label")}</span>
				<span className={cn("font-bold", STRENGTH_TEXT[strength])}>
					{t(`strength.${strength}`)}
				</span>
			</div>
			<ul className="space-y-1 text-[11px]">
				<Requirement met={checks.minLength} label={t("requirements.minLength")} />
				<Requirement met={checks.letter} label={t("requirements.letter")} />
				<Requirement met={checks.number} label={t("requirements.number")} />
			</ul>
		</div>
	);
}

function Requirement({ met, label }: { met: boolean; label: string }) {
	return (
		<li
			className={cn(
				"flex items-center gap-1.5",
				met ? "text-[#1E7B34] dark:text-green-400" : "text-[#3D5568] dark:text-slate-400",
			)}
		>
			{met ? (
				<Check className="size-3" aria-hidden="true" />
			) : (
				<X className="size-3" aria-hidden="true" />
			)}
			<span>{label}</span>
		</li>
	);
}
