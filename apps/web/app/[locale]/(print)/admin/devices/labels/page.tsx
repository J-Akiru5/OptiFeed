import { DeviceLabelEmptyState } from "@/components/admin/device-label-empty-state";
import { DeviceLabelSheet } from "@/components/admin/device-label-sheet";
import { getDevicesForLabels } from "@/lib/actions/admin";
import { parseDeviceLabelIds } from "@/lib/device-label-selection";
import { notFound } from "next/navigation";

export default async function DeviceLabelsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const params = await searchParams;
	const ids = parseDeviceLabelIds(params.id);
	// No `id` means "every device in scope": the Devices page's print-selected
	// form submits no ids when no box is ticked.
	const devices = await getDevicesForLabels(ids);
	// An explicit selection that matches nothing stays a 404. Unknown and
	// out-of-scope devices both come back empty: same answer.
	if (ids.length > 0 && devices.length === 0) notFound();
	// An empty registry is a print destination with nothing to print, not a
	// missing page.
	if (devices.length === 0) return <DeviceLabelEmptyState backHref="/admin/devices" />;

	return <DeviceLabelSheet devices={devices} backHref="/admin/devices" searchParams={params} />;
}
