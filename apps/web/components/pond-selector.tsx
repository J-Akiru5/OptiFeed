"use client";

import { switchPond } from "@/lib/actions/pond-selection";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

interface PondSelectorProps {
	ponds: { id: string; name: string }[];
	activePondId: string;
}

export function PondSelector({ ponds, activePondId }: PondSelectorProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, setIsPending] = useState(false);

	const activePond = ponds.find((p) => p.id === activePondId) ?? ponds[0];

	if (ponds.length <= 1) {
		return (
			<span className="text-xs font-bold text-white uppercase tracking-wider">
				{activePond?.name ?? "No Pond"}
			</span>
		);
	}

	const handleSwitch = async (pondId: string) => {
		if (pondId === activePondId) {
			setIsOpen(false);
			return;
		}
		setIsPending(true);
		try {
			await switchPond(pondId);
		} catch {
			setIsPending(false);
		}
	};

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				disabled={isPending}
				className="flex items-center gap-1.5 text-xs font-bold text-white uppercase tracking-wider hover:text-white/80 transition-colors disabled:opacity-50"
			>
				{isPending ? "Switching..." : (activePond?.name ?? "Select Pond")}
				<ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
			</button>

			{isOpen && (
				<>
					<div
						className="fixed inset-0 z-40"
						onClick={() => setIsOpen(false)}
						onKeyDown={(e) => {
							if (e.key === "Escape") setIsOpen(false);
						}}
					/>
					<div className="absolute top-full left-0 mt-2 z-50 w-56 bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
						{ponds.map((pond) => (
							<button
								key={pond.id}
								type="button"
								onClick={() => handleSwitch(pond.id)}
								className={`w-full text-left px-4 py-3 text-sm font-bold transition-colors ${
									pond.id === activePondId
										? "bg-[#0A3D62] text-white"
										: "text-[#0A3D62] hover:bg-[#F4F7F6]"
								}`}
							>
								{pond.name}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	);
}
