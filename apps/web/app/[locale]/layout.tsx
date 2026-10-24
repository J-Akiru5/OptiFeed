import { ThemeProvider } from "@/components/theme-provider";
import { routing } from "@/i18n/routing";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { Toaster } from "sonner";
import "../globals.css";

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
});

export const metadata: Metadata = {
	title: {
		default: "PakaonAI — Precision Feeding for African Catfish",
		template: "%s | PakaonAI",
	},
	description:
		"A precision feeding research prototype for African catfish. Log biomass samples, track FCR, and control an ESP32 feeder from anywhere.",
	keywords: ["catfish farm", "catfish", "aquaculture", "feeding automation", "ESP32", "FCR"],
	openGraph: {
		title: "PakaonAI — Precision Feeding for African Catfish",
		description:
			"A precision feeding research prototype for African catfish. Log a sample, and PakaonAI recalculates the ration and syncs the ESP32 feeder.",
		type: "website",
		siteName: "PakaonAI",
	},
	twitter: {
		card: "summary_large_image",
		title: "PakaonAI — Precision Feeding for African Catfish",
		description:
			"A precision feeding research prototype for African catfish. Log a sample and sync the next ration to the feeder.",
	},
	robots: {
		index: true,
		follow: true,
	},
};

export default async function LocaleLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;

	if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
		notFound();
	}

	const messages = await getMessages();

	return (
		<html lang={locale} className={`${inter.variable} h-full antialiased`}>
			<body className="min-h-full flex flex-col bg-[var(--ofd-bg)] dark:bg-gray-950 font-sans">
				<ThemeProvider>
					<NextIntlClientProvider messages={messages}>
						{children}
						<Toaster position="top-right" richColors />
					</NextIntlClientProvider>
					<Analytics />
					<SpeedInsights />
				</ThemeProvider>
			</body>
		</html>
	);
}
