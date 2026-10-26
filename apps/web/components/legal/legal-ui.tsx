import type { ReactNode } from "react";

export function LegalSection({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: ReactNode;
}) {
	return (
		<section
			id={id}
			className="scroll-mt-28 border-t border-[#DFE7E4] pt-8 first:border-t-0 first:pt-0 dark:border-white/10"
		>
			<h2 className="text-xl font-semibold tracking-[-0.02em] text-[#0A2E47] sm:text-2xl dark:text-white">
				{title}
			</h2>
			<div className="mt-4 space-y-4 text-[14px] leading-7 text-slate-600 dark:text-slate-300">
				{children}
			</div>
		</section>
	);
}

export function LegalSubheading({ children }: { children: ReactNode }) {
	return (
		<h3 className="pt-2 text-[15px] font-semibold text-[#0A2E47] dark:text-white">{children}</h3>
	);
}

export function LegalList({ children }: { children: ReactNode }) {
	return <ul className="list-disc space-y-2 pl-5 marker:text-[#E85A2A]">{children}</ul>;
}

export function LegalCallout({
	tone = "info",
	title,
	children,
}: {
	tone?: "info" | "warning" | "important";
	title?: string;
	children: ReactNode;
}) {
	const styles = {
		info: "border-[#0A3D62]/15 bg-[#0A3D62]/[0.035] text-[#0A2E47] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200",
		warning:
			"border-[#B54708]/25 bg-[#FFFAEB] text-[#7A2E0E] dark:border-[#F79009]/25 dark:bg-[#F79009]/10 dark:text-[#FEC84B]",
		important:
			"border-[#B42318]/20 bg-[#FEF3F2] text-[#7A271A] dark:border-[#F97066]/25 dark:bg-[#F97066]/10 dark:text-[#FDA29B]",
	} as const;

	return (
		<div className={`rounded-xl border p-4 text-[13px] leading-6 ${styles[tone]}`}>
			{title ? <p className="mb-1 font-semibold">{title}</p> : null}
			<div className="space-y-2">{children}</div>
		</div>
	);
}

type LegalColumn = {
	key: string;
	label: string;
	className?: string;
};

export function LegalTable({
	columns,
	rows,
	caption,
}: {
	columns: readonly LegalColumn[];
	rows: readonly Record<string, ReactNode>[];
	caption?: string;
}) {
	return (
		<div className="my-2 overflow-x-auto rounded-xl border border-[#DFE7E4] dark:border-white/10">
			<table className="w-full min-w-[42rem] border-collapse text-left text-[12.5px] leading-6">
				{caption ? <caption className="sr-only">{caption}</caption> : null}
				<thead className="bg-[#F4F7F6] text-[10px] uppercase tracking-[0.12em] text-[#5D7183] dark:bg-white/[0.04] dark:text-slate-400">
					<tr>
						{columns.map((column) => (
							<th
								key={column.key}
								scope="col"
								className={`px-3.5 py-2.5 font-semibold ${column.className ?? ""}`}
							>
								{column.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => (
						<tr
							// Static legal tables have no stable row id; order is the identity.
							// biome-ignore lint/suspicious/noArrayIndexKey: static rows
							key={index}
							className="border-t border-[#EDF2EF] align-top dark:border-white/[0.06]"
						>
							{columns.map((column) => (
								<td
									key={column.key}
									className={`px-3.5 py-3 text-slate-600 dark:text-slate-300 ${column.className ?? ""}`}
								>
									{row[column.key]}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function LegalLink({
	href,
	children,
	external = false,
}: {
	href: string;
	children: ReactNode;
	external?: boolean;
}) {
	return (
		<a
			href={href}
			{...(external ? { target: "_blank", rel: "noreferrer" } : {})}
			className="font-medium text-[#0A3D62] underline decoration-[#0A3D62]/25 underline-offset-2 transition-colors hover:text-[#E85A2A] dark:text-[#8EC5EF] dark:decoration-white/20 dark:hover:text-[#FF8A5C]"
		>
			{children}
		</a>
	);
}
