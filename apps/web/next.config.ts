import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const securityHeaders = [
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "X-Frame-Options", value: "DENY" },
	// "0" disables the legacy IE/Edge XSS auditor — "1; mode=block" can
	// itself be abused to mute parts of a page (F-013).
	{ key: "X-XSS-Protection", value: "0" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
	{
		key: "Content-Security-Policy",
		value: [
			"default-src 'self'",
			`script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data: blob: https://images.unsplash.com",
			"font-src 'self'",
			"connect-src 'self' https://*.supabase.co wss://*.supabase.co",
			"frame-ancestors 'none'",
		].join("; "),
	},
];

const nextConfig: NextConfig = {
	serverExternalPackages: ["@prisma/client"],
	allowedDevOrigins: ["192.168.1.10"],
	devIndicators: false,
	// Don't ship the "X-Powered-By: Next.js" disclosure header (F-013).
	poweredByHeader: false,
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

export default withNextIntl(nextConfig);
