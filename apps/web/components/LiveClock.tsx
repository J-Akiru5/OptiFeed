"use client";

import { useEffect, useState } from "react";

export function LiveClock() {
	const [now, setNow] = useState<Date | null>(null);

	useEffect(() => {
		setNow(new Date());
		const id = setInterval(() => setNow(new Date()), 1000);
		return () => clearInterval(id);
	}, []);

	if (!now) return null;

	return (
		<time
			dateTime={now.toISOString()}
			className="hidden md:block font-mono text-[11px] text-white/60 tabular-nums tracking-wider"
		>
			{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
		</time>
	);
}
