"use client";

// TODO(karl): Wire this stub to next-intl's Link/useRouter so users can switch between English and Hiligaynon.
export function LocaleSwitcher() {
	return (
		<div className="flex items-center gap-2">
			<button type="button" className="min-h-[var(--ofd-touch-min)] px-3">
				EN
			</button>
			<button type="button" className="min-h-[var(--ofd-touch-min)] px-3">
				HIL
			</button>
		</div>
	);
}
