"use client";

import { cn } from "@/lib/utils";
import { motion, useInView, useReducedMotion } from "motion/react";
import { type ElementType, useEffect, useRef, useState } from "react";

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
	const ref = useRef<HTMLDivElement>(null);
	const isInView = useInView(ref, { once: true, margin: "0px 0px -60px 0px" });
	const shouldReduceMotion = useReducedMotion();
	const [isDesktop, setIsDesktop] = useState(false);
	const [isReplaying, setIsReplaying] = useState(false);

	useEffect(() => {
		const mq = window.matchMedia("(min-width: 640px)");
		setIsDesktop(mq.matches);
		const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, []);

	// Click to replay the side-to-side swap and settle back into the right order
	const triggerReplay = () => {
		if (isReplaying || shouldReduceMotion) return;
		setIsReplaying(true);
		setTimeout(() => {
			setIsReplaying(false);
		}, 800);
	};

	const shouldBeSwapped = isReplaying || (!isInView && !shouldReduceMotion);

	return (
		<div ref={ref} className={cn("relative", className)}>
			<div className="grid gap-4 sm:grid-cols-2">
				{cards.map((card, index) => {
					if (!card) return null;
					const Icon = card.icon;
					// Row 0: cards 0 & 1, Row 1: cards 2 & 3
					const isRow2 = index >= 2;
					// Left col: index 0 or 2. Right col: index 1 or 3.
					const isLeftCol = index % 2 === 0;

					// Left cards swap in from the right; right cards swap in from the left
					const initialX = isDesktop ? (isLeftCol ? "calc(100% + 1rem)" : "calc(-100% - 1rem)") : 0;
					const initialY = isDesktop ? 0 : 20;

					return (
						<motion.div
							key={card.id}
							onClick={triggerReplay}
							initial={shouldReduceMotion ? false : { x: initialX, y: initialY, opacity: 0 }}
							animate={
								shouldBeSwapped
									? { x: initialX, y: initialY, opacity: isDesktop ? 0.85 : 0 }
									: { x: 0, y: 0, opacity: 1 }
							}
							transition={
								shouldReduceMotion
									? { duration: 0 }
									: {
											type: "spring",
											stiffness: 220,
											damping: 24,
											delay: isRow2 ? 0.14 : 0,
										}
							}
							style={{ zIndex: isLeftCol ? 10 : 1 }}
							className={cn(
								"group relative flex cursor-pointer flex-col justify-between rounded-xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xs select-none",
								"transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.08]",
								isLeftCol && "shadow-lg shadow-black/15",
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
