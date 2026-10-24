import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "PakaonAI — Precision Feeding",
		short_name: "PakaonAI",
		description: "Precision feeding, biomass, FCR and harvest monitoring for African catfish.",
		id: "/",
		start_url: "/dashboard",
		scope: "/",
		display: "standalone",
		background_color: "#F4F7F6",
		theme_color: "#0A3D62",
		orientation: "any",
		categories: ["productivity", "utilities"],
		icons: [
			{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
			{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
			{
				src: "/icons/maskable-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "maskable",
			},
		],
	};
}
