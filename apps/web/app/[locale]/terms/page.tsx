import { LegalPageShell } from "@/components/legal/legal-page-shell";
import { TermsOfServiceContent } from "@/components/legal/terms-of-service-content";
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
		title: t("termsMetaTitle"),
		description: t("termsMetaDescription"),
		alternates: {
			canonical: `/${locale}/terms`,
		},
		robots: LEGAL_PUBLISHED ? { index: true, follow: true } : { index: false, follow: false },
	};
}

export default function TermsOfServicePage() {
	return (
		<LegalPageShell kind="terms">
			<TermsOfServiceContent />
		</LegalPageShell>
	);
}
