"use client";

import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { useTheme } from "@/components/theme-provider";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { loginWithPassword } from "@/lib/actions/auth";
import { DPO_EMAIL, LEGAL_PUBLISHED } from "@/lib/legal/config";
import { clearOfflineData } from "@/lib/offline/db";
import { clearDashboardSnapshot } from "@/lib/pwa/snapshot";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
	AlertCircle,
	ArrowLeft,
	ClipboardList,
	Clock3,
	Eye,
	EyeOff,
	Loader2,
	MapPin,
	Moon,
	ShieldCheck,
	Sun,
	Waves,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";

const FARM_ID_STORAGE_KEY = "optifeed:last-farm-id";

/**
 * Compact locale toggle in the login footer. Language names are exonyms and
 * stay untranslated; Tagalog is marked Beta until the machine-draft review
 * queue in `messages/tl.draft-keys.json` is cleared (#457).
 */
const LOCALE_OPTIONS = [
	{ code: "en", label: "EN", title: "English" },
	{ code: "hil", label: "HIL", title: "Hiligaynon" },
	{ code: "tl", label: "TL", title: "Tagalog (Beta)" },
] as const;

const inputBase =
	"h-11 w-full rounded-lg border bg-white px-3.5 text-sm text-[#0A2E47] shadow-[0_1px_2px_rgba(10,46,71,0.03)] outline-none transition-colors placeholder:text-slate-400 hover:border-[#BCC9C4] focus:border-[#E85A2A] focus:ring-4 focus:ring-[#E85A2A]/15 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-slate-500 dark:hover:border-white/20 dark:focus:border-[#FF8A5C] dark:focus:ring-[#FF8A5C]/15";

const inputBorder = "border-[#D6DFDB] dark:border-white/10";
const inputError =
	"border-[#D92D20] focus:border-[#D92D20] focus:ring-red-500/15 dark:border-red-500/50";

function readStoredFarmId() {
	try {
		return window.localStorage.getItem(FARM_ID_STORAGE_KEY);
	} catch {
		return null;
	}
}

