"use client";

import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import { useChatWidget } from "./chat-widget-provider";

/**
 * Step-up gate for admin/superadmin assistant actions (issue #194, E10).
 *
 * The server leaves the proposal PENDING and answers `step_up_required`; this
 * dialog collects the password, then the same Accept is retried. The card and
 * its stored payload are untouched, and nothing executes before the retry.
 */
export function ChatStepUp() {
	const { stepUp, closeStepUp, confirmStepUp } = useChatWidget();

	return (
		<StepUpDialog
			open={!!stepUp}
			actionLabel={stepUp?.label ?? ""}
			onClose={closeStepUp}
			onVerified={confirmStepUp}
		/>
	);
}
