import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
	serverExternalPackages: ["@prisma/client"], // Good practice for prisma
	allowedDevOrigins: ["192.168.1.10"],
	// Hide the dev-only "N" route indicator (bottom-left overlay) that sits on
	// top of the chat UI. This never appears in production builds.
	devIndicators: false,
};

export default withNextIntl(nextConfig);
