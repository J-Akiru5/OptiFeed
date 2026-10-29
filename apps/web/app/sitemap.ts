import { LEGAL_PUBLISHED } from "@/lib/legal/config";
import { resolveSiteUrl } from "@/lib/site-url";
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
	const baseUrl = resolveSiteUrl();
	const now = new Date();

	const legalEntries: MetadataRoute.Sitemap = LEGAL_PUBLISHED
		? [
				{
					url: `${baseUrl}/en/privacy`,
					lastModified: now,
					changeFrequency: "yearly",
					priority: 0.3,
				},
				{
					url: `${baseUrl}/en/terms`,
					lastModified: now,
					changeFrequency: "yearly",
					priority: 0.3,
				},
				{
					url: `${baseUrl}/hil/privacy`,
					lastModified: now,
					changeFrequency: "yearly",
					priority: 0.3,
				},
				{
					url: `${baseUrl}/hil/terms`,
					lastModified: now,
					changeFrequency: "yearly",
					priority: 0.3,
				},
			]
		: [];

	return [
		{
			url: baseUrl,
			lastModified: now,
			changeFrequency: "monthly",
			priority: 1,
		},
		{
			url: `${baseUrl}/en/login`,
			lastModified: now,
			changeFrequency: "monthly",
			priority: 0.8,
		},
		...legalEntries,
	];
}
