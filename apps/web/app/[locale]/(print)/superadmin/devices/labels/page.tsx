import { DeviceLabelSheet } from "@/components/admin/device-label-sheet";
import { getPlatformDevicesForLabels } from "@/lib/actions/platform/devices";
import { notFound } from "next/navigation";

function idsFrom(param: string | string[] | undefined): string[] {
	if (param === undefined) return [];
	return Array.isArray(param) ? param : [param];
}

export default async function PlatformDeviceLabelsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const params = await searchParams;
	const devices = await getPlatformDevicesForLabels(idsFrom(params.id));
	if (devices.length === 0) notFound();

	return (
		<DeviceLabelSheet devices={devices} backHref="/superadmin/devices" searchParams={params} />
	);
}
