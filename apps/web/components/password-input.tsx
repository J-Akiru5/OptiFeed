"use client";

import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function PasswordInput({
	id,
	name,
	value,
	onChange,
	autoComplete = "new-password",
	placeholder,
	required,
	disabled,
	className,
	ariaInvalid,
	ariaDescribedBy,
	maxLength = 72,
	revealable = true,
}: {
	id: string;
	name?: string;
	value: string;
	onChange: (value: string) => void;
	autoComplete?: string;
	placeholder?: string;
	required?: boolean;
	disabled?: boolean;
	className?: string;
	ariaInvalid?: boolean;
	ariaDescribedBy?: string;
	maxLength?: number;
	/**
	 * Offer the show/hide toggle. Turn this off for a credential the user must
	 * already know (the current password): a password manager can autofill it,
	 * so revealing it would print the account's real password on screen.
	 */
	revealable?: boolean;
}) {
	const t = useTranslations("password");
	const [visible, setVisible] = useState(false);

	return (
		<div className="relative">
			<input
				id={id}
				name={name ?? id}
				type={visible && revealable ? "text" : "password"}
				data-revealable={revealable ? "true" : "false"}
				autoComplete={autoComplete}
				autoCapitalize="none"
				autoCorrect="off"
				spellCheck={false}
				maxLength={maxLength}
				required={required}
				disabled={disabled}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				aria-invalid={ariaInvalid}
				aria-describedby={ariaDescribedBy}
				className={cn(
					"w-full rounded-xl border border-gray-200 bg-[#F4F7F6] px-4 py-3 text-sm font-bold text-[#0A3D62] transition-all focus:outline-none focus:ring-2 focus:ring-[#E85A2A] disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-white",
					revealable ? "pr-12" : "pr-4",
					className,
				)}
			/>
			{revealable && (
				<button
					type="button"
					onClick={() => setVisible((current) => !current)}
					aria-label={visible ? t("hide") : t("show")}
					aria-pressed={visible}
					className="absolute inset-y-0 right-1 my-auto flex size-9 items-center justify-center rounded-md text-[#3D5568] transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 dark:text-slate-400 dark:hover:bg-white/10"
				>
					{visible ? (
						<EyeOff className="size-[17px]" aria-hidden="true" />
					) : (
						<Eye className="size-[17px]" aria-hidden="true" />
					)}
				</button>
			)}
		</div>
	);
}
