// TODO(karl): Implement chat/help bubble once the support chat feature is defined.
export function ChatBubble() {
	return (
		<button
			type="button"
			aria-label="Help"
			className="fixed bottom-6 right-6 flex h-[var(--ofd-touch-min)] w-[var(--ofd-touch-min)] items-center justify-center rounded-full bg-[var(--ofd-action)] text-white shadow-lg"
		>
			<span className="text-2xl">💬</span>
		</button>
	);
}
