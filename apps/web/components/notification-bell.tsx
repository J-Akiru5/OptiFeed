// TODO(karl): Implement notification bell with unread count and dropdown once the notifications feature is built.
export function NotificationBell() {
	return (
		<button
			type="button"
			aria-label="Notifications"
			className="flex h-[var(--ofd-touch-min)] w-[var(--ofd-touch-min)] items-center justify-center"
		>
			<span className="text-2xl">🔔</span>
		</button>
	);
}
