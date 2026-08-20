import { Link } from "@/i18n/routing";

export default function NotFound() {
	return (
		<div className="flex h-[50vh] flex-col items-center justify-center gap-4">
			<h2 className="text-2xl font-bold text-gray-800">Page not found</h2>
			<p className="text-gray-500">The page you are looking for does not exist.</p>
			<Link
				href="/dashboard"
				className="rounded-lg bg-[#E85A2A] px-6 py-2 font-medium text-white hover:opacity-90"
			>
				Back to Dashboard
			</Link>
		</div>
	);
}
