import { resolveSiteUrl } from "@/lib/site-url";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	const baseUrl = resolveSiteUrl();

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
