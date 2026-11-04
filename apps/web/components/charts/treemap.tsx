"use client";

import { formatChartNumber } from "@/components/charts/chart-data";
import { ChartFrame, type ChartLabels, type ChartProps } from "@/components/charts/chart-frame";
import { seriesColor, tooltipStyle, useChartTheme } from "@/components/charts/chart-theme";
import { type ReactElement, useId, useMemo } from "react";
import {
	Treemap as RechartsTreemap,
	ResponsiveContainer,
	Tooltip,
	type TreemapNode,
} from "recharts";

export interface TreemapChild {
	name: string;
	value: number;
	/** Tile fill; defaults to the parent organization's colour. */
	color?: string;
	/** Recharts carries arbitrary fields through to the content renderer. */
	[key: string]: unknown;
}

export interface TreemapDatum {
	name: string;
	value: number;
	/** One nesting level: an organization's ponds, a pond's devices. */
	children?: TreemapChild[];
	/**
	 * Tile fill. Defaults to the palette slot for this top-level datum's
	 * position (#835), so organizations are distinguishable without relying on
	 * Recharts' internal node indexes; children inherit it.
	 */
	color?: string;
	[key: string]: unknown;
}

export interface TreemapProps extends ChartProps {
	nodes: TreemapDatum[];
	/** Suffix shown on a tile and in the tooltip, e.g. `devices`. */
	unit?: string;
	height?: number;
}

interface TreemapLeafRow {
	path: string;
	value: number;
}

