"use client";

import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingNav } from "@/components/landing/LandingNav";
import { CountUp, Reveal, RevealItem, RevealList } from "@/components/landing/Reveal";
import { Wave } from "@/components/landing/Wave";
import { useRouter } from "@/i18n/routing";
import { ArrowRight, ChevronDown, ShieldCheck } from "lucide-react";
import { MotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect } from "react";

const HERO_IMG = "/landing/pond-hut.jpg";

const TEAM = [
	"Jeff Edrick C. Martinez",
	"Karl F. Calimotan",
	"Jay R. C. Castillo",
	"Aime G. Detore",
];

export default function LandingPage() {
	const router = useRouter();
	const t = useTranslations("landing");
	const tBtn = useTranslations("button");

	useEffect(() => {
		document.title = "PakaonAI — Remote Feeding Control for Catfish Farms";
		let metaDesc = document.querySelector('meta[name="description"]');
		if (!metaDesc) {
			metaDesc = document.createElement("meta");
			metaDesc.setAttribute("name", "description");
			document.head.appendChild(metaDesc);
		}
		metaDesc.setAttribute(
			"content",
			"Manage your catfish farm's feeding schedule and cut feed costs from anywhere. Built for owners who can't be on-site every day.",
		);
	}, []);

	return (
		<MotionConfig reducedMotion="user">
			<div
				id="top"
				className="min-h-screen bg-[#F4F7F6] text-[#0A3D62] font-sans selection:bg-[#E85A2A] selection:text-white"
			>
				<LandingNav />

				{/* Hero Section */}
				<section className="relative px-6 py-16 md:py-32 md:px-12 max-w-7xl mx-auto">
					<div className="flex flex-col md:flex-row items-center gap-12">
						<div className="flex-1 text-center md:text-left">
							<div className="absolute top-10 left-1/2 -translate-x-1/2 md:left-20 md:translate-x-0 w-72 h-72 bg-[#0A3D62]/5 rounded-full blur-3xl -z-10" />
							<div className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full text-xs font-semibold tracking-wider uppercase border border-gray-200 shadow-sm mb-6 text-[#E85A2A]">
								<ShieldCheck className="w-4 h-4" /> {t("heroTag")}
							</div>

							<h1 className="text-4xl md:text-6xl font-black tracking-tight leading-tight text-[#0A3D62] mb-6">
								{t("heroTitle1")}
								<span className="text-[#E85A2A] underline decoration-wavy decoration-[#0A3D62]/10">
									{t("heroTitle2")}
								</span>
							</h1>

							<p className="text-lg md:text-xl text-[#3D5568] mb-10 leading-relaxed max-w-2xl mx-auto md:mx-0">
								{t("heroDesc")}
							</p>

							<div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start items-center">
								<button
									type="button"
									onClick={() => router.push("/login")}
									className="w-full sm:w-auto bg-[#E85A2A] text-white font-extrabold text-lg px-8 py-4 rounded-xl shadow-lg hover:bg-[#d04a1f] transition-all transform hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-3 hover:shadow-xl"
								>
									{tBtn("accessControlPanel")} <ArrowRight className="w-5 h-5" />
								</button>
								<div className="text-xs md:text-sm font-mono text-[#3D5568] px-4 py-2 bg-white/60 rounded-lg border border-gray-200">
									{t("heroTarget")}{" "}
									<span className="font-bold text-[#0A3D62]">{t("heroTargetValue")}</span>
								</div>
							</div>
						</div>

						{/* Hero image on the right for desktop */}
						<div className="flex-1 w-full max-w-xl md:max-w-none">
							<div className="relative overflow-hidden rounded-3xl shadow-2xl transform md:rotate-2 hover:rotate-0 transition-transform duration-500">
								<Image
									src={HERO_IMG}
									alt={t("heroImageAlt")}
									width={1600}
									height={1200}
									className="w-full h-64 md:h-[500px] object-cover"
									priority
								/>
								<div className="absolute inset-0 bg-gradient-to-t from-[#0A3D62]/40 to-transparent pointer-events-none" />
							</div>
						</div>
					</div>
				</section>

				{/* The problem */}
				<section
					id="problem"
					className="relative isolate py-28 md:py-40 px-6 md:px-12 scroll-mt-20"
				>
					<div aria-hidden="true" className="absolute inset-0 -z-10 bg-white" />
					<Wave className="top-0 -translate-y-[calc(100%-1px)] text-white" />
					<Wave flip variant="b" className="bottom-0 translate-y-[calc(100%-1px)] text-white" />
					<div className="max-w-6xl mx-auto grid md:grid-cols-[0.9fr_1.1fr] gap-12 md:gap-16">
						<div>
							<h2 className="text-3xl md:text-5xl font-black tracking-tight leading-tight text-[#0A3D62]">
								{t("problemTitle")}
							</h2>
							<p className="mt-10 text-6xl md:text-7xl font-black tracking-tight text-[#E85A2A]">
								<CountUp text={t("problemStat")} />
							</p>
							<p className="mt-2 max-w-xs text-sm text-[#3D5568]">{t("problemStatLabel")}</p>
						</div>
						<RevealList as="ul" className="divide-y divide-gray-200 self-center">
							{[1, 2, 3].map((n) => (
								<RevealItem as="li" key={n} className="py-6 first:pt-0 last:pb-0">
									<h3 className="font-extrabold text-xl text-[#0A3D62]">{t(`problem${n}Title`)}</h3>
									<p className="mt-2 text-base text-[#3D5568] leading-relaxed">
										{t(`problem${n}Body`)}
									</p>
								</RevealItem>
							))}
						</RevealList>
					</div>
				</section>

				<HowItWorks />

				{/* Offline-first */}
				<section
					id="offline"
					className="relative isolate text-white overflow-x-clip py-36 md:py-48 px-6 md:px-12 scroll-mt-20"
				>
					<div
						aria-hidden="true"
						className="absolute inset-0 -z-10 overflow-hidden bg-gradient-to-b from-[#0A3D62] to-[#12588c]"
					>
						<Image
							src="/landing/pond-net.jpg"
							alt=""
							fill
							sizes="100vw"
							className="object-cover opacity-[0.16] mix-blend-luminosity [mask-image:linear-gradient(to_bottom,transparent,black_28%,black_72%,transparent)]"
						/>
					</div>
					<Wave layered className="top-0 -translate-y-[calc(100%-1px)] text-[#0A3D62]" />
					<Wave
						flip
						layered
						variant="b"
						className="bottom-0 translate-y-[calc(100%-1px)] text-[#12588c]"
					/>
					<div className="max-w-6xl mx-auto grid md:grid-cols-[0.9fr_1.1fr] gap-12 md:gap-16">
						<div>
							<h2 className="text-3xl md:text-5xl font-black tracking-tight leading-tight">
								{t("offlineTitle")}
							</h2>
							<p className="mt-4 text-lg text-blue-100">{t("offlineDesc")}</p>
							<h3 className="mt-10 text-xs font-bold uppercase tracking-widest text-blue-200">
								{t("viewsTitle")}
							</h3>
							<ul className="mt-3 space-y-2 text-sm text-blue-50">
								{[1, 2, 3].map((n) => (
									<li key={n}>{t(`views${n}`)}</li>
								))}
							</ul>
						</div>
						<RevealList as="dl" className="grid sm:grid-cols-2 gap-x-8 gap-y-8">
							{[1, 2, 3, 4].map((n) => (
								<RevealItem key={n} from={n % 2 === 1 ? "left" : "right"}>
									<dt className="font-extrabold text-lg">{t(`offline${n}Title`)}</dt>
									<dd className="mt-1.5 text-sm text-blue-100 leading-relaxed">
										{t(`offline${n}Body`)}
									</dd>
								</RevealItem>
							))}
						</RevealList>
					</div>
				</section>

				{/* Hardware */}
				<section
					id="hardware"
					className="py-16 md:py-24 px-6 md:px-12 max-w-6xl mx-auto scroll-mt-20"
				>
					<h2 className="text-3xl md:text-5xl font-black tracking-tight text-[#0A3D62]">
						{t("hardwareTitle")}
					</h2>
					<p className="mt-4 text-lg text-[#3D5568]">{t("hardwareDesc")}</p>
					<div className="mt-10 overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
						<table className="w-full min-w-[32rem] text-left text-sm">
							<thead className="bg-[#F4F7F6] text-[#3D5568]">
								<tr>
									<th scope="col" className="px-5 py-3 font-bold">
										{t("hwColPart")}
									</th>
									<th scope="col" className="px-5 py-3 font-bold">
										{t("hwColRole")}
									</th>
								</tr>
							</thead>
							<RevealList as="tbody" className="divide-y divide-gray-100">
								{[1, 2, 3, 4, 5, 6].map((n) => (
									<RevealItem as="tr" key={n}>
										<th scope="row" className="px-5 py-3.5 font-bold text-[#0A3D62]">
											{t(`hw${n}Part`)}
										</th>
										<td className="px-5 py-3.5 text-[#3D5568]">{t(`hw${n}Role`)}</td>
									</RevealItem>
								))}
							</RevealList>
						</table>
					</div>
				</section>

				{/* Study design + scope */}
				<section id="study" className="relative isolate py-28 md:py-40 px-6 md:px-12 scroll-mt-20">
					<div aria-hidden="true" className="absolute inset-0 -z-10 bg-white" />
					<Wave variant="b" className="top-0 -translate-y-[calc(100%-1px)] text-white" />
					<Wave flip className="bottom-0 translate-y-[calc(100%-1px)] text-white" />
					<div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 md:gap-16">
						<div>
							<h2 className="text-3xl md:text-4xl font-black tracking-tight text-[#0A3D62]">
								{t("studyTitle")}
							</h2>
							<p className="mt-3 text-[#3D5568]">{t("studyDesc")}</p>
							<RevealList as="dl" className="mt-8 divide-y divide-gray-100">
								{[1, 2, 3, 4].map((n) => (
									<RevealItem key={n} className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr] sm:gap-4">
										<dt className="text-sm font-extrabold text-[#0A3D62]">{t(`study${n}Label`)}</dt>
										<dd className="text-sm text-[#3D5568] leading-relaxed">
											{t(`study${n}Value`)}
										</dd>
									</RevealItem>
								))}
							</RevealList>
							<p className="mt-4 border-l-4 border-[#E85A2A] pl-4 text-sm text-[#3D5568]">
								{t("studyResults")}
							</p>
						</div>
						<div>
							<h2 className="text-3xl md:text-4xl font-black tracking-tight text-[#0A3D62]">
								{t("scopeTitle")}
							</h2>
							<RevealList as="ul" className="mt-6 space-y-4">
								{[1, 2, 3, 4].map((n) => (
									<RevealItem as="li" key={n} className="flex gap-3 text-[#3D5568] leading-relaxed">
										<span aria-hidden="true" className="mt-2.5 h-0.5 w-4 shrink-0 bg-[#E85A2A]" />
										{t(`scope${n}`)}
									</RevealItem>
								))}
							</RevealList>
						</div>
					</div>
					<figure className="max-w-6xl mx-auto mt-16 md:mt-24">
						<RevealList className="grid gap-4 sm:grid-cols-3">
							{(
								[
									["/landing/pond-hut.jpg", "photoAlt1"],
									["/landing/pond-net.jpg", "photoAlt2"],
									["/landing/pond-channel.jpg", "photoAlt3"],
								] as const
							).map(([src, alt]) => (
								<RevealItem
									key={src}
									className="relative aspect-[4/3] overflow-hidden rounded-3xl shadow-lg"
								>
									<Image
										src={src}
										alt={t(alt)}
										fill
										sizes="(min-width: 1152px) 360px, (min-width: 640px) 33vw, 100vw"
										className="object-cover transition-transform duration-700 hover:scale-105"
									/>
								</RevealItem>
							))}
						</RevealList>
						<figcaption className="mt-4 text-xs text-[#3D5568]">{t("photoCaption")}</figcaption>
					</figure>
				</section>

				{/* FAQ */}
				<section id="faq" className="py-16 md:py-24 px-6 md:px-12 max-w-3xl mx-auto scroll-mt-20">
					<h2 className="text-3xl md:text-4xl font-black tracking-tight text-[#0A3D62]">
						{t("faqTitle")}
					</h2>
					<RevealList className="mt-8 divide-y divide-gray-200 border-y border-gray-200">
						{[1, 2, 3, 4, 5].map((n) => (
							<RevealItem as="details" key={n} className="group">
								<summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-bold text-lg text-[#0A3D62] focus-visible:outline-2 focus-visible:outline-[#E85A2A] [&::-webkit-details-marker]:hidden">
									{t(`faq${n}q`)}
									<ChevronDown
										className="h-5 w-5 shrink-0 text-[#E85A2A] transition-transform group-open:rotate-180"
										aria-hidden="true"
									/>
								</summary>
								<p className="pb-5 text-[#3D5568] leading-relaxed">{t(`faq${n}a`)}</p>
							</RevealItem>
						))}
					</RevealList>
				</section>

				{/* Closing CTA */}
				<section className="relative isolate py-28 md:py-36 px-6 text-center">
					<div aria-hidden="true" className="absolute inset-0 -z-10 bg-white" />
					<Wave className="top-0 -translate-y-[calc(100%-1px)] text-white" />
					<Reveal className="max-w-3xl mx-auto">
						<h2 className="text-3xl md:text-4xl font-black tracking-tight text-[#0A3D62] mb-4">
							{t("ctaTitle")}
						</h2>
						<p className="text-[#3D5568] text-base md:text-lg mb-8 max-w-xl mx-auto">
							{t("ctaDesc")}
						</p>
						<button
							type="button"
							onClick={() => router.push("/login")}
							className="bg-[#E85A2A] text-white font-extrabold text-lg px-8 py-4 rounded-xl shadow-lg hover:bg-[#d04a1f] transition-all transform hover:-translate-y-1 active:scale-95 inline-flex items-center gap-3"
						>
							{tBtn("login")} <ArrowRight className="w-5 h-5" />
						</button>
					</Reveal>
				</section>

				{/* Footer */}
				<footer className="relative isolate text-white text-xs md:text-sm">
					<div aria-hidden="true" className="absolute inset-0 -z-10 bg-[#0A3D62]" />
					<Wave
						variant="b"
						layered
						className="top-0 -translate-y-[calc(100%-1px)] text-[#0A3D62]"
					/>
					<div className="max-w-6xl mx-auto grid md:grid-cols-[1.2fr_1fr] gap-10 px-6 pt-16 pb-12">
						<div>
							<h2 className="font-extrabold text-base">{t("teamTitle")}</h2>
							<p className="mt-2 max-w-md text-blue-100 leading-relaxed">{t("teamDesc")}</p>
							<ul className="mt-4 grid sm:grid-cols-2 gap-1">
								{TEAM.map((name) => (
									<li key={name}>{name}</li>
								))}
							</ul>
						</div>
						<div>
							<h2 className="font-extrabold text-base">{t("paperLabel")}</h2>
							<p className="mt-2 text-blue-100 leading-relaxed">{t("paperTitle")}</p>
						</div>
					</div>
					<div className="border-t border-white/10">
						<div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 px-6 py-5">
							<div className="flex items-center gap-2.5">
								<OptiFeedLogo size={28} variant="white" />
								<Image
									src="/pakaonai-logo-kit/png/pakaonai-wordmark-color.png"
									alt="PakaonAI"
									width={90}
									height={20}
									className="h-5 w-auto object-contain brightness-0 invert"
								/>
								<span className="text-gray-400">{t("footerSubtitle")}</span>
							</div>
							<div className="text-gray-300">{t("footerCopyright")}</div>
							<a
								href="https://commons.wikimedia.org/wiki/User:Judgefloro"
								target="_blank"
								rel="noopener noreferrer"
								className="text-gray-400 hover:text-white underline-offset-2 hover:underline"
							>
								{t("photoCredit")}
							</a>
							<button
								type="button"
								onClick={() => router.push("/login")}
								className="text-gray-300 hover:text-white cursor-pointer"
							>
								{tBtn("login")}
							</button>
						</div>
					</div>
				</footer>
			</div>
		</MotionConfig>
	);
}
