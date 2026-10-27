"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

export function PwaRegister() {
	const t = useTranslations("pwa");

	useEffect(() => {
		if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_PWA_DEV !== "1") return;
		if (!("serviceWorker" in navigator)) return;

		let cancelled = false;
		const register = () => {
			if (cancelled) return;
			navigator.serviceWorker
				.register("/sw.js", { scope: "/" })
				.then((registration) => {
					if (cancelled) return;
					registration.addEventListener("updatefound", () => {
						const installing = registration.installing;
						if (!installing) return;
						installing.addEventListener("statechange", () => {
							if (installing.state !== "installed" || cancelled) return;
							// A new cache version is ready. Never reload on its own:
							// the user may be halfway through a form.
							if (!navigator.serviceWorker.controller) return;
							toast.info(t("updateAvailable"), {
								action: {
									label: t("refreshNow"),
									onClick: () => window.location.reload(),
								},
							});
						});
					});
				})
				.catch(() => {
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
	}, [t]);

	return null;
}
