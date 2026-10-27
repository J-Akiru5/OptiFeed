"use client";

import {
	FIELD_HINT,
	FIELD_INPUT,
	FIELD_LABEL,
	PRIMARY_BUTTON,
	SECONDARY_BUTTON,
} from "@/components/superadmin/ui";
import { useRouter } from "@/i18n/routing";
import { clearAnnouncement, publishAnnouncement } from "@/lib/actions/platform/announcements";
import {
	ANNOUNCEMENT_BODY_MAX,
	ANNOUNCEMENT_SEVERITIES,
	ANNOUNCEMENT_TITLE_MAX,
	type Announcement,
	type AnnouncementSeverity,
} from "@/lib/announcement";
import { cn } from "@/lib/utils";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

const MIN_REASON_LENGTH = 10;

/**
 * Publish/clear form for the platform announcement (E16.4, task I-15).
 *
 * The server action re-validates every field, the reason and the end date; this
 * form is convenience only. Publishing replaces the current banner.
 */
export function AnnouncementComposer({ current }: { current: Announcement | null }) {
	const t = useTranslations("superadmin.operations.announcements");
	const router = useRouter();

	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [severity, setSeverity] = useState<AnnouncementSeverity>("info");
	const [endsOn, setEndsOn] = useState("");
	const [reason, setReason] = useState("");
	const [clearReason, setClearReason] = useState("");
	const [pending, setPending] = useState(false);
	const [clearing, setClearing] = useState(false);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setPending(true);
		try {
			const result = await publishAnnouncement(
				{ title, body, severity, endsOn: endsOn || null },
				reason,
			);
			if ("error" in result) {
				toast.error(result.error);
				return;
			}
			toast.success(t("published"));
			setTitle("");
			setBody("");
			setEndsOn("");
			setReason("");
			router.refresh();
		} catch {
			toast.error(t("failed"));
		} finally {
			setPending(false);
		}
	};

	const handleClear = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setClearing(true);
		try {
			const result = await clearAnnouncement(clearReason);
			if ("error" in result) {
				toast.error(result.error);
				return;
			}
			toast.success(t("cleared"));
			setClearReason("");
			router.refresh();
		} catch {
			toast.error(t("failed"));
		} finally {
			setClearing(false);
		}
	};

	const previewTitle = title.trim() || t("previewTitle");
	const previewBody = body.trim() || t("previewBody");
	const warning = severity === "warning";
	const PreviewIcon = warning ? AlertTriangle : Info;

	return (
		<div className="space-y-4">
			<form onSubmit={handleSubmit} className="space-y-4">
				<label className="block">
					<span className={FIELD_LABEL}>{t("titleLabel")}</span>
					<input
						type="text"
						required
						minLength={3}
						maxLength={ANNOUNCEMENT_TITLE_MAX}
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder={t("titlePlaceholder")}
						className={`${FIELD_INPUT} mt-1`}
					/>
				</label>

				<label className="block">
					<span className={FIELD_LABEL}>{t("bodyLabel")}</span>
					<textarea
						required
						minLength={3}
						maxLength={ANNOUNCEMENT_BODY_MAX}
						rows={3}
						value={body}
						onChange={(event) => setBody(event.target.value)}
						placeholder={t("bodyPlaceholder")}
						className={`${FIELD_INPUT} mt-1 resize-y`}
					/>
					<span className={`${FIELD_HINT} mt-1 block`}>{t("bodyHint")}</span>
				</label>

				<div className="grid gap-4 sm:grid-cols-2">
					<label className="block">
						<span className={FIELD_LABEL}>{t("severityLabel")}</span>
						<select
							value={severity}
							onChange={(event) => setSeverity(event.target.value as AnnouncementSeverity)}
							className={`${FIELD_INPUT} mt-1`}
						>
							{ANNOUNCEMENT_SEVERITIES.map((value) => (
								<option key={value} value={value}>
									{t(`severity.${value}`)}
								</option>
							))}
						</select>
					</label>

					<label className="block">
						<span className={FIELD_LABEL}>{t("endsOnLabel")}</span>
						<input
							type="date"
							value={endsOn}
							onChange={(event) => setEndsOn(event.target.value)}
							className={`${FIELD_INPUT} mt-1`}
						/>
						<span className={`${FIELD_HINT} mt-1 block`}>{t("endsOnHint")}</span>
					</label>
				</div>

				<label className="block">
					<span className={FIELD_LABEL}>{t("reasonLabel")}</span>
					<input
						type="text"
						required
						minLength={MIN_REASON_LENGTH}
						maxLength={500}
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						placeholder={t("reasonPlaceholder")}
						className={`${FIELD_INPUT} mt-1`}
					/>
					<span className={`${FIELD_HINT} mt-1 block`}>{t("reasonHint")}</span>
				</label>

				<div>
					<p className={FIELD_LABEL}>{t("preview")}</p>
					<div
						className={cn(
							"mt-2 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
							warning
								? "border-[#F0C36D] bg-[#FFF7E6] text-[#7A4B00]"
								: "border-[#9CC3E0] bg-[#EDF6FC] text-[#0A3D62]",
						)}
					>
						<PreviewIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
						<div className="min-w-0">
							<p className="text-[10px] font-black tracking-wider uppercase opacity-80">
								{t(`severity.${severity}`)}
							</p>
							<p className="font-black">{previewTitle}</p>
							<p className="mt-0.5 whitespace-pre-line">{previewBody}</p>
						</div>
					</div>
				</div>

				<button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
					{pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
					{pending ? t("publishing") : current ? t("replace") : t("publish")}
				</button>
			</form>

			{current && (
				<form
					onSubmit={handleClear}
					className="space-y-3 rounded-2xl border border-[#C42B3A]/20 bg-[#FDE8EA]/30 p-4"
				>
					<p className="text-sm font-black text-[#0A3D62]">{t("clearTitle")}</p>
					<p className="text-xs text-[#3D5568]">{t("clearDescription")}</p>
					<label className="block">
						<span className={FIELD_LABEL}>{t("reasonLabel")}</span>
						<input
							type="text"
							required
							minLength={MIN_REASON_LENGTH}
							maxLength={500}
							value={clearReason}
							onChange={(event) => setClearReason(event.target.value)}
							placeholder={t("reasonPlaceholder")}
							className={`${FIELD_INPUT} mt-1`}
						/>
					</label>
					<button type="submit" disabled={clearing} className={SECONDARY_BUTTON}>
						{clearing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
						{clearing ? t("clearing") : t("clear")}
					</button>
				</form>
			)}
		</div>
	);
}
