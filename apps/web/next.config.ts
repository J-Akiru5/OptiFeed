import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
	serverExternalPackages: ["@prisma/client"], // Good practice for prisma
	allowedDevOrigins: ["192.168.1.10"],
};

export default withNextIntl(nextConfig);
