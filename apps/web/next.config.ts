import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const securityHeaders = [
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "X-XSS-Protection", value: "1; mode=block" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
	{
		key: "Content-Security-Policy",
		value: [
			"default-src 'self'",
			`script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data: blob: https://images.unsplash.com",
			"font-src 'self'",
			"connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io",
			"frame-ancestors 'none'",
		].join("; "),
	},
];

const nextConfig: NextConfig = {
	serverExternalPackages: ["@prisma/client"],
	allowedDevOrigins: ["192.168.1.10"],
	devIndicators: false,
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "images.unsplash.com",
			},
		],
	},
	async headers() {
		return [
			{
				source: "/(.*)",
				headers: securityHeaders,
			},
		];
	},
};

export default withSentryConfig(withNextIntl(nextConfig), {
	org: process.env.SENTRY_ORG,
	project: process.env.SENTRY_PROJECT,
	silent: !process.env.CI,
	widenClientFileUpload: true,
	sourcemaps: { disable: true },
});
