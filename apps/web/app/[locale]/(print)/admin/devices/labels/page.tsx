import { DeviceLabelSheet } from "@/components/admin/device-label-sheet";
import { getDevicesForLabels } from "@/lib/actions/admin";
import { notFound } from "next/navigation";

function idsFrom(param: string | string[] | undefined): string[] {
	if (param === undefined) return [];
	return Array.isArray(param) ? param : [param];
}

export default async function DeviceLabelsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const params = await searchParams;
	const devices = await getDevicesForLabels(idsFrom(params.id));
	// Out-of-scope and unknown devices both come back empty: same answer.
	if (devices.length === 0) notFound();

	return <DeviceLabelSheet devices={devices} backHref="/admin/devices" searchParams={params} />;
}
