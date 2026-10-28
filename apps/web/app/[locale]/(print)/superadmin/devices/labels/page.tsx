import { DeviceLabelEmptyState } from "@/components/admin/device-label-empty-state";
import { DeviceLabelSheet } from "@/components/admin/device-label-sheet";
import { getPlatformDevicesForLabels } from "@/lib/actions/platform/devices";
import { parseDeviceLabelIds } from "@/lib/device-label-selection";
import { notFound } from "next/navigation";

export default async function PlatformDeviceLabelsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const params = await searchParams;
	const ids = parseDeviceLabelIds(params.id);
	// No `id` means "every device on the platform": the Superadmin → Devices
	// print-selected form submits no ids when no box is ticked.
	const devices = await getPlatformDevicesForLabels(ids);
	// An explicit selection that matches nothing stays a 404.
	if (ids.length > 0 && devices.length === 0) notFound();
	if (devices.length === 0) return <DeviceLabelEmptyState backHref="/superadmin/devices" />;

	return (
		<DeviceLabelSheet devices={devices} backHref="/superadmin/devices" searchParams={params} />
	);
}
