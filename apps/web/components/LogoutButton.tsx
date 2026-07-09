"use client";

import { useRouter } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/client";
import { Loader2, LogOut } from "lucide-react";
import { useState } from "react";

export function LogoutButton() {
	const [isPending, setIsPending] = useState(false);
	const router = useRouter();
	const supabase = createClient();

	const handleLogout = async () => {
		setIsPending(true);
		await supabase.auth.signOut();
		// Redirect to home/login page after logout
		router.replace("/");
	};

	return (
		<button
			type="button"
			onClick={handleLogout}
			disabled={isPending}
			className="flex min-h-[var(--ofd-touch-min)] items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-6 font-medium text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
		>
			{isPending ? <Loader2 size={18} className="animate-spin" /> : <LogOut size={18} />}
			Sign Out
		</button>
	);
}
