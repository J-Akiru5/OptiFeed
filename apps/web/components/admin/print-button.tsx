"use client";

export function PrintButton({ label }: { label: string }) {
	return (
		<button
			type="button"
			onClick={() => window.print()}
			className="rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-[#0A48A0]"
		>
			{label}
		</button>
	);
}
