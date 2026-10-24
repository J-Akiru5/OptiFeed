"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { Component, type ReactNode } from "react";

interface CalendarErrorBoundaryProps {
	children: ReactNode;
	title: string;
	message: string;
	retryLabel: string;
	resetKey?: string;
}

interface CalendarErrorBoundaryState {
	hasError: boolean;
}

/**
 * Keeps a failed FullCalendar chunk/rendering from taking down the Harvest
 * page. The calendar is dynamically imported, so a stale deploy or a runtime
 * error in the view should leave the rest of the page usable.
 */
export class CalendarErrorBoundary extends Component<
	CalendarErrorBoundaryProps,
	CalendarErrorBoundaryState
> {
	state: CalendarErrorBoundaryState = { hasError: false };

	static getDerivedStateFromError(): CalendarErrorBoundaryState {
		return { hasError: true };
	}

	componentDidCatch(error: unknown) {
		console.error("[harvest-calendar] Calendar failed to render:", error);
	}

	componentDidUpdate(previous: CalendarErrorBoundaryProps) {
		if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
			this.setState({ hasError: false });
		}
	}

	private retry = () => {
		this.setState({ hasError: false });
	};

	render() {
		if (this.state.hasError) {
			return (
				<div
					role="alert"
					className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-3xl border border-red-200 bg-red-50/70 p-6 text-center dark:border-red-900/50 dark:bg-red-950/20"
				>
					<CircleAlert className="h-6 w-6 text-red-600 dark:text-red-400" />
					<div>
						<p className="text-sm font-black text-red-700 dark:text-red-300">{this.props.title}</p>
						<p className="mt-1 max-w-sm text-xs text-red-600 dark:text-red-400">
							{this.props.message}
						</p>
					</div>
					<button
						type="button"
						onClick={this.retry}
						className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30"
					>
						<RefreshCw className="h-3.5 w-3.5" />
						{this.props.retryLabel}
					</button>
				</div>
			);
		}

		return this.props.children;
	}
}
