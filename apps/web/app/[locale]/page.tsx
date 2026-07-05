// TODO(karl): Build the public landing page (hero, value prop, CTA to login/signup).
export default function LandingPage() {
	return (
		<div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
			<h1 className="text-5xl font-bold text-[var(--ofd-base)]">OptiFeed</h1>
			<p className="mt-4 text-lg text-gray-700">Smart shrimp feeding management</p>
		</div>
	);
}
