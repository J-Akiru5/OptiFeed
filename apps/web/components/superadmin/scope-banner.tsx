import type { ScopeCrumb, ScopeLevel } from "@/lib/superadmin-scope";
import { ChevronRight, Cpu, FolderTree, Globe, LayoutGrid, type LucideIcon } from "lucide-react";

/**
 * One icon per scope, so the level reads without colour. The palette stays
 * brand navy and orange: red, amber and green belong to status (decision T25),
 * and red already means a live view-as session.
 */
const ICONS: Record<ScopeLevel, LucideIcon> = {
	global: Globe,
	section: LayoutGrid,
	organization: FolderTree,
	resource: Cpu,
};

/**
 * Where the operator is, as a path: `GLOBAL SUPERADMIN → ORGANIZATION ALPHA`.
 *
 * It pins to the top of the console's scrolling pane and bleeds to the pane's
 * edges (negative margins cancel the pane's own padding in the layout), so the
 * scope stays in view on a long member list.
 */
export function ScopeBanner({ crumbs, label }: { crumbs: ScopeCrumb[]; label: string }) {
	return (
		<nav
			aria-label={label}
			className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b border-[#0A3D62]/15 bg-white px-4 py-2 md:-mx-8 md:-mt-8 md:mb-6 md:px-8"
		>
			<ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-black uppercase tracking-wider text-[#0A3D62]">
				{crumbs.map((crumb, index) => {
					const Icon = ICONS[crumb.level];
					const isLast = index === crumbs.length - 1;

					return (
						<li key={`${crumb.level}:${crumb.label}`} className="flex min-w-0 items-center gap-2">
							{index > 0 && (
								<ChevronRight className="h-3 w-3 shrink-0 text-[#3D5568]" aria-hidden="true" />
							)}
							<Icon className="h-3.5 w-3.5 shrink-0 text-[#E85A2A]" aria-hidden="true" />
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
