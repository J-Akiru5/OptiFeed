"use client";

import { useRouter } from "@/i18n/routing";
import { setPondStatus } from "@/lib/actions/admin";
import { useState } from "react";

interface PondStatusToggleProps {
	pondId: string;
	status: string;
}

export function PondStatusToggle({ pondId, status }: PondStatusToggleProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const archiving = status === "ACTIVE";

	async function handleClick() {
		setLoading(true);
		setError(null);

		const result = await setPondStatus(pondId, archiving ? "ARCHIVED" : "ACTIVE");

		setLoading(false);

		if ("error" in result) {
			setError(result.error);
			return;
		}

		router.refresh();
	}

	return (
		<div className="flex flex-col items-end gap-1">
			{error && <p className="text-[11px] font-black text-[#C42B3A]">{error}</p>}
			<button
				type="button"
				onClick={handleClick}
				disabled={loading}
				className="rounded-xl border border-[#0A3D62]/20 px-3 py-2 text-xs font-black text-[#0A3D62] hover:bg-[#F4F7F6] transition-colors disabled:opacity-50"
			>
				{loading ? "…" : archiving ? "Archive" : "Restore"}
			</button>
		</div>
	);
}
