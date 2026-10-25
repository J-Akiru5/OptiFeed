"use client";

import { useEffect } from "react";

export function PwaRegister() {
	useEffect(() => {
		if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_PWA_DEV !== "1") return;
		if (!("serviceWorker" in navigator)) return;

		let cancelled = false;
		const register = () => {
			if (cancelled) return;
			navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
				// Registration is best-effort; the app still works online without it.
			});
		};

		if (document.readyState === "complete") {
			register();
		} else {
			window.addEventListener("load", register, { once: true });
		}

		return () => {
			cancelled = true;
			window.removeEventListener("load", register);
		};
	}, []);

	return null;
}
