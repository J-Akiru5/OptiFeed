import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
	// TODO(karl): Add image domains, rewrites, and any production-specific settings here.
};

export default withNextIntl(nextConfig);
