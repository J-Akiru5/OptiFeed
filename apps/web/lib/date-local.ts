// Helper to format dates using our custom translation map for Hiligaynon support
export function formatDateTimeLocal(date: Date, tDates: (key: string) => string) {
	const enDay = date.toLocaleString("en-US", { weekday: "short" });
	const enMonth = date.toLocaleString("en-US", { month: "short" });

	const localizedDay = tDates(`days.${enDay}`);
	const localizedMonth = tDates(`months.${enMonth}`);
	const dayOfMonth = date.getDate();

	const hours = date.getHours();
	const minutes = date.getMinutes().toString().padStart(2, "0");
	const ampm = hours >= 12 ? tDates("pm") : tDates("am");
	const hr12 = hours % 12 || 12;

	return {
		date: `${localizedMonth} ${dayOfMonth}`, // e.g., "Jul 8" or "Hul 8"
		time: `${hr12}:${minutes} ${ampm}`, // e.g., "4:19 AM"
		fullDate: `${localizedDay}, ${localizedMonth} ${dayOfMonth}`, // e.g., "Wed, Jul 8"
		full: `${localizedDay}, ${localizedMonth} ${dayOfMonth} • ${hr12}:${minutes} ${ampm}`,
	};
}
