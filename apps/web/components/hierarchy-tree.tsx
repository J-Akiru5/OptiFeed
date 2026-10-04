"use client";

import { cn } from "@/lib/utils";
import { ChevronRight, Cpu, Droplets, Sprout, User } from "lucide-react";
import { useState } from "react";

export type HierarchyBadge = {
	text: string;
	tone: "navy" | "muted" | "green";
};

export type HierarchyNode = {
	id: string;
	kind: "user" | "farm" | "pond" | "device";
	title: string;
	subtitle?: string;
	badge?: HierarchyBadge;
	children?: HierarchyNode[];
};

const kindIcons = {
	user: User,
	farm: Sprout,
	pond: Droplets,
	device: Cpu,
} as const;

const badgeTones: Record<HierarchyBadge["tone"], string> = {
	navy: "bg-[#0A3D62]/10 text-[#0A3D62]",
	muted: "bg-gray-100 text-gray-500",
	green: "bg-[#1E7B34]/10 text-[#1E7B34]",
};

function TreeNode({ node, depth }: { node: HierarchyNode; depth: number }) {
	const [expanded, setExpanded] = useState(true);
	const children = node.children ?? [];
	const hasChildren = children.length > 0;
	const Icon = kindIcons[node.kind];

	return (
		<div className={depth > 0 ? "border-l-2 border-[#0A3D62]/10 pl-3 ml-2" : undefined}>
			<div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-[#F4F7F6] transition-colors">
				{hasChildren ? (
					<button
						type="button"
						aria-expanded={expanded}
						aria-label={node.title}
						onClick={() => setExpanded((v) => !v)}
						className="shrink-0 rounded p-0.5 text-[#3D5568] hover:text-[#0A3D62] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]"
					>
						<ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} />
					</button>
				) : (
					<span className="w-4 shrink-0" aria-hidden />
				)}

				<span
					className={cn(
						"flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
						node.kind === "user" && "bg-[#E85A2A]/10 text-[#E85A2A]",
						node.kind === "farm" && "bg-[#1E7B34]/10 text-[#1E7B34]",
						node.kind === "pond" && "bg-[#0A3D62]/10 text-[#0A3D62]",
						node.kind === "device" && "bg-gray-100 text-gray-500",
					)}
				>
					<Icon className="h-4 w-4" aria-hidden />
				</span>

				<div className="min-w-0 flex-1">
					<p
						className={cn(
							"truncate font-bold text-gray-800",
							node.kind === "user" ? "text-base" : "text-sm",
						)}
					>
						{node.title}
					</p>
					{node.subtitle && <p className="truncate text-xs text-gray-500">{node.subtitle}</p>}
				</div>

				{node.badge && (
					<span
						className={cn(
							"shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase",
							badgeTones[node.badge.tone],
						)}
					>
						{node.badge.text}
					</span>
				)}
			</div>

			{hasChildren && expanded && (
				<div className="space-y-1">
					{children.map((child) => (
						<TreeNode key={child.id} node={child} depth={depth + 1} />
					))}
				</div>
			)}
		</div>
	);
}

export function HierarchyTree({ nodes }: { nodes: HierarchyNode[] }) {
	return (
		<div className="space-y-1">
			{nodes.map((node) => (
				<TreeNode key={node.id} node={node} depth={0} />
			))}
		</div>
	);
}
