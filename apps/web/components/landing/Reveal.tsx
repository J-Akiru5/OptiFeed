"use client";

import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ElementType, ReactNode } from "react";

type RevealProps = {
	children: ReactNode;
	className?: string;
	delay?: number;
	as?: "div" | "li" | "section" | "ul" | "dl" | "ol" | "p" | "h2";
};

const VIEWPORT = { once: true, margin: "0px 0px -80px 0px" } as const;

export function Reveal({ children, className, delay = 0, as = "div" }: RevealProps) {
	const Tag = motion[as] as ElementType;
	return (
		<Tag
			className={className}
			initial={{ opacity: 0, y: 24 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={VIEWPORT}
			transition={{ duration: 0.5, ease: "easeOut", delay }}
		>
			{children}
		</Tag>
	);
}

const listVariants = {
	hidden: {},
	show: { transition: { staggerChildren: 0.07 } },
};

type From = "up" | "left" | "right";

const OFFSETS: Record<From, { x: number; y: number }> = {
	up: { x: 0, y: 20 },
	left: { x: -90, y: 0 },
	right: { x: 90, y: 0 },
};

const itemVariants = {
	hidden: (from: From) => ({ opacity: 0, ...OFFSETS[from] }),
	show: {
		opacity: 1,
		x: 0,
		y: 0,
		transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
	},
};

export function RevealList({
	children,
	className,
	as = "div",
}: { children: ReactNode; className?: string; as?: "div" | "ul" | "ol" | "dl" | "tbody" }) {
	const Tag = motion[as] as ElementType;
	return (
		<Tag
			className={className}
			variants={listVariants}
			initial="hidden"
			whileInView="show"
			viewport={VIEWPORT}
		>
			{children}
		</Tag>
	);
}

export function RevealItem({
	children,
	className,
	as = "div",
	from = "up",
}: {
	children: ReactNode;
	className?: string;
	as?: "div" | "li" | "tr" | "details";
	from?: From;
}) {
	const Tag = motion[as] as ElementType;
	return (
		<Tag className={className} variants={itemVariants} custom={from}>
			{children}
		</Tag>
	);
}

/** Counts every integer inside `text` up from 0 once it scrolls into view. */
export function CountUp({ text, className }: { text: string; className?: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	const inView = useInView(ref, { once: true, margin: "0px 0px -80px 0px" });
	const reduced = useReducedMotion();
	const [progress, setProgress] = useState(reduced ? 1 : 0);

	useEffect(() => {
		if (!inView || reduced) {
			if (reduced) setProgress(1);
			return;
		}
		const controls = animate(0, 1, {
			duration: 1.2,
			ease: "easeOut",
			onUpdate: setProgress,
		});
		return () => controls.stop();
	}, [inView, reduced]);

	return (
		<span ref={ref} className={className} aria-label={text}>
			<span aria-hidden="true">
				{text
					.split(/(\d+)/)
					.map((part, i) => (/^\d+$/.test(part) ? Math.round(Number(part) * progress) : part))}
			</span>
		</span>
	);
}
