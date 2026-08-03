"use client";

import { Fragment, type ReactNode } from "react";

// Minimal Markdown renderer (no dependencies): **bold**, *italic*, "- " bullet
// lists, "1. " numbered lists, and line breaks. Keys use local counters rather
// than array indexes so content order stays stable within a single render.
function renderInline(text: string, keyBase: string): ReactNode[] {
	const out: ReactNode[] = [];
	let n = 0;
	for (const part of text.split(/(\*\*.*?\*\*|\*.*?\*)/g)) {
		const key = `${keyBase}-${n}`;
		n++;
		if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
			out.push(<strong key={key}>{part.slice(2, -2)}</strong>);
		} else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
			out.push(<em key={key}>{part.slice(1, -1)}</em>);
		} else {
			out.push(<Fragment key={key}>{part}</Fragment>);
		}
	}
	return out;
}

export function Markdown({ text }: { text: string }) {
	const blocks: ReactNode[] = [];
	let list: { ordered: boolean; items: ReactNode[] } | null = null;
	let lineNo = 0;

	const flushList = (key: string) => {
		if (!list) return;
		const items = list.items;
		blocks.push(
			list.ordered ? (
				<ol key={key} className="list-decimal space-y-0.5 pl-5">
					{items}
				</ol>
			) : (
				<ul key={key} className="list-disc space-y-0.5 pl-5">
					{items}
				</ul>
			),
		);
		list = null;
	};

	for (const line of text.split("\n")) {
		const bullet = line.match(/^\s*[-*]\s+(.*)$/);
		const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
		if (bullet || numbered) {
			const ordered = !!numbered;
			if (!list || list.ordered !== ordered) {
				flushList(`list-${lineNo}`);
				list = { ordered, items: [] };
			}
			list.items.push(
				<span key={`item-${lineNo}`}>
					{renderInline((bullet ?? numbered)?.[1] ?? "", `li-${lineNo}`)}
				</span>,
			);
			lineNo++;
			continue;
		}
		flushList(`p-${lineNo}`);
		if (line.trim().length > 0) {
			blocks.push(<p key={`p-${lineNo}`}>{renderInline(line, `p-${lineNo}`)}</p>);
		}
		lineNo++;
	}
	flushList("last");

	return <div className="space-y-1.5">{blocks}</div>;
}
