"use client";

import { motion } from "motion/react";
import type { ElementType, ReactNode } from "react";

type RevealProps = {
	children: ReactNode;
	className?: string;
	delay?: number;
	as?: "div" | "li" | "section" | "ul" | "dl" | "ol" | "p" | "h2";
};

const VIEWPORT = { once: true, margin: "0px 0px -64px 0px" } as const;

/**
 * Reveals content with a short upward slide.
 *
 * Only transforms are animated, never opacity, so the page stays readable in
 * print, in full-page screenshots and when scripts are blocked. MotionConfig
 * (`reducedMotion="user"`) suppresses the movement for reduced-motion users.
 */
export function Reveal({ children, className, delay = 0, as = "div" }: RevealProps) {
	const Tag = motion[as] as ElementType;
	return (
		<Tag
			className={className}
			initial={{ y: 18 }}
			whileInView={{ y: 0 }}
			viewport={VIEWPORT}
			transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
		>
			{children}
		</Tag>
	);
}

const listVariants = {
	hidden: {},
	show: { transition: { staggerChildren: 0.06 } },
};

type From = "up" | "left" | "right";

const OFFSETS: Record<From, { x: number; y: number }> = {
	up: { x: 0, y: 18 },
	left: { x: -32, y: 0 },
	right: { x: 32, y: 0 },
};

const itemVariants = {
	hidden: (from: From) => OFFSETS[from],
	show: {
		x: 0,
		y: 0,
		transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
	},
};

export function RevealList({
	children,
	className,
	as = "div",
}: {
	children: ReactNode;
	className?: string;
	as?: "div" | "ul" | "ol" | "dl" | "tbody";
}) {
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
