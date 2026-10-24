import { apiGet, rawFetch } from "@/lib/api-client";

const JOB_POLL_MS = 700;
const JOB_TIMEOUT_MS = 90_000;

export interface JobEnvelope {
	id: string;
	status: "queued" | "running" | "succeeded" | "failed";
	result: unknown;
	error: string | null;
	download_url: string | null;
}

/** Poll a job until it finishes, then return its result and download URL. */
export async function waitForJob<T>(
	jobId: string,
): Promise<{ result: T; downloadUrl: string | null }> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < JOB_TIMEOUT_MS) {
		const job = await apiGet<JobEnvelope>(`/api/v1/jobs/${jobId}`, {
			timeoutMs: 5_000,
			retries: 1,
		});
		if (job.status === "succeeded") {
			return { result: job.result as T, downloadUrl: job.download_url };
		}
		if (job.status === "failed") {
			throw new Error(job.error ?? "The job failed.");
		}
		await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
	}
	throw new Error("Timed out waiting for the job.");
}

/** Download a finished artifact with the browser's session cookie. */
export async function fetchJobArtifact(downloadUrl: string): Promise<Response> {
	const response = await rawFetch(downloadUrl);
	if (!response.ok) throw new Error("The export download failed.");
	return response;
}
