import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { HiligaynonSummary } from "@/components/legal/hiligaynon-summary";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/routing";
import {
	DPO_ADDRESS,
	DPO_EMAIL,
	DPO_NAME,
	LEGAL_APP_RELEASE,
	LEGAL_EFFECTIVE_DATE,
	LEGAL_LAST_UPDATED,
	LEGAL_PUBLISHED,
	LEGAL_REVIEWER,
	LEGAL_VERSION,
	NPC_COMPLAINT_URL,
	NPC_WEBSITE,
} from "@/lib/legal/config";
import { PRIVACY_SECTIONS, TERMS_SECTIONS } from "@/lib/legal/sections";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import type { ReactNode } from "react";

function formatDate(iso: string): string {
	return new Intl.DateTimeFormat("en-PH", {
		dateStyle: "long",
		timeZone: "UTC",
	}).format(new Date(`${iso}T00:00:00.000Z`));
}

export async function LegalPageShell({
	kind,
	children,
}: {
	kind: "privacy" | "terms";
	children: ReactNode;
}) {
	const t = await getTranslations("legal");
	const locale = await getLocale();
	const sections = kind === "privacy" ? PRIVACY_SECTIONS : TERMS_SECTIONS;
	const title = t(`${kind}Title`);
	const description = t(`${kind}Description`);
	const effectiveDate = formatDate(LEGAL_EFFECTIVE_DATE);

	return (
		<div className="min-h-screen bg-[#F4F7F6] text-[#0A2E47] dark:bg-[#0B1117] dark:text-slate-100">
			<header className="sticky top-0 z-30 border-b border-[#DFE7E4]/80 bg-[#F4F7F6]/90 backdrop-blur-md dark:border-white/10 dark:bg-[#0B1117]/90">
				<div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
					<Link
						href="/"
						className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0B1117]"
					>
						<OptiFeedLogo size={30} variant="color" />
						<Image
							src="/pakaonai-logo-kit/png/pakaonai-wordmark-color.png"
							alt="PakaonAI"
							width={150}
							height={30}
							className="h-[18px] w-auto object-contain"
						/>
					</Link>
					<div className="flex items-center gap-2.5">
						<Link
							href="/"
							className="hidden rounded-md px-2 py-1.5 text-[12px] font-medium text-slate-500 transition-colors hover:text-[#0A3D62] sm:inline-flex dark:text-slate-400 dark:hover:text-white"
						>
							{t("backHome")}
						</Link>
						<LocaleSwitcher variant="light" />
					</div>
				</div>
			</header>

			<main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 lg:py-12">
				{!LEGAL_PUBLISHED ? (
					<div className="mb-6 rounded-xl border border-[#B54708]/25 bg-[#FFFAEB] p-4 text-[#7A2E0E] dark:border-[#F79009]/25 dark:bg-[#F79009]/10 dark:text-[#FEC84B]">
						<p className="text-[13px] font-semibold">{t("draftTitle")}</p>
						<p className="mt-1 text-[12.5px] leading-6">
							{t("draftBody", { date: effectiveDate })}
						</p>
					</div>
				) : null}

				<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start">
					<article className="min-w-0">
						<header className="border-b border-[#DFE7E4] pb-7 dark:border-white/10">
							<p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#E85A2A] dark:text-[#FF8A5C]">
								{t("eyebrow")}
							</p>
							<h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-[#0A2E47] sm:text-[2.6rem] dark:text-white">
								{title}
							</h1>
							<p className="mt-3 max-w-2xl text-[14px] leading-6 text-slate-600 dark:text-slate-400">
								{description}
							</p>

							<dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-[11.5px] sm:grid-cols-3">
								<div>
									<dt className="font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
										{t("version")}
									</dt>
									<dd className="mt-0.5 font-semibold text-[#0A2E47] dark:text-white">
										{LEGAL_VERSION}
									</dd>
								</div>
								<div>
									<dt className="font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
										{t("status")}
									</dt>
									<dd className="mt-0.5 font-semibold text-[#0A2E47] dark:text-white">
										{LEGAL_PUBLISHED ? t("statusEffective") : t("statusDraft")}
									</dd>
								</div>
								<div>
									<dt className="font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
										{t("appliesTo")}
									</dt>
									<dd className="mt-0.5 font-semibold text-[#0A2E47] dark:text-white">
										{t("appRelease", { release: LEGAL_APP_RELEASE })}
									</dd>
								</div>
								<div>
									<dt className="font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
										{t("lastUpdated")}
									</dt>
									<dd className="mt-0.5 text-slate-600 dark:text-slate-300">
										{formatDate(LEGAL_LAST_UPDATED)}
									</dd>
								</div>
								<div>
									<dt className="font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
										{LEGAL_PUBLISHED ? t("effective") : t("proposedEffective")}
									</dt>
									<dd className="mt-0.5 text-slate-600 dark:text-slate-300">{effectiveDate}</dd>
								</div>
								<div>
									<dt className="font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
										{t("reviewedBy")}
									</dt>
									<dd className="mt-0.5 text-slate-600 dark:text-slate-300">
										{LEGAL_PUBLISHED ? LEGAL_REVIEWER : t("reviewPending")}
									</dd>
								</div>
							</dl>
						</header>

						<div className="mt-6 space-y-8">
							<HiligaynonSummary kind={kind} />

							<details className="rounded-xl border border-[#DFE7E4] bg-white p-4 lg:hidden dark:border-white/10 dark:bg-white/[0.03]">
								<summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-[0.12em] text-[#0A3D62] dark:text-[#8EC5EF]">
									{t("contents")}
								</summary>
								<nav className="mt-3 grid gap-1.5 text-[12.5px]">
									{sections.map((section) => (
										<a
											key={section.id}
											href={`#${section.id}`}
											className="rounded px-1 py-0.5 text-slate-600 transition-colors hover:text-[#E85A2A] dark:text-slate-300 dark:hover:text-[#FF8A5C]"
										>
											{section.title}
										</a>
									))}
								</nav>
							</details>

							<div lang="en" className="space-y-8">
								{children}
							</div>
						</div>

						<footer className="mt-12 border-t border-[#DFE7E4] pt-6 text-[12px] leading-6 text-slate-500 dark:border-white/10 dark:text-slate-400">
							<p className="font-semibold text-[#0A2E47] dark:text-white">
								{DPO_NAME} · {t("dpo")}
							</p>
							<p className="mt-1">
								<a
									href={`mailto:${DPO_EMAIL}`}
									className="font-medium text-[#0A3D62] underline decoration-[#0A3D62]/25 underline-offset-2 hover:text-[#E85A2A] dark:text-[#8EC5EF] dark:hover:text-[#FF8A5C]"
								>
									{DPO_EMAIL}
								</a>
							</p>
							<p className="mt-1">{DPO_ADDRESS}</p>
							<p className="mt-3">
								{t("npc")}:{" "}
								<a
									href={NPC_WEBSITE}
									target="_blank"
									rel="noreferrer"
									className="font-medium text-[#0A3D62] underline decoration-[#0A3D62]/25 underline-offset-2 hover:text-[#E85A2A] dark:text-[#8EC5EF] dark:hover:text-[#FF8A5C]"
								>
									{NPC_WEBSITE}
								</a>{" "}
								·{" "}
								<a
									href={NPC_COMPLAINT_URL}
									target="_blank"
									rel="noreferrer"
									className="font-medium text-[#0A3D62] underline decoration-[#0A3D62]/25 underline-offset-2 hover:text-[#E85A2A] dark:text-[#8EC5EF] dark:hover:text-[#FF8A5C]"
								>
									{t("complaints")}
								</a>
							</p>
							<div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#EDF2EF] pt-4 text-[11px] dark:border-white/[0.06]">
								<Link href="/privacy" className="font-medium hover:text-[#E85A2A]">
									{t("privacy")}
								</Link>
								<Link href="/terms" className="font-medium hover:text-[#E85A2A]">
									{t("terms")}
								</Link>
								<span className="text-slate-400 dark:text-slate-500">
									{t("footerVersion", {
										version: LEGAL_VERSION,
										release: LEGAL_APP_RELEASE,
									})}
								</span>
							</div>
						</footer>
					</article>

					<aside className="hidden lg:block">
						<nav
							aria-label={t("contents")}
							className="sticky top-24 rounded-xl border border-[#DFE7E4] bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]"
						>
							<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
								{t("contents")}
							</p>
							<ol className="mt-3 grid gap-1.5 text-[12px] leading-5">
								{sections.map((section) => (
									<li key={section.id}>
										<a
											href={`#${section.id}`}
											className="block rounded px-1 py-0.5 text-slate-600 transition-colors hover:text-[#E85A2A] dark:text-slate-300 dark:hover:text-[#FF8A5C]"
										>
											{section.title}
										</a>
									</li>
								))}
							</ol>
						</nav>
					</aside>
				</div>
			</main>

			<footer className="border-t border-[#DFE7E4] px-5 py-6 text-[11px] text-slate-500 sm:px-8 dark:border-white/10 dark:text-slate-400">
				<div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-5 gap-y-2">
					<p>{t("footerNote")}</p>
					<p className="font-mono tracking-wide">
						{t("footerVersion", { version: LEGAL_VERSION, release: LEGAL_APP_RELEASE })}
					</p>
				</div>
			</footer>
		</div>
	);
}
