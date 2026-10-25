import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Sign in",
	description: "Sign in to your PakaonAI farm dashboard with your farm ID and password.",
	robots: {
		index: false,
		follow: false,
	},
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
	return children;
}
