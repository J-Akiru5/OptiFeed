import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { PrivacyPolicyContent } from "@/components/legal/privacy-policy-content";
import { LEGAL_PUBLISHED } from "@/lib/legal/config";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ locale: string }>;
}): Promise<Metadata> {
	const { locale } = await params;
	const t = await getTranslations({ locale, namespace: "legal" });

	return {
		title: t("privacyMetaTitle"),
		description: t("privacyMetaDescription"),
		alternates: {
			canonical: `/${locale}/privacy`,
		},
		robots: LEGAL_PUBLISHED ? { index: true, follow: true } : { index: false, follow: false },
	};
}

export default function PrivacyPolicyPage() {
	return (
		<LegalPageShell kind="privacy">
			<PrivacyPolicyContent />
		</LegalPageShell>
	);
}
