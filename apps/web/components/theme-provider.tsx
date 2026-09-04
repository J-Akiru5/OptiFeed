"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	resolvedTheme: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
	const context = useContext(ThemeContext);
	if (!context) throw new Error("useTheme must be used within a ThemeProvider");
	return context;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setThemeState] = useState<Theme>("system");
	const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

	useEffect(() => {
		const stored = localStorage.getItem("optifeed:theme") as Theme | null;
		if (stored) setThemeState(stored);
	}, []);

	useEffect(() => {
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

		const resolve = () => {
			const isDark = theme === "dark" || (theme === "system" && mediaQuery.matches);
			setResolvedTheme(isDark ? "dark" : "light");
			document.documentElement.classList.toggle("dark", isDark);
		};

		resolve();
		mediaQuery.addEventListener("change", resolve);
		return () => mediaQuery.removeEventListener("change", resolve);
	}, [theme]);

	const setTheme = (newTheme: Theme) => {
		setThemeState(newTheme);
		localStorage.setItem("optifeed:theme", newTheme);
	};

	return (
		<ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}
