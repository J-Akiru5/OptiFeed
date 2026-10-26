import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	const baseUrl = "https://pakaonai.syntaxure.dev";

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
