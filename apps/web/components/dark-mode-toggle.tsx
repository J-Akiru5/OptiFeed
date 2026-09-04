"use client";

import { useTheme } from "@/components/theme-provider";
import { Moon, Sun } from "lucide-react";

export function DarkModeToggle() {
	const { resolvedTheme, setTheme } = useTheme();

	const toggle = () => {
		setTheme(resolvedTheme === "dark" ? "light" : "dark");
	};

	return (
		<button
			type="button"
			onClick={toggle}
			className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
			aria-label="Toggle dark mode"
		>
			{resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
		</button>
	);
}
