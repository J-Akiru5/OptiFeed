import type { ScopeCrumb, ScopeLevel } from "@/lib/superadmin-scope";
import { Cpu, FolderTree, Globe, type LucideIcon } from "lucide-react";

/**
 * An icon for each scope that names a thing: the whole platform, an
 * organization, a resource. A section crumb is plain text. Every crumb is also
 * written out, so the level never rests on colour or icon alone. The palette
 * stays brand navy and orange: red, amber and green belong to status (decision
 * T25), and red already means a live view-as session.
 *
 * The icon set and the text arrow are deliberately small: this banner ships in
 * the layout, so it counts against first-load JS on every console route.
 */
const ICONS: Partial<Record<ScopeLevel, LucideIcon>> = {
	global: Globe,
	organization: FolderTree,
	resource: Cpu,
};

/**
 * Where the operator is, as a path: `GLOBAL SUPERADMIN → ORGANIZATION ALPHA`.
 *
 * It pins to the top of the console's scrolling pane and bleeds to the pane's
 * edges. Both the bleed and the payback are `.ofd-console-scope`
 * (`app/globals.css`), which reads `--console-pane-pad` — the same token the
 * pane pads itself with — so the banner cannot drift away from the pane
 * padding at any of the three breakpoint steps (#628).
 */
export function ScopeBanner({ crumbs, label }: { crumbs: ScopeCrumb[]; label: string }) {
	return (
		<nav
			aria-label={label}
			className="ofd-console-scope sticky top-0 z-20 border-b border-console-border bg-console-surface"
		>
			<ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-black uppercase tracking-wider text-console-content">
				{crumbs.map((crumb, index) => {
					const Icon = ICONS[crumb.level];
					const isLast = index === crumbs.length - 1;

					return (
						<li key={`${crumb.level}:${crumb.label}`} className="flex min-w-0 items-center gap-2">
							{index > 0 && (
								<span className="shrink-0 text-console-content-muted" aria-hidden="true">
									→
								</span>
							)}
							{Icon && (
								<Icon className="h-3.5 w-3.5 shrink-0 text-console-focus" aria-hidden="true" />
							)}
							<span
								data-scope-level={crumb.level}
								aria-current={isLast ? "location" : undefined}
								className="min-w-0 truncate"
							>
								{crumb.label}
							</span>
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
