"use client";

import { StepUpDialog } from "@/components/superadmin/step-up-dialog";
import { Alert, FIELD_LABEL, PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import { remoteFeedDevice, remoteSetDevicePause } from "@/lib/actions/platform/devices";
import { cn } from "@/lib/utils";
import { Loader2, Pause, Play, Sliders, Wheat } from "lucide-react";
import { useTranslations } from "next-intl";
import {
	type FormEvent,
	type ReactNode,
	createContext,
	useContext,
	useRef,
	useState,
	useTransition,
} from "react";

const MIN_REASON = 10;
const MIN_GRAMS = 1;
const MAX_GRAMS = 1000;

type Message = { tone: "ok" | "error" | "refused"; text: string };

/** Id of the full-width row that carries the open panel for one device. */
export function remoteFeedRowId(deviceId: string): string {
	return `remote-feed-${deviceId}`;
}

/**
 * Remote feeder control from the platform device registry (plan M5.2, D1).
 *
 * Manual feed and pause/resume call the same server command as the tenant
 * dashboard. There is no force flag and no cap override: a refusal (offline,
 * daily cap, >1,000 g, fallow pond) comes back as `feed_refused`/`pause_refused`
 * and is displayed, never hidden. Every action needs a reason and a fresh
 * step-up, and writes one audit row under the real admin.
 *
 * The panel itself has two hosts:
 *
 * - the table (#213): a small remote-control trigger in the Actions cell and
 *   the panel in a full-width row *under* the device row (`RemoteFeedRow`), so
 *   the form can never widen or overflow the Actions column;
 * - the card view: `RemoteFeederControl`, the self-contained button + panel.
 *
 * Both render the same `RemoteFeedForm`, so the behaviour, guards and caps are
 * identical wherever the panel is opened.
 */

function RemoteFeedForm({
	deviceId,
	label,
	isPaused,
	onClose,
}: {
	deviceId: string;
	label: string;
	isPaused: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("superadmin.remoteFeeder");
	const tCommon = useTranslations("superadmin.common");
	const router = useRouter();
	const [reason, setReason] = useState("");
	const [grams, setGrams] = useState("150");
	const [message, setMessage] = useState<Message | null>(null);
	const [stepUpOpen, setStepUpOpen] = useState(false);
	const retryRef = useRef<(() => void) | null>(null);
	const [isPending, startTransition] = useTransition();

	const fail = (text: string) => setMessage({ tone: "error", text });

	const validateReason = (): string | null => {
		const trimmed = reason.trim();
		if (trimmed.length < MIN_REASON) {
			fail(tCommon("reasonMinLength", { count: MIN_REASON }));
			return null;
		}
		return trimmed;
	};

	const runFeed = (trimmedReason: string, amount: number) => {
		startTransition(async () => {
			try {
				const result = await remoteFeedDevice({ deviceId, grams: amount, reason: trimmedReason });
				if ("error" in result) {
					if (result.code === "step_up_required") {
						retryRef.current = () => runFeed(trimmedReason, amount);
						setStepUpOpen(true);
						return;
					}
					if (result.code === "feed_refused") {
						setMessage({ tone: "refused", text: t("refused", { message: result.error }) });
						return;
					}
					fail(result.error);
					return;
				}
				setMessage({
					tone: "ok",
					text: result.message ?? t("feedQueued", { amount }),
				});
				router.refresh();
			} catch (err) {
				fail(err instanceof Error ? err.message : t("feedFailed"));
			}
		});
	};

	const runPause = (trimmedReason: string, nextPaused: boolean) => {
		startTransition(async () => {
			try {
				const result = await remoteSetDevicePause({
					deviceId,
					isPaused: nextPaused,
					reason: trimmedReason,
				});
				if ("error" in result) {
					if (result.code === "step_up_required") {
						retryRef.current = () => runPause(trimmedReason, nextPaused);
						setStepUpOpen(true);
						return;
					}
					if (result.code === "pause_refused") {
						setMessage({ tone: "refused", text: t("refused", { message: result.error }) });
						return;
					}
					fail(result.error);
					return;
				}
				setMessage({
					tone: "ok",
					text: result.isPaused ? t("paused") : t("resumed"),
				});
				router.refresh();
			} catch (err) {
				fail(err instanceof Error ? err.message : t("pauseFailed"));
			}
		});
	};

	const submitFeed = (e: FormEvent) => {
		e.preventDefault();
		setMessage(null);
		const trimmed = validateReason();
		if (!trimmed) return;
		const amount = Number(grams);
		if (!Number.isFinite(amount) || amount < MIN_GRAMS || amount > MAX_GRAMS) {
			fail(t("feedAmountRange", { min: MIN_GRAMS, max: MAX_GRAMS }));
			return;
		}
		runFeed(trimmed, amount);
	};

	const submitPause = () => {
		setMessage(null);
		const trimmed = validateReason();
		if (!trimmed) return;
		runPause(trimmed, !isPaused);
	};

	const onVerified = () => {
		setStepUpOpen(false);
		const retry = retryRef.current;
		retryRef.current = null;
		retry?.();
	};

	return (
		<>
			<form onSubmit={submitFeed} className="w-full min-w-0 space-y-2" aria-busy={isPending}>
				{/* The caps sentence is long and unbroken words can be wider than a
				    phone column: wrap anywhere instead of pushing the panel wide. */}
				<p className="text-[11px] leading-snug font-bold break-words text-[#3D5568]">
					{t("note", { max: MAX_GRAMS })}
				</p>
				<input
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					disabled={isPending}
					placeholder={tCommon("reasonPlaceholderShort")}
					aria-label={t("reasonAria", { label })}
					className="w-full min-w-0 rounded-lg border border-gray-200 bg-[#F4F7F6] px-3 py-2 text-xs text-[#0A3D62] focus:ring-2 focus:ring-[#E85A2A] focus:outline-none disabled:opacity-60"
				/>
				{/* Stacked on narrow widths (#213): the grams box and Feed button
				    never sit side by side in a column too narrow for both. */}
				<div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
					<div className="min-w-0 flex-1">
						<label htmlFor={`grams-${deviceId}`} className={FIELD_LABEL}>
							{t("grams")}
						</label>
						<input
							id={`grams-${deviceId}`}
							type="number"
							min={MIN_GRAMS}
							max={MAX_GRAMS}
							step="1"
							value={grams}
							onChange={(e) => setGrams(e.target.value)}
							disabled={isPending}
							className="mt-1 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-[#0A3D62] focus:ring-2 focus:ring-[#E85A2A] focus:outline-none disabled:opacity-60"
						/>
					</div>
					<button
						type="submit"
						disabled={isPending}
						className={cn(PRIMARY_BUTTON, "w-full px-3 py-2 text-xs font-black sm:w-auto")}
					>
						{isPending ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
						) : (
							<Wheat className="h-3.5 w-3.5" aria-hidden="true" />
						)}
						{t("feed")}
					</button>
				</div>

				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={submitPause}
						disabled={isPending}
						className={cn(SECONDARY_BUTTON, "px-3 py-1.5")}
					>
						{isPaused ? (
							<Play className="h-3.5 w-3.5" aria-hidden="true" />
						) : (
							<Pause className="h-3.5 w-3.5" aria-hidden="true" />
						)}
						{isPaused ? t("resumeSchedule") : t("pauseSchedule")}
					</button>
					<button
						type="button"
						onClick={onClose}
						disabled={isPending}
						className={cn(SECONDARY_BUTTON, "px-3 py-1.5")}
					>
						{t("close")}
					</button>
				</div>

				{message &&
					(message.tone === "ok" ? (
						<Alert tone="success">{message.text}</Alert>
					) : (
						<Alert tone={message.tone === "refused" ? "warning" : "error"}>{message.text}</Alert>
					))}
			</form>

			<StepUpDialog
				open={stepUpOpen}
				actionLabel={t("stepUpAction", { label })}
				onClose={() => setStepUpOpen(false)}
				onVerified={onVerified}
			/>
		</>
	);
}

function RemoteFeedOpenButton({
	deviceId,
	label,
	onOpen,
	expanded,
}: {
	deviceId: string;
	label: string;
	onOpen: () => void;
	/** Present in the table, where the panel lives in its own row. */
	expanded?: boolean;
}) {
	const t = useTranslations("superadmin.remoteFeeder");

	return (
		<button
			type="button"
			onClick={onOpen}
			data-help="superadmin-remote-feed"
			aria-label={t("openAria", { label })}
			aria-expanded={expanded}
			aria-controls={expanded ? remoteFeedRowId(deviceId) : undefined}
			className={SECONDARY_BUTTON}
		>
			<Sliders className="h-3.5 w-3.5" aria-hidden="true" />
			{t("open")}
		</button>
	);
}

/**
 * Self-contained trigger + panel for the card view. One card, one panel, so no
 * shared state is needed.
 */
export function RemoteFeederControl({
	deviceId,
	label,
	isPaused,
}: {
	deviceId: string;
	label: string;
	isPaused: boolean;
}) {
	const [open, setOpen] = useState(false);

	if (!open) {
		return <RemoteFeedOpenButton deviceId={deviceId} label={label} onOpen={() => setOpen(true)} />;
	}

	return (
		<RemoteFeedForm
			deviceId={deviceId}
			label={label}
			isPaused={isPaused}
			onClose={() => setOpen(false)}
		/>
	);
}

type RemoteFeedContextValue = {
	openId: string | null;
	toggle: (deviceId: string) => void;
	close: () => void;
};

const RemoteFeedContext = createContext<RemoteFeedContextValue | null>(null);

function useRemoteFeed(): RemoteFeedContextValue {
	const context = useContext(RemoteFeedContext);
	if (!context) {
		throw new Error("RemoteFeedRow/RemoteFeederTrigger must sit inside RemoteFeedProvider");
	}
	return context;
}

/**
 * One open panel at a time in the device table: a device row and the row that
 * carries its panel stay in sync through this provider (it renders no DOM).
 */
export function RemoteFeedProvider({ children }: { children: ReactNode }) {
	const [openId, setOpenId] = useState<string | null>(null);

	return (
		<RemoteFeedContext.Provider
			value={{
				openId,
				toggle: (deviceId) => setOpenId((current) => (current === deviceId ? null : deviceId)),
				close: () => setOpenId(null),
			}}
		>
			{children}
		</RemoteFeedContext.Provider>
	);
}

/** The compact trigger button that belongs in the table's Actions cell. */
export function RemoteFeederTrigger({ deviceId, label }: { deviceId: string; label: string }) {
	const { openId, toggle } = useRemoteFeed();

	return (
		<RemoteFeedOpenButton
			deviceId={deviceId}
			label={label}
			onOpen={() => toggle(deviceId)}
			expanded={openId === deviceId}
		/>
	);
}

/**
 * The full-width expanded row under a device row (#213). It spans every column
 * so the panel has room to breathe and the table never overflows its card.
 */
export function RemoteFeederRow({
	deviceId,
	label,
	isPaused,
	colSpan,
}: {
	deviceId: string;
	label: string;
	isPaused: boolean;
	colSpan: number;
}) {
	const { openId, close } = useRemoteFeed();
	const t = useTranslations("superadmin.remoteFeeder");

	if (openId !== deviceId) return null;

	return (
		<tr
			id={remoteFeedRowId(deviceId)}
			data-remote-feed-row
			className="border-b border-gray-50 bg-[#F4F7F6]/70 dark:border-gray-800 dark:bg-gray-800/40"
		>
			<td colSpan={colSpan} className="px-6 py-4">
				<div className="w-full min-w-0 max-w-2xl">
					<p className="mb-2 text-sm font-black text-[#0A3D62]">{t("panelTitle", { label })}</p>
					<RemoteFeedForm deviceId={deviceId} label={label} isPaused={isPaused} onClose={close} />
				</div>
			</td>
		</tr>
	);
}
