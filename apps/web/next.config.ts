import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Shared directives for both the enforced and the Report-Only policy.
const cspDirectives = [
	"default-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob: https://images.unsplash.com",
	"font-src 'self'",
	"connect-src 'self' https://*.supabase.co wss://*.supabase.co",
	// F-025: forms and <base> tags may only target our origin — without
	// these, an injected <base> or form action could exfiltrate payloads.
	"form-action 'self'",
	"base-uri 'self'",
	"frame-ancestors 'none'",
];

const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
const vercelScript = "https://va.vercel-scripts.com";

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
			// 'unsafe-inline' stays enforced for now: Next.js and our inline
			// hydration data depend on it.
			`script-src 'self' 'unsafe-inline' ${vercelScript}${devEval}`,
			...cspDirectives,
		].join("; "),
	},
	{
		// F-025: monitor the stricter policy (no 'unsafe-inline' scripts)
		// before enforcing it — violations report without breaking the app.
		key: "Content-Security-Policy-Report-Only",
		value: [`script-src 'self' ${vercelScript}${devEval}`, ...cspDirectives].join("; "),
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
	/**
	 * §3.1 retrofit: `/api/v1/*` is the canonical tree; the legacy `/api/*`
	 * paths are dual-served to the same handlers until LEGACY_API_SUNSET
	 * (2027-06-30). A rewrite, not a duplicate route file, so the two trees
	 * cannot drift. `beforeFiles` is required so the versioned path wins over
	 * the `/api/[...fallback]` 404 handler.
	 */
	async rewrites() {
		return {
			beforeFiles: [{ source: "/api/v1/:path*", destination: "/api/:path*" }],
			afterFiles: [],
			fallback: [],
		};
	},
};

export default withNextIntl(nextConfig);
