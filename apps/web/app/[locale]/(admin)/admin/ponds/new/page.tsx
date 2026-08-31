import { CreatePondForm } from "@/components/admin/create-pond-form";
import { Link } from "@/i18n/routing";
import { getUsers } from "@/lib/actions/admin";
import { ArrowLeft } from "lucide-react";

export default async function NewPondPage() {
	const users = await getUsers();

	return (
		<div className="space-y-6 max-w-2xl">
			<div>
				<Link
					href="/admin/ponds"
					className="inline-flex items-center gap-1.5 text-sm font-bold text-[#3D5568] hover:text-[#0A3D62] transition-colors mb-4"
				>
					<ArrowLeft className="w-4 h-4" />
					Back to Ponds
				</Link>
				<h1 className="text-2xl font-black text-[#0A3D62]">Create New Pond</h1>
				<p className="text-sm text-[#3D5568] mt-1">Add a new pond and assign it to a farm owner.</p>
			</div>

			<CreatePondForm users={users} />
		</div>
	);
}
