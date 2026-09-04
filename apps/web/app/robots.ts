import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://optifeed.app";

	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: ["/en/dashboard", "/en/admin", "/en/signup", "/api/"],
			},
		],
		sitemap: `${baseUrl}/sitemap.xml`,
	};
}
