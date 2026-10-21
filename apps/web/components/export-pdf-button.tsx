"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function ExportPdfButton({ className }: { className?: string }) {
	const [loading, setLoading] = useState(false);

	const handleExport = async () => {
		setLoading(true);
		try {
			const res = await fetch("/api/export-pdf");
			if (!res.ok) throw new Error("Export failed");

			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `optifeed-report-${new Date().toISOString().split("T")[0]}.pdf`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			toast.success("Report downloaded");
		} catch {
			toast.error("Failed to export report");
		} finally {
			setLoading(false);
		}
	};

	return (
		<button
			type="button"
			onClick={handleExport}
			disabled={loading}
			className={`flex items-center gap-2 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#12588c] disabled:opacity-50 ${className ?? ""}`}
		>
			<Download className="h-4 w-4" />
			{loading ? "Generating..." : "Export PDF"}
		</button>
	);
}
