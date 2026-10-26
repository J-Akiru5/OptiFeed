"use client";

import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "motion/react";
import { type ElementType, useEffect, useState } from "react";

export type OfflineCardData = {
	id: number;
	icon: ElementType;
	title: string;
	body: string;
};

type OfflineCardsProps = {
	cards: OfflineCardData[];
	className?: string;
};

export function OfflineCards({ cards, className }: OfflineCardsProps) {
	const shouldReduceMotion = useReducedMotion();
	const [swappedR1, setSwappedR1] = useState(false);
	const [swappedR2, setSwappedR2] = useState(false);
	const [isPaused, setIsPaused] = useState(false);

	// Separate cards into row 1 (cards 0 & 1) and row 2 (cards 2 & 3)
	const c1 = cards[0];
	const c2 = cards[1];
	const c3 = cards[2];
	const c4 = cards[3];

	// Periodic side-to-side swap with a slight cascade between row 1 and row 2
	useEffect(() => {
		if (shouldReduceMotion || isPaused) return;

		const interval = setInterval(() => {
			setSwappedR1((prev) => !prev);
			// Row 2 swaps with a slight 180ms stagger after Row 1
			const timeout = setTimeout(() => {
				setSwappedR2((prev) => !prev);
			}, 180);

			return () => clearTimeout(timeout);
		}, 4200);

		return () => clearInterval(interval);
	}, [shouldReduceMotion, isPaused]);

	const toggleSwap = () => {
		setSwappedR1((prev) => !prev);
		setTimeout(() => setSwappedR2((prev) => !prev), 140);
	};

	const row1 = swappedR1 ? [c2, c1] : [c1, c2];
	const row2 = swappedR2 ? [c4, c3] : [c3, c4];
	const currentCards = [...row1, ...row2];

	return (
		<div
			className={cn("relative", className)}
			onMouseEnter={() => setIsPaused(true)}
			onMouseLeave={() => setIsPaused(false)}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				{currentCards.map((card, index) => {
					if (!card) return null;
					const Icon = card.icon;
					// Determine if this card is currently in column 0 (left) or column 1 (right)
					const isRightCol = index % 2 === 1;
					// Give one side higher elevation during swap for deck-shuffle depth
					const isElevated = index < 2 ? swappedR1 === isRightCol : swappedR2 === isRightCol;

					return (
						<motion.div
							layout
							key={card.id}
							onClick={toggleSwap}
							transition={
								shouldReduceMotion
									? { duration: 0 }
									: {
											layout: {
												type: "spring",
												stiffness: 240,
												damping: 26,
											},
										}
							}
							style={{ zIndex: isElevated ? 10 : 1 }}
							className={cn(
								"group relative flex cursor-pointer flex-col justify-between rounded-xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xs select-none",
								"transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.08]",
								isElevated && "shadow-lg shadow-black/20",
							)}
						>
							<div>
								<div className="flex items-center justify-between">
									<span className="flex size-9 items-center justify-center rounded-lg bg-white/[0.06] text-white/70 ring-1 ring-white/10 ring-inset transition-colors group-hover:bg-[#FF8A5C]/15 group-hover:text-[#FF8A5C] group-hover:ring-[#FF8A5C]/30">
										<Icon className="size-[17px]" strokeWidth={1.75} aria-hidden="true" />
									</span>
									<span className="font-mono text-[10px] font-medium text-white/25 transition-colors group-hover:text-white/45">
										0{card.id}
									</span>
								</div>

								<h3 className="mt-4 text-[14px] font-semibold text-white transition-colors group-hover:text-white">
									{card.title}
								</h3>
								<p className="mt-1.5 text-[12.5px] leading-5 text-white/55">{card.body}</p>
							</div>

							<div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3 text-[10.5px] text-white/30">
								<span className="flex items-center gap-1.5 transition-colors group-hover:text-white/60">
									<span className="size-1 rounded-full bg-[#7CE3A8]" />
									Offline ready
								</span>
								<span className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">
									Click to swap
								</span>
							</div>
						</motion.div>
					);
				})}
			</div>
		</div>
	);
}
