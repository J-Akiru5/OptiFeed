import { ConfigCentre, type ConfigSection } from "@/components/superadmin/config-centre";
import {
	FeatureFlagsForm,
	FeedingCapsForm,
	OrgDefaultsForm,
} from "@/components/superadmin/config-forms";
import {
	AiProvidersCard,
	EmailStatusCard,
	FirmwareStatusCard,
	StickerDefaultCard,
} from "@/components/superadmin/config-status";
import { DeviceStatusSettings } from "@/components/superadmin/device-status-settings";
import { FirmwareGatesSettings } from "@/components/superadmin/firmware-gates-settings";
import { PlatformListSettings } from "@/components/superadmin/platform-settings";
import { PageHeader } from "@/components/superadmin/ui";
import { listAiProviderConfig } from "@/lib/actions/ai-providers";
import { MEMBER_ROLES } from "@/lib/auth/member-rules";
import { getDeviceStatusSetting } from "@/lib/settings/device-status";
import { getEmailConfiguration } from "@/lib/settings/email-status";
import {
	FEEDING_CAPS_HARD_MAX,
	FEEDING_CAPS_MIN,
	getFeedingLimits,
} from "@/lib/settings/feeding-caps";
import { getFirmwareGates } from "@/lib/settings/firmware-gates";
import { getFirmwareStatus } from "@/lib/settings/firmware-status";
import { FEATURE_FLAGS, getFeatureFlags } from "@/lib/settings/flags";
import {
	DEVICE_REGISTRATION_MODES,
	ORG_DEFAULT_FEEDING_RATE_MAX,
	ORG_DEFAULT_FEEDING_RATE_MIN,
	ORG_HOPPER_LOW_PCT_MAX,
	ORG_HOPPER_LOW_PCT_MIN,
	ORG_OFFLINE_AFTER_MIN_MAX,
	ORG_OFFLINE_AFTER_MIN_MIN,
	getOrgDefaultSettings,
} from "@/lib/settings/org";
import {
	LIST_PAGE_SIZE_DEFAULT,
	LIST_PAGE_SIZE_MAX,
	LIST_PAGE_SIZE_MIN,
	getListPageSize,
} from "@/lib/settings/platform";
import { getStickerRatingDefault } from "@/lib/settings/sticker-rating";
import { getTranslations } from "next-intl/server";

/**
 * Platform configuration centre (decision E16.3, task I-14).
 *
 * Nine sections in one place: lists, device connectivity, sticker rating, AI
 * providers, email and invites, feeding safety caps, defaults for new
 * organizations, firmware/OTA status and feature flags. Writes live in `lib/actions/platform/config.ts` and
 * every one of them is a platform action with a reason and an audit row.
 */
export default async function SuperadminSettingsPage() {
	const [pageSize, caps, orgDefaults, flags, stickerRating, aiProviders, deviceStatus, gates, t] =
		await Promise.all([
			getListPageSize(),
			getFeedingLimits(),
			getOrgDefaultSettings(),
			getFeatureFlags(),
			getStickerRatingDefault(),
			listAiProviderConfig(),
			getDeviceStatusSetting(),
			getFirmwareGates(),
			getTranslations("superadmin.settings"),
		]);

	const email = getEmailConfiguration();
	const firmware = await getFirmwareStatus();

	const sections: ConfigSection[] = [
		{
			id: "lists",
			icon: "lists",
			title: t("lists.title"),
			description: t("lists.description"),
			content: (
				<PlatformListSettings
					initialPageSize={pageSize}
					min={LIST_PAGE_SIZE_MIN}
					max={LIST_PAGE_SIZE_MAX}
					fallback={LIST_PAGE_SIZE_DEFAULT}
				/>
			),
		},
		{
			id: "firmware-gates",
			icon: "safety",
			title: t("firmwareGates.title"),
			description: t("firmwareGates.description"),
			content: <FirmwareGatesSettings initial={gates} />,
		},
		{
			id: "device-status",
			icon: "device",
			title: t("deviceStatus.title"),
			description: t("deviceStatus.description"),
			content: <DeviceStatusSettings initial={deviceStatus} />,
		},
		{
			id: "stickers",
			icon: "stickers",
			title: t("stickers.title"),
			description: t("stickers.description"),
			content: <StickerDefaultCard rating={stickerRating} />,
		},
		{
			id: "ai",
			icon: "ai",
			title: t("ai.title"),
			description: t("ai.description"),
			content: (
				<AiProvidersCard
					enabled={aiProviders.filter((provider) => provider.enabled).length}
					total={aiProviders.length}
				/>
			),
		},
		{
			id: "email",
			icon: "email",
			title: t("email.title"),
			description: t("email.description"),
			content: <EmailStatusCard configuration={email} />,
		},
		{
			id: "safety",
			icon: "safety",
			title: t("safety.title"),
			description: t("safety.description"),
			content: (
				<div data-help="setting-platform-safety-caps">
					<FeedingCapsForm initial={caps} min={FEEDING_CAPS_MIN} hardMax={FEEDING_CAPS_HARD_MAX} />
				</div>
			),
		},
		{
			id: "defaults",
			icon: "defaults",
			title: t("defaults.title"),
			description: t("defaults.description"),
			content: (
				<div data-help="setting-platform-org-defaults">
					<OrgDefaultsForm
						initial={orgDefaults}
						bounds={{
							feedingRateMin: ORG_DEFAULT_FEEDING_RATE_MIN,
							feedingRateMax: ORG_DEFAULT_FEEDING_RATE_MAX,
							hopperLowMin: ORG_HOPPER_LOW_PCT_MIN,
							hopperLowMax: ORG_HOPPER_LOW_PCT_MAX,
							offlineAfterMinMin: ORG_OFFLINE_AFTER_MIN_MIN,
							offlineAfterMinMax: ORG_OFFLINE_AFTER_MIN_MAX,
						}}
						roles={MEMBER_ROLES}
						modes={DEVICE_REGISTRATION_MODES}
						adminApprovalMode="ADMIN_APPROVAL"
					/>
				</div>
			),
		},
		{
			id: "firmware",
			icon: "firmware",
			title: t("firmware.title"),
			description: t("firmware.description"),
			content: <FirmwareStatusCard status={firmware} />,
		},
		{
			id: "flags",
			icon: "flags",
			title: t("flags.title"),
			description: t("flags.description"),
			content: (
				<div data-help="setting-platform-flags">
					<FeatureFlagsForm
						flags={FEATURE_FLAGS.map((flag) => ({
							key: flag.key,
							id: flag.id,
							enabled: flags[flag.id],
						}))}
					/>
				</div>
			),
		},
	];

	return (
		<div className="space-y-6">
			<PageHeader title={t("title")} description={t("description")} />
			<ConfigCentre sections={sections} />
		</div>
	);
}
