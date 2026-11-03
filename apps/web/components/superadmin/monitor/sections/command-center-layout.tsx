import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ActivityFeed } from "../primitives/activity-feed";
import { AttentionList } from "../primitives/attention-list";
import { KpiTile } from "../primitives/kpi-tile";
import { MonitorPanel, PanelGrid } from "../primitives/monitor-panel";
import { StatusMix } from "../primitives/status-mix";

/**
 * Level-2 composition for the Platform Command Center (issue #479, M3C.8;
 * responsive composition #628).
 *
 * Props-only on purpose: the page owns the translator and passes every visible
 * string down, so this file has no copy of its own and never imports the i18n
 * runtime. It is synchronous (no hooks, no data access), which keeps the
 * overview page renderable under `renderToStaticMarkup`.
 *
 * The order follows the plan's command-center hierarchy: the status bands say
 * what is happening and what is wrong before the KPI row answers "how much",
 * then the trend and the status mix, then any extra chart row, then the two
 * work queues, then an optional footer. Every slot except the header, bands,
 * KPIs and trend is optional, so a page that has no activity feed (or keeps its
 * own detailed attention cards) does not render an empty panel.
 *
 * ## Grid shape, per width
 *
 * The console pane is `viewport − sidebar − 2 × pane padding`, so the same
 * viewport gives a different content width depending on the shell:
 *
 * | viewport | sidebar | pane padding | content | KPI row | trend row |
 * | -------- | ------- | ------------ | ------- | ------- | --------- |
 * | 1920     | 16rem   | 2rem         | 1600 px | 4       | 3 (2 + 1) |
 * | 1440     | 16rem   | 2rem         | 1120 px | 4       | 3 (2 + 1) |
 * | 1280     | 16rem   | 2rem         |  960 px | 4       | 3 (2 + 1) |
 * | 1024     | 16rem   | 2rem         |  704 px | 2       | 2 (1 + 1) |
 * | 768      | none    | 1.5rem       |  720 px | 2       | 1         |
 * | 390      | none    | 1rem         |  358 px | 1       | 1         |
 *
 * Those are viewport breakpoints rather than container queries on purpose: the
 * pane is the app's scroll container, and `container-type: inline-size` implies
 * layout containment, which would turn it into the containing block for the
 * console's `position: fixed` dialogs and trap them inside the scroll pane.
 * `superadmin-shell-responsive.test.tsx` computes this table and asserts the
 * classes still produce it.
 */
export interface CommandCenterKpi {
	label: string;
	value: string;
	delta?: { value: string; direction: "up" | "down" | "flat"; label?: string };
	hint?: string;
	icon?: LucideIcon;
	series?: number[];
	sparklineLabel?: string;
}

export interface CommandCenterLayoutProps {
	title: string;
	description?: string;
	rangeSwitcher?: ReactNode;
	/** Status-band slot, rendered between the header and the KPI row. */
	bands: ReactNode;
	/** Four expected; the grid degrades to two and one column. */
	kpis: CommandCenterKpi[];
	/** Chart host: the page supplies the chart as children. */
	trend?: { title: string; description?: string; meta?: string; children: ReactNode };
	/** Pre-framed chart (e.g. ChartFrame) rendered without a second card. */
	trendNode?: ReactNode;
	/** Optional donut next to the trend; without it the trend spans the row. */
	mix?: {
		title: string;
		description?: string;
		items: {
			key: string;
			label: string;
			value: number;
			tone: "ok" | "warning" | "danger" | "neutral" | "accent";
		}[];
		totalLabel: string;
	};
	/** Extra chart row (the overview keeps four more charts here). */
	charts?: ReactNode;
	/** Optional single work queue; omit when the page renders its own cards. */
	attention?: {
		title: string;
		description?: string;
		items: {
			id: string;
			title: string;
			meta?: string;
			severity: "critical" | "warning" | "unknown";
			action?: ReactNode;
		}[];
		empty: string;
	};
	/** Optional activity feed; omit when the page has no event source. */
	activity?: {
		title: string;
		description?: string;
		items: {
			id: string;
			title: string;
			meta?: string;
			time: string;
			tone?: "ok" | "warning" | "danger" | "neutral";
			icon?: LucideIcon;
		}[];
		empty: string;
	};
	footer?: ReactNode;
}

export function CommandCenterLayout({
	title,
	description,
	rangeSwitcher,
	bands,
	kpis,
	trend,
	trendNode,
	mix,
	charts,
	attention,
	activity,
	footer,
}: CommandCenterLayoutProps) {
	const hasWorkQueues = Boolean(attention || activity);
	const hasTrendRow = Boolean(trend || trendNode || mix);

	// With a mix panel the trend keeps two thirds from `xl`; without one it owns
	// the row, including the laptop two-column shape.
	const trendSpan = mix ? "min-w-0 xl:col-span-2" : "min-w-0 lg:col-span-2 xl:col-span-3";

	return (
		<section aria-label={title} className="space-y-6">
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="text-2xl font-black tracking-tight text-console-content">{title}</h1>
					{description && (
						<p className="mt-1 max-w-3xl text-sm text-console-content-muted">{description}</p>
					)}
				</div>
				{rangeSwitcher && (
					<div className="flex shrink-0 flex-wrap items-center gap-2">{rangeSwitcher}</div>
				)}
			</header>

			{bands}

			<PanelGrid
				data-console-grid="kpis"
				className="grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
			>
				{kpis.map((kpi) => (
					<KpiTile
						key={kpi.label}
						label={kpi.label}
						value={kpi.value}
						delta={kpi.delta}
						hint={kpi.hint}
						icon={kpi.icon}
						series={kpi.series}
						sparklineLabel={kpi.sparklineLabel}
					/>
				))}
			</PanelGrid>

			{hasTrendRow && (
				<PanelGrid
					data-console-grid="trend"
					className="grid-cols-1 gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"
				>
					{trendNode ? (
						<div className={trendSpan}>{trendNode}</div>
					) : trend ? (
						<MonitorPanel
							title={trend.title}
							description={trend.description}
							meta={trend.meta}
							className={trendSpan}
						>
							{trend.children}
						</MonitorPanel>
					) : null}
					{mix && (
						<MonitorPanel title={mix.title} description={mix.description}>
							<StatusMix items={mix.items} totalLabel={mix.totalLabel} />
						</MonitorPanel>
					)}
				</PanelGrid>
			)}

			{charts}

			{hasWorkQueues && (
				<PanelGrid
					data-console-grid="queues"
					className="grid-cols-1 gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2"
				>
					{attention && (
						<MonitorPanel title={attention.title} description={attention.description}>
							<AttentionList items={attention.items} empty={attention.empty} />
						</MonitorPanel>
					)}
					{activity && (
						<MonitorPanel title={activity.title} description={activity.description}>
							<ActivityFeed items={activity.items} empty={activity.empty} />
						</MonitorPanel>
					)}
				</PanelGrid>
			)}

			{footer}
		</section>
	);
}
