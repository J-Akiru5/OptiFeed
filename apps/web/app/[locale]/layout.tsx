import { OfflineBanner } from "@/components/pwa/offline-banner";
import { PwaRegister } from "@/components/pwa/pwa-register";
import { ThemeProvider } from "@/components/theme-provider";
import { routing } from "@/i18n/routing";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata, Viewport } from "next";
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

const SITE_URL = "https://pakaonai.syntaxure.dev";
const OG_IMAGE_ALT = "PakaonAI — AI-powered smart feeding for catfish farms";

export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),
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
		images: [
			{
				url: `${SITE_URL}/og.png`,
				width: 1200,
				height: 630,
				alt: OG_IMAGE_ALT,
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: "PakaonAI — Precision Feeding for African Catfish",
		description:
			"A precision feeding research prototype for African catfish. Log a sample and sync the next ration to the feeder.",
		images: [{ url: `${SITE_URL}/og.png`, alt: OG_IMAGE_ALT }],
	},
	robots: {
		index: true,
		follow: true,
	},
	manifest: "/manifest.webmanifest",
	appleWebApp: {
		capable: true,
		title: "PakaonAI",
		statusBarStyle: "default",
	},
	icons: {
		icon: [
			{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
			{ url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
		],
		apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
	},
};

export const viewport: Viewport = {
	themeColor: "#0A3D62",
	viewportFit: "cover",
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
						<PwaRegister />
						{children}
						<OfflineBanner />
						<Toaster position="top-right" richColors />
					</NextIntlClientProvider>
					<Analytics />
					<SpeedInsights />
				</ThemeProvider>
			</body>
		</html>
	);
}
