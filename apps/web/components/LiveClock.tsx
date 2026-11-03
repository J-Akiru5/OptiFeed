"use client";

import { formatFarmDateTime } from "@/lib/date-local";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/**
 * Header clock. Time is formatted through `lib/date-local` in the farm's
 * timezone so it follows the selected locale (English, Hiligaynon or Tagalog)
 * and shows the same wall clock as the rest of the farm surfaces, instead of
 * the browser's runtime timezone.
 */
export function LiveClock() {
	const tDates = useTranslations("dates");
	const [now, setNow] = useState<Date | null>(null);

	useEffect(() => {
		setNow(new Date());
		const id = setInterval(() => setNow(new Date()), 1000);
		return () => clearInterval(id);
	}, []);

	if (!now) return null;

	const clock = formatFarmDateTime(now, (key) => tDates(key));

	return (
		<time
			dateTime={now.toISOString()}
			className="hidden md:block font-mono text-[11px] text-white/70 tabular-nums tracking-wider"
		>
			{clock.time}
		</time>
	);
}