export default function LoginPage() {
	const router = useRouter();
	const pathname = usePathname();
	const locale = useLocale();
	const t = useTranslations("login");
	const tBtn = useTranslations("button");
	const tLegal = useTranslations("legal");
	const { resolvedTheme, setTheme } = useTheme();

	const [farmId, setFarmId] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [rememberFarmId, setRememberFarmId] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<{ farmId?: string; password?: string }>({});
	const [isPending, startTransition] = useTransition();
	const [isLocalePending, startLocaleTransition] = useTransition();
	const farmIdRef = useRef<HTMLInputElement>(null);
	const passwordRef = useRef<HTMLInputElement>(null);

	// The proxy no longer redirects authenticated users away from /login (its
	// optimistic cookie check cannot distinguish a valid session from an
	// expired one without a network refresh, which raced and looped). A single
	// client-side getUser() is safe here — one call, no parallel middleware
	// invocations — so already-logged-in visitors still land on the dashboard.
	useEffect(() => {
		clearDashboardSnapshot();
		void clearOfflineData();
		const supabase = createClient();
		supabase.auth.getUser().then(({ data: { user } }) => {
			if (user) router.replace("/dashboard");
		});

		const storedFarmId = readStoredFarmId();
		if (storedFarmId) {
			setFarmId(storedFarmId);
			setRememberFarmId(true);
		}
		// Avoid pulling up the mobile keyboard before the page has settled.
		if (window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches) {
			farmIdRef.current?.focus({ preventScroll: true });
		}
	}, [router]);

	const clearServerError = () => {
		if (error) setError(null);
	};

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		setError(null);

		const nextErrors: typeof fieldErrors = {};
		if (!farmId.trim()) nextErrors.farmId = t("errorEmpty");
		if (!password) nextErrors.password = t("errorPasswordRequired");
		setFieldErrors(nextErrors);

		if (nextErrors.farmId) {
			farmIdRef.current?.focus();
			return;
		}
		if (nextErrors.password) {
			passwordRef.current?.focus();
			return;
		}

		try {
			if (rememberFarmId) {
				window.localStorage.setItem(FARM_ID_STORAGE_KEY, farmId.trim());
			} else {
				window.localStorage.removeItem(FARM_ID_STORAGE_KEY);
			}
		} catch {
			// Storage can be unavailable in private or sandboxed contexts.
		}

		startTransition(async () => {
			const result = await loginWithPassword(farmId, password);
			if (result?.error === "locked") {
				const minutes = result.secondsRemaining ? Math.ceil(result.secondsRemaining / 60) : 15;
				setError(t("errorLocked", { minutes }));
			} else if (result?.error === "rate_limited") {
				setError(t("errorRateLimited"));
			} else if (result?.error === "service") {
				setError(t("errorService"));
			} else if (result?.error) {
				setError(t("errorInvalid"));
				setPassword("");
				passwordRef.current?.focus();
			}
		});
	};

	const switchLocale = (nextLocale: (typeof LOCALE_OPTIONS)[number]["code"]) => {
		if (nextLocale === locale) return;
		startLocaleTransition(() => {
			router.replace({ pathname }, { locale: nextLocale });
		});
	};

	const features = [
		{ icon: Clock3, title: t("brandFeature1Title"), body: t("brandFeature1Body") },
		{ icon: Waves, title: t("brandFeature2Title"), body: t("brandFeature2Body") },
		{ icon: ClipboardList, title: t("brandFeature3Title"), body: t("brandFeature3Body") },
	];

	return (
		<div className="min-h-[100dvh] bg-[#F6F8F7] font-sans text-[#0A2E47] [color-scheme:light] selection:bg-[#E85A2A]/20 selection:text-[#0A2E47] lg:grid lg:grid-cols-[minmax(0,44%)_minmax(0,1fr)] dark:bg-[#0B1117] dark:text-white dark:[color-scheme:dark]">
			{/* Brand panel */}
			<aside className="relative hidden overflow-hidden bg-[#0A3D62] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-16 xl:py-12">
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_75%_70%_at_70%_15%,black,transparent)]"
				/>
				<div
					aria-hidden="true"
					className="pointer-events-none absolute -right-44 -bottom-44 size-[34rem] rounded-full border border-white/[0.07]"
				/>
				<div
					aria-hidden="true"
					className="pointer-events-none absolute -right-28 -bottom-28 size-[22rem] rounded-full border border-white/[0.07]"
				/>
				<div
					aria-hidden="true"
					className="pointer-events-none absolute -right-12 -bottom-12 size-[10rem] rounded-full border border-white/[0.07]"
				/>

				<div className="relative flex items-center gap-2.5">
					<OptiFeedLogo size={30} variant="ondark" />
					<Image
						src="/pakaonai-logo-kit/png/pakaonai-wordmark-color.png"
						alt="PakaonAI"
						width={120}
						height={28}
						priority
						className="h-5 w-auto object-contain brightness-0 invert"
					/>
				</div>

				<div className="relative max-w-[29rem]">
					<p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
						<span className="size-1.5 rounded-full bg-[#FF8A5C]" />
						{t("brandEyebrow")}
					</p>
					<p className="mt-5 text-[2.6rem] font-semibold leading-[1.06] tracking-[-0.035em] text-white xl:text-[2.9rem]">
						{t("brandHeadline")}
					</p>
					<p className="mt-4 max-w-[26rem] text-[15px] leading-6 text-white/65">{t("brandBody")}</p>

					<ul className="mt-10 border-t border-white/10">
						{features.map(({ icon: Icon, title, body }) => (
							<li key={title} className="flex gap-3.5 border-b border-white/10 py-4">
								<span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white/75 ring-1 ring-white/10 ring-inset">
									<Icon className="size-[18px]" strokeWidth={1.75} />
								</span>
								<div>
									<p className="text-[13px] font-semibold text-white">{title}</p>
									<p className="mt-1 text-[12.5px] leading-5 text-white/65">{body}</p>
								</div>
							</li>
						))}
					</ul>
				</div>

				<div className="relative flex items-center justify-between gap-6 border-t border-white/10 pt-5 text-[11px] text-white/55">
					<span className="flex items-center gap-2">
						<MapPin className="size-3.5" aria-hidden="true" />
						{t("statusLabel")}
					</span>
					<span className="font-mono tracking-wide">{t("statusValue")}</span>
				</div>
			</aside>

			{/* Sign-in panel */}
			<main className="flex min-h-[100dvh] flex-col lg:min-h-0">
				<header className="flex items-center justify-between px-5 py-5 sm:px-8 lg:px-10 lg:py-7">
					<div className="flex items-center gap-2.5 lg:hidden">
						<OptiFeedLogo size={30} variant="color-light" />
						<Image
							src="/pakaonai-logo-kit/png/pakaonai-wordmark-color.png"
							alt="PakaonAI"
							width={120}
							height={28}
							priority
							className="h-5 w-auto object-contain"
						/>
					</div>

					<Link
						href="/"
						className="hidden items-center gap-1.5 rounded-md text-[13px] font-medium text-slate-500 transition-colors hover:text-[#0A3D62] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 focus-visible:ring-offset-2 lg:inline-flex dark:text-slate-400 dark:focus-visible:ring-offset-[#0B1117] dark:hover:text-white"
					>
						<ArrowLeft className="size-4" aria-hidden="true" />
						{tBtn("backToHome")}
					</Link>

					<button
						type="button"
						onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
						aria-label={resolvedTheme === "dark" ? t("themeToLight") : t("themeToDark")}
						className="flex size-9 items-center justify-center rounded-lg border border-[#DCE5E1] bg-white text-slate-500 transition-colors hover:border-[#C4D1CC] hover:text-[#0A3D62] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-white"
					>
						{resolvedTheme === "dark" ? (
							<Sun className="size-4" aria-hidden="true" />
						) : (
							<Moon className="size-4" aria-hidden="true" />
						)}
					</button>
				</header>

				<div className="flex flex-1 items-center justify-center px-5 pt-2 pb-10 sm:px-8 lg:px-10 lg:py-12">
					<section aria-labelledby="login-heading" className="w-full max-w-[23.5rem]">
						<p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#E85A2A] dark:text-[#FF8A5C]">
							{t("eyebrow")}
						</p>
						<h1
							id="login-heading"
							className="mt-3 text-[27px] font-semibold leading-[1.15] tracking-[-0.03em] text-[#0A2E47] dark:text-white"
						>
							{t("heading")}
						</h1>
						<p className="mt-2 text-[13.5px] leading-5 text-slate-500 dark:text-slate-400">
							{t("subheading")}
						</p>

						<form noValidate onSubmit={handleSubmit} className="mt-8 space-y-5">
							<div>
								<label
									htmlFor="farmId"
									className="mb-1.5 block text-[13px] font-medium text-[#0A2E47] dark:text-slate-200"
								>
									{t("farmIdLabel")}
								</label>
								<input
									ref={farmIdRef}
									id="farmId"
									name="farmId"
									type="text"
									autoComplete="username"
									autoCapitalize="none"
									autoCorrect="off"
									spellCheck={false}
									enterKeyHint="next"
									value={farmId}
									onChange={(e) => {
										setFarmId(e.target.value);
										if (fieldErrors.farmId) {
											setFieldErrors((prev) => ({ ...prev, farmId: undefined }));
										}
										clearServerError();
									}}
									aria-invalid={Boolean(fieldErrors.farmId)}
									aria-describedby={fieldErrors.farmId ? "farmId-error" : undefined}
									className={cn(inputBase, fieldErrors.farmId ? inputError : inputBorder)}
									placeholder={t("farmIdPlaceholder")}
								/>
								{fieldErrors.farmId && (
									<p id="farmId-error" className="mt-1.5 text-xs text-[#D92D20] dark:text-red-400">
										{fieldErrors.farmId}
									</p>
								)}
							</div>

							<div>
								<div className="mb-1.5 flex items-baseline justify-between gap-3">
									<label
										htmlFor="password"
										className="text-[13px] font-medium text-[#0A2E47] dark:text-slate-200"
									>
										{t("passwordLabel")}
									</label>
									<span className="text-[11px] text-slate-500 dark:text-slate-400">
										{t("passwordHint")}
									</span>
								</div>
								<div className="relative">
									<input
										ref={passwordRef}
										id="password"
										name="password"
										type={showPassword ? "text" : "password"}
										autoComplete="current-password"
										autoCapitalize="none"
										autoCorrect="off"
										spellCheck={false}
										maxLength={72}
										enterKeyHint="go"
										value={password}
										onChange={(e) => {
											setPassword(e.target.value);
											if (fieldErrors.password) {
												setFieldErrors((prev) => ({ ...prev, password: undefined }));
											}
											clearServerError();
										}}
										aria-invalid={Boolean(fieldErrors.password)}
										aria-describedby={
											fieldErrors.password ? "password-help password-error" : "password-help"
										}
										className={cn(
											inputBase,
											"pr-12 text-[15px]",
											fieldErrors.password ? inputError : inputBorder,
										)}
									/>
									<button
										type="button"
										onClick={() => setShowPassword((visible) => !visible)}
										aria-label={showPassword ? t("hidePassword") : t("showPassword")}
										aria-pressed={showPassword}
										className="absolute inset-y-0 right-1 my-auto flex size-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0A3D62] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
									>
										{showPassword ? (
											<EyeOff className="size-[17px]" aria-hidden="true" />
										) : (
											<Eye className="size-[17px]" aria-hidden="true" />
										)}
									</button>
								</div>
								<p id="password-help" className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
									{t("passwordDesc")}
								</p>
								{fieldErrors.password && (
									<p id="password-error" className="mt-1 text-xs text-[#D92D20] dark:text-red-400">
										{fieldErrors.password}
									</p>
								)}
								<p className="mt-2 text-right">
									<Link
										href="/forgot-password"
										className="text-[12.5px] font-medium text-[#0A3D62] underline decoration-[#0A3D62]/25 underline-offset-2 transition-colors hover:text-[#E85A2A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 dark:text-[#8EC5EF] dark:decoration-[#8EC5EF]/25 dark:hover:text-[#FF8A5C]"
									>
										{t("forgotPassword")}
									</Link>
								</p>
							</div>

							{error && (
								<div
									role="alert"
									className="flex gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[12.5px] leading-5 text-red-800 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200"
								>
									<AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
									<p>{error}</p>
								</div>
							)}

							<label className="flex cursor-pointer items-start gap-2.5 select-none">
								<input
									type="checkbox"
									checked={rememberFarmId}
									onChange={(e) => setRememberFarmId(e.target.checked)}
									className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-[#C9D4D0] accent-[#0A3D62] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 focus-visible:ring-offset-2 dark:border-white/20 dark:accent-[#FF8A5C] dark:focus-visible:ring-offset-[#0B1117]"
								/>
								<span className="text-[12.5px] leading-5 text-slate-500 dark:text-slate-400">
									{t("rememberFarmId")}
								</span>
							</label>

							<button
								type="submit"
								disabled={isPending}
								className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#E85A2A] px-4 text-[14.5px] font-semibold text-white shadow-[0_1px_2px_rgba(10,46,71,0.15)] transition-colors hover:bg-[#D24E22] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#E85A2A]/25 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-[#E85A2A] dark:hover:bg-[#F16B3D]"
							>
								{isPending ? (
									<>
										<Loader2 className="size-4 animate-spin" aria-hidden="true" />
										{t("submitting")}
									</>
								) : (
									t("submit")
								)}
							</button>
						</form>

						{LEGAL_PUBLISHED ? (
							<p className="mt-4 text-center text-[11.5px] leading-5 text-slate-500 dark:text-slate-400">
								{tLegal("agreePrefix")}{" "}
								<Link
									href="/privacy"
									className="font-medium text-[#0A3D62] underline decoration-[#0A3D62]/25 underline-offset-2 hover:text-[#E85A2A] dark:text-[#8EC5EF] dark:hover:text-[#FF8A5C]"
								>
									{tLegal("privacy")}
								</Link>{" "}
								{tLegal("and")}{" "}
								<Link
									href="/terms"
									className="font-medium text-[#0A3D62] underline decoration-[#0A3D62]/25 underline-offset-2 hover:text-[#E85A2A] dark:text-[#8EC5EF] dark:hover:text-[#FF8A5C]"
								>
									{tLegal("terms")}
								</Link>
								.
							</p>
						) : null}

						<p className="mt-5 flex items-start gap-2 text-[11.5px] leading-4 text-slate-500 dark:text-slate-400">
							<ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
							{t("securityNote")}
						</p>
					</section>
				</div>

				<footer className="border-t border-[#E1E8E5] px-5 py-5 text-[11.5px] text-slate-500 sm:px-8 lg:px-10 dark:border-white/[0.06] dark:text-slate-500">
					<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
						<Link
							href="/"
							className="inline-flex items-center gap-1.5 rounded-md font-medium transition-colors hover:text-[#0A3D62] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 lg:hidden dark:hover:text-white"
						>
							<ArrowLeft className="size-3.5" aria-hidden="true" />
							{tBtn("backToHome")}
						</Link>

						<p className="order-last w-full sm:w-auto lg:order-none">{t("footer")}</p>

						{LEGAL_PUBLISHED ? (
							<nav
								aria-label={tLegal("legalNav")}
								className="flex flex-wrap items-center gap-x-4 gap-y-1"
							>
								<Link
									href="/privacy"
									className="font-medium hover:text-[#0A3D62] dark:hover:text-white"
								>
									{tLegal("privacy")}
								</Link>
								<Link
									href="/terms"
									className="font-medium hover:text-[#0A3D62] dark:hover:text-white"
								>
									{tLegal("terms")}
								</Link>
								<a
									href={`mailto:${DPO_EMAIL}`}
									className="font-medium hover:text-[#0A3D62] dark:hover:text-white"
								>
									{tLegal("privacyContact")}
								</a>
							</nav>
						) : null}

						<fieldset className="m-0 ml-auto flex min-w-0 items-center rounded-md border border-[#DCE5E1] p-0.5 dark:border-white/10">
							<legend className="sr-only">{t("languageLabel")}</legend>
							{LOCALE_OPTIONS.map((option) => (
								<button
									key={option.code}
									type="button"
									onClick={() => switchLocale(option.code)}
									disabled={option.code === locale || isLocalePending}
									aria-current={option.code === locale ? "true" : undefined}
									title={option.title}
									className={cn(
										"rounded px-2 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A]/40 disabled:cursor-default",
										option.code === locale
											? "bg-[#0A3D62] text-white dark:bg-white/15"
											: "text-slate-500 hover:text-[#0A3D62] dark:text-slate-400 dark:hover:text-white",
									)}
								>
									{option.label}
								</button>
							))}
						</fieldset>
					</div>
				</footer>
			</main>
		</div>
	);
}
