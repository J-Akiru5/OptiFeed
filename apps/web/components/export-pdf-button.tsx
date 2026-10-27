"use client";

import { ApiClientError, apiPost } from "@/lib/api-client";
import { fetchJobArtifact, waitForJob } from "@/lib/jobs/client";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function ExportPdfButton({ className }: { className?: string }) {
	const [loading, setLoading] = useState(false);

	const handleExport = async () => {
		setLoading(true);
		try {
			const job = await apiPost<{ id: string }>(
				"/api/v1/export-jobs",
				{ kind: "pdf" },
				{ timeoutMs: 5_000 },
			);
			const { downloadUrl } = await waitForJob(job.id);
			if (!downloadUrl) throw new Error("The report is not ready.");

			const response = await fetchJobArtifact(downloadUrl);
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `pakaonai-report-${new Date().toISOString().split("T")[0]}.pdf`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
			toast.success("Report downloaded");
		} catch (error) {
			toast.error(error instanceof ApiClientError ? error.message : "Failed to export report");
		} finally {
			setLoading(false);
		}
	};

	return (
		<button
			type="button"
			onClick={handleExport}
			disabled={loading}
			data-help="dashboard-export"
			className={`flex items-center gap-2 rounded-xl bg-[#0A3D62] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#12588c] disabled:opacity-50 ${className ?? ""}`}
		>
			<Download className="h-4 w-4" />
			{loading ? "Generating..." : "Export PDF"}
		</button>
	);
}