/** Keep the drawing and the hidden table on the same non-negative numbers. */
function safeValue(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

/** A usable explicit colour, or undefined so the palette slot applies. */
function explicitColor(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Normalise values and stamp every tile's fill from the datum (#835).
 *
 * Colour used to be derived from Recharts' `node.index`/`tooltipIndex` at paint
 * time. At depth 1, and on any tooltip-path mismatch, that resolves to the
 * sibling index — the first pond of every organization is 0 — so a multi-org
 * dataset could paint entirely in palette slot 0 (orange). Colouring the datum
 * up front is independent of those internals: a top-level node takes the next
 * palette slot, its children inherit it, and an explicit `color` wins.
 */
function normalizeNodes(nodes: ReadonlyArray<TreemapDatum>, dark: boolean): TreemapDatum[] {
	return nodes.map((node, index) => {
		const color = explicitColor(node.color) ?? seriesColor(index, dark);
		return {
			...node,
			color,
			value: safeValue(node.value),
			children: node.children?.map((child) => ({
				...child,
				color: explicitColor(child.color) ?? color,
				value: safeValue(child.value),
			})),
		};
	});
}

/**
 * One row per leaf, with the full path. Recharts only paints positive values,
 * so a parent with children contributes its children, never its own total.
 */
function buildLeafRows(nodes: ReadonlyArray<TreemapDatum>): TreemapLeafRow[] {
	const rows: TreemapLeafRow[] = [];
	for (const node of nodes) {
		if (node.children && node.children.length > 0) {
			for (const child of node.children) {
				rows.push({
					path: `${node.name} / ${child.name}`,
					value: safeValue(child.value),
				});
			}
			continue;
		}
		rows.push({ path: node.name, value: safeValue(node.value) });
	}
	return rows;
}

/** Stable SVG id fragment; `tooltipIndex` is Recharts' own path key. */
function idPart(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function truncate(label: string, maxCharacters: number): string {
	if (maxCharacters <= 1) return "";
	if (label.length <= maxCharacters) return label;
	return `${label.slice(0, maxCharacters - 1)}…`;
}

/** Hidden table: a screen reader reads the hierarchy without the rectangles. */
function TreemapTable({
	rows,
	labels,
	caption,
}: {
	rows: ReadonlyArray<TreemapLeafRow>;
	labels: ChartLabels;
	caption: string;
}) {
	return (
		<table>
			<caption>{caption}</caption>
			<thead>
				<tr>
					<th scope="col">{labels.name}</th>
					<th scope="col">{labels.value}</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row, index) => (
					<tr key={`${row.path}-${index}`}>
						<th scope="row">{row.path}</th>
						<td>{row.value}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/**
 * Nested part-to-whole view (organization → ponds → devices, #629).
 *
 * A tile's size is its value and its colour is its top-level organization, so
 * the group is readable even when individual tiles are too small for text. The
 * hidden table carries the full leaf path and value for keyboard and
 * screen-reader users.
 */
export function Treemap({
	title,
	summary,
	labels,
	nodes,
	unit,
	height = 260,
	className,
	plotClassName,
	isLoading = false,
	loadingLabel,
	error = null,
}: TreemapProps) {
	const theme = useChartTheme();
	const rawId = useId();
	const chartId = idPart(rawId) || "treemap";
	const leaves = useMemo(() => buildLeafRows(nodes), [nodes]);
	const data = useMemo(() => normalizeNodes(nodes, theme.dark), [nodes, theme.dark]);
	const total = leaves.reduce((sum, leaf) => sum + leaf.value, 0);
	const isEmpty = leaves.length === 0 || total <= 0;

	// The tile text is the contrasting surface colour: white on the dark light-theme
	// tiles, the dark tooltip surface on the lifted dark-theme tiles.
	const leafText = theme.tooltipBg;

	const renderTile = (node: TreemapNode): ReactElement => {
		// The root rectangle covers the whole plot; the top-level organizations
		// and their leaves paint the actual data.
		if (node.depth === 0) return <g />;

		const x = Number(node.x) || 0;
		const y = Number(node.y) || 0;
		const width = Number(node.width) || 0;
		const height = Number(node.height) || 0;
		if (width <= 0 || height <= 0) return <g />;

		const leaf = !node.children || node.children.length === 0;
		// The datum carries its colour (#835); fall back to the first palette slot
		// only for a node that somehow reaches the renderer without one.
		const fill = explicitColor(node.color) ?? seriesColor(0, theme.dark);
		const clipId = `${chartId}-tile-${idPart(node.tooltipIndex ?? String(node.index))}`;
		const name = String(node.name ?? "");
		const value = formatChartNumber(Number(node.value) || 0, unit);
		const padding = 7;
		const showDetail = width >= 92 && height >= 46;
		const showLabel = width >= 28 && height >= 16;
		const nameCharacters = Math.max(1, Math.floor((width - padding * 2) / 5.6));
		const valueCharacters = Math.max(1, Math.floor((width - padding * 2) / 5.2));

		return (
			<g>
				<rect
					x={x}
					y={y}
					width={width}
					height={height}
					rx={4}
					fill={fill}
					fillOpacity={leaf ? 1 : 0.35}
					stroke={theme.tooltipBg}
					strokeWidth={1.5}
				/>
				{showLabel ? (
					<>
						<clipPath id={clipId}>
							<rect x={x} y={y} width={width} height={height} rx={4} />
						</clipPath>
						<g clipPath={`url(#${clipId})`}>
							{showDetail ? (
								<>
									<text
										x={x + padding}
										y={y + 18}
										fill={leaf ? leafText : theme.tooltipText}
										fontSize={11}
										fontWeight={700}
									>
										{truncate(name, nameCharacters)}
									</text>
									<text
										x={x + padding}
										y={y + 33}
										fill={leaf ? leafText : theme.tooltipText}
										fillOpacity={0.9}
										fontSize={10}
										fontWeight={600}
									>
										{truncate(value, valueCharacters)}
									</text>
								</>
							) : (
								<text
									x={x + padding}
									y={y + height / 2 + 4}
									fill={leaf ? leafText : theme.tooltipText}
									fontSize={10}
									fontWeight={600}
								>
									{truncate(name, nameCharacters)}
								</text>
							)}
						</g>
					</>
				) : null}
			</g>
		);
	};

	return (
		<ChartFrame
			title={title}
			summary={summary}
			emptyLabel={labels.empty}
			isEmpty={isEmpty}
			className={className}
			plotClassName={plotClassName}
			isLoading={isLoading}
			loadingLabel={loadingLabel}
			error={error}
			table={<TreemapTable rows={leaves} labels={labels} caption={summary} />}
		>
			<ResponsiveContainer width="100%" height={height}>
				<RechartsTreemap
					data={data}
					dataKey="value"
					nameKey="name"
					aspectRatio={4 / 3}
					nodeGap={2}
					nodeInset={1}
					stroke={theme.tooltipBg}
					isAnimationActive={false}
					content={renderTile}
				>
					<Tooltip
						contentStyle={tooltipStyle(theme)}
						formatter={(value: unknown, name: unknown) => [
							formatChartNumber(Number(value), unit),
							String(name),
						]}
					/>
				</RechartsTreemap>
			</ResponsiveContainer>
		</ChartFrame>
	);
}
