"use client";

import { ImageWithFallback } from "@/components/ImageWithFallback";
import { OptiFeedLogo } from "@/components/OptiFeedLogo";
import { useRouter } from "@/i18n/routing";
import { ArrowRight, ChevronDown, ChevronUp, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

const HERO_IMG =
	"https://images.unsplash.com/photo-1541441056316-443fff347c40?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1600";

const FAQS = [
	{
		q: "How do I monitor my fish farm remotely?",
		a: "OptiFeed connects directly with your pond's ESP32 automated feeder controller. As long as your feeder has an active link to the local network, you can monitor schedule times, connection state, and exactly how many grams of feed were dispensed from any phone, tablet, or desktop in real-time.",
	},
	{
		q: "What is Feed Conversion Ratio (FCR) and why does it matter?",
		a: "FCR is the measure of how efficiently your African Catfish are turning feed into body weight (Biomass). By measuring a physical sample of fish and logging it in the app, OptiFeed calculates your precise FCR trend. Lowering FCR from 1.5 to 1.1 can save up to 25% in overall feed costs.",
	},
	{
		q: "Can I check on my farm without visiting?",
		a: "Yes! OptiFeed was designed specifically for remote aquaculture management for absentee owners. You can verify that your staff completed feeding runs, view live device connectivity status, and audit the exact volumes dispensed on a reverse-chronological timeline.",
	},
	{
		q: "Does this work with hired farm staff?",
		a: "Absolutely. Rather than relying on staff to guess feeding weights, OptiFeed serves as a centralized source of truth. Your hired staff simply performs standard manual biomass sampling and logs it. The app instantly sets the precise feed volume for the ESP32 automatic dispenser, eliminating manual feeding errors.",
	},
	{
		q: "What hardware is required for this system?",
		a: "OptiFeed works in perfect harmony with a single, highly durable ESP32-powered automatic feeder. There are no expensive cameras, vision arrays, or water sensors to clean or maintain — the system uses smart weight calculations triggered by manual sampling to run the dispenser automatically.",
	},
];

export default function LandingPage() {
	const router = useRouter();
	const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

	useEffect(() => {
		document.title = "OptiFeed — Remote Feeding Control for Catfish Farms";
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

	const toggleFaq = (i: number) => setOpenFaqIndex(openFaqIndex === i ? null : i);

	return (
		<div className="min-h-screen bg-[#F4F7F6] text-[#0A3D62] font-sans selection:bg-[#E85A2A] selection:text-white">
			{/* SEO meta note banner */}
			<div className="sticky top-0 z-[60] bg-[#0A3D62] text-white py-1.5 px-4 text-center text-[10px] md:text-xs font-mono tracking-wider shadow-sm">
				SEO LANDING PAGE ACTIVE • META TARGET: aquaculture management for absentee owners
			</div>

			{/* Global Header */}
			<header className="sticky top-8 md:top-7 z-50 bg-white/95 backdrop-blur-md border-b border-gray-200 py-4 px-6 md:px-12 flex justify-between items-center shadow-sm">
				<div className="flex items-center gap-3">
					<OptiFeedLogo size={32} className="shadow-md rounded-lg" />
					<span className="font-extrabold text-xl tracking-tight text-[#0A3D62]">
						Opti<span className="text-[#E85A2A]">Feed</span>
					</span>
				</div>
				<button
					type="button"
					onClick={() => router.push("/login")}
					className="bg-[#E85A2A] text-white font-bold text-sm md:text-base px-5 py-2.5 rounded-full hover:bg-[#d04a1f] transition-all transform hover:-translate-y-0.5 active:scale-95 shadow-md flex items-center gap-2 hover:shadow-lg"
				>
					Log In <ArrowRight className="w-4 h-4" />
				</button>
			</header>

			{/* Hero Section */}
			<section className="relative px-6 py-16 md:py-32 md:px-12 max-w-7xl mx-auto">
				<div className="flex flex-col md:flex-row items-center gap-12">
					<div className="flex-1 text-center md:text-left">
						<div className="absolute top-10 left-1/2 -translate-x-1/2 md:left-20 md:translate-x-0 w-72 h-72 bg-[#0A3D62]/5 rounded-full blur-3xl -z-10" />
						<div className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full text-xs font-semibold tracking-wider uppercase border border-gray-200 shadow-sm mb-6 text-[#E85A2A]">
							<ShieldCheck className="w-4 h-4" /> Absolute Oversight for Catfish Farm Owners
						</div>

						<h1 className="text-4xl md:text-6xl font-black tracking-tight leading-tight text-[#0A3D62] mb-6">
							Know your pond is fed,{" "}
							<span className="text-[#E85A2A] underline decoration-wavy decoration-[#0A3D62]/10">
								even when you're not there
							</span>
							.
						</h1>

						<p className="text-lg md:text-xl text-[#3D5568] mb-10 leading-relaxed max-w-2xl mx-auto md:mx-0">
							The ultimate catfish feed management app built for remote fish farm monitoring in the
							Philippines. Protect your margins, eliminate staff feed theft or neglect, and optimize
							your Feed Conversion Ratio (FCR).
						</p>

						<div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start items-center">
							<button
								type="button"
								onClick={() => router.push("/login")}
								className="w-full sm:w-auto bg-[#E85A2A] text-white font-extrabold text-lg px-8 py-4 rounded-xl shadow-lg hover:bg-[#d04a1f] transition-all transform hover:-translate-y-1 active:scale-95 flex items-center justify-center gap-3 hover:shadow-xl"
							>
								Access Your Control Panel <ArrowRight className="w-5 h-5" />
							</button>
							<div className="text-xs md:text-sm font-mono text-[#3D5568] px-4 py-2 bg-white/60 rounded-lg border border-gray-200">
								Current Target:{" "}
								<span className="font-bold text-[#0A3D62]">Western Visayas Farms</span>
							</div>
						</div>
					</div>

					{/* Hero image on the right for desktop */}
					<div className="flex-1 w-full max-w-xl md:max-w-none">
						<div className="relative overflow-hidden rounded-3xl shadow-2xl transform md:rotate-2 hover:rotate-0 transition-transform duration-500">
							<ImageWithFallback
								src={HERO_IMG}
								alt="African catfish in an aquaculture pond"
								className="w-full h-64 md:h-[500px] object-cover"
							/>
							<div className="absolute inset-0 bg-gradient-to-t from-[#0A3D62]/40 to-transparent pointer-events-none" />
						</div>
					</div>
				</div>
			</section>

			{/* The real cost of not knowing */}
			<section className="bg-white border-y border-gray-200 py-16 px-6 md:px-12">
				<div className="max-w-5xl mx-auto">
					<div className="text-center max-w-3xl mx-auto mb-12">
						<h2 className="text-2xl md:text-4xl font-extrabold tracking-tight mb-4 text-[#0A3D62]">
							The Hidden Bleed: Why Remote Feeding Fails
						</h2>
						<p className="text-[#3D5568] text-base md:text-lg">
							Remote catfish farm owners in the Philippines face a serious trust-and-visibility gap.
							When you cannot physically step onto the pond dike every day, you are exposed to
							costly operational leaks.
						</p>
					</div>

					<div className="grid md:grid-cols-3 gap-8">
						{[
							{
								icon: "₱",
								title: "Feed Waste & Theft",
								body: "Feed represents up to 70% of total farm costs. Guesswork overfeeding wastes tens of thousands of pesos in bags of pellets, while unchecked staff can quietly resell feed bags off-site.",
							},
							{
								icon: "✕",
								title: "Unreported Staff Neglect",
								body: "Hired staff get busy, forget scheduled times, or skip hot afternoon feeding cycles entirely. Without an immutable digital log, missed feedings are hidden until harvest day reveals stunted weights.",
							},
							{
								icon: "↓",
								title: "Stunted FCR Levels",
								body: "Over-dispensing feed doesn't grow catfish faster; it decays the pond bottom, triggers toxic ammonia spikes, and raises your FCR. This directly destroys your net profit margins.",
							},
						].map(({ icon, title, body }) => (
							<div key={title} className="p-6 bg-[#F4F7F6] rounded-xl border border-gray-200">
								<div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center text-red-700 font-bold text-lg mb-4">
									{icon}
								</div>
								<h3 className="font-bold text-lg mb-2 text-[#0A3D62]">{title}</h3>
								<p className="text-sm text-[#3D5568] leading-relaxed">{body}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* How OptiFeed fixes it */}
			<section className="py-16 px-6 md:px-12 max-w-7xl mx-auto">
				<div className="text-center max-w-3xl mx-auto mb-12">
					<h2 className="text-2xl md:text-4xl font-extrabold tracking-tight mb-4 text-[#0A3D62]">
						Frictionless Oversight: How It Works
					</h2>
					<p className="text-[#3D5568] text-base md:text-lg">
						No complex vision systems or cameras that fail in muddy waters. OptiFeed uses physical
						ground truth coupled with robust automated execution.
					</p>
				</div>

				<div className="grid md:grid-cols-3 gap-8">
					{[
						{
							step: "Step 1",
							accent: "#E85A2A",
							bg: "bg-orange-50 text-[#E85A2A]",
							badge: "bg-orange-50 text-[#E85A2A]",
							tag: "Keeps physical weight accurate",
							title: "Weigh and Measure",
							body: "Your staff pulls a random net sample of fish on-site, counts them, and logs their average weight and length directly into the browser.",
						},
						{
							step: "Step 2",
							accent: "#0A3D62",
							bg: "bg-blue-50 text-[#0A3D62]",
							badge: "bg-blue-50 text-[#0A3D62]",
							tag: "FCR optimization algorithm",
							title: "Automatic Calculation",
							body: "OptiFeed instantly recalculates the optimal feeding quantity for upcoming scheduled feedings. It shifts the feed load precisely to prevent waste.",
						},
						{
							step: "Step 3",
							accent: "#1E7B34",
							bg: "bg-green-50 text-green-600",
							badge: "bg-green-50 text-green-700",
							tag: "Full feed history logged remotely",
							title: "Synced Delivery",
							body: "The automated ESP32 feeder receives the updated schedule weights instantly. Feed is dispensed exactly on schedule, and you track the live logs remotely.",
						},
					].map(({ step, accent, bg, badge, tag, title, body }) => (
						<div
							key={step}
							className="bg-white p-8 rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden hover:shadow-md transition-all"
						>
							<div className="absolute top-0 left-0 w-2 h-full" style={{ background: accent }} />
							<div className={`text-xs font-bold mb-2 uppercase tracking-widest font-mono ${bg}`}>
								{step}
							</div>
							<h3 className="font-bold text-xl mb-3 text-[#0A3D62]">{title}</h3>
							<p className="text-sm text-[#3D5568] leading-relaxed mb-4">{body}</p>
							<div className={`text-xs font-mono px-2.5 py-1.5 rounded inline-block ${badge}`}>
								{tag}
							</div>
						</div>
					))}
				</div>
			</section>

			{/* Built for remote ownership */}
			<section className="bg-gradient-to-br from-[#0A3D62] to-[#12588c] text-white py-16 px-6 md:px-12">
				<div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-12">
					<div className="flex-1">
						<div className="bg-white/10 text-[#E85A2A] font-extrabold text-xs tracking-wider uppercase px-3 py-1 rounded-full inline-block mb-4">
							DESIGNED FOR ABSENTEE OWNERS
						</div>
						<h2 className="text-3xl md:text-4xl font-black tracking-tight mb-6">
							Full control, even 500 kilometers away.
						</h2>
						<p className="text-blue-100 text-base md:text-lg mb-8 leading-relaxed">
							Whether you are working from a condo in Manila, traveling abroad, or managing other
							business interests, OptiFeed gives you a clear window into your pond operations.
						</p>
						<ul className="space-y-4">
							{[
								[
									"ESP32 Live Heartbeat Connection:",
									"Know in 1 second if your farm network goes offline.",
								],
								[
									"Staff Audit Trails:",
									"Every biomass entry and feeding trigger has an immutable digital timestamp. No hidden adjustments.",
								],
								[
									"Visual Trend Dashboard:",
									"Interactive sparklines display current feed efficiency so you can step in before costs escalate.",
								],
							].map(([strong, rest]) => (
								<li key={strong as string} className="flex gap-3">
									<div className="w-6 h-6 rounded-full bg-[#E85A2A]/20 text-[#E85A2A] flex items-center justify-center font-bold text-sm shrink-0">
										✓
									</div>
									<div>
										<strong className="text-white">{strong}</strong>{" "}
										<span className="text-blue-100">{rest}</span>
									</div>
								</li>
							))}
						</ul>
					</div>

					{/* Phone mockup */}
					<div className="w-full md:w-[380px] bg-white rounded-3xl p-6 text-[#0A3D62] shadow-2xl border-4 border-gray-800 relative shrink-0">
						<div className="absolute top-3 left-1/2 -translate-x-1/2 w-28 h-5 bg-gray-800 rounded-full" />
						<div className="flex justify-between items-center mb-6 pt-2">
							<span className="font-extrabold text-sm tracking-tight">OptiFeed Active State</span>
							<div className="flex items-center gap-1.5 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
								<span className="w-2.5 h-2.5 rounded-full bg-green-600 animate-pulse" />
								<span className="text-[10px] text-green-700 font-bold">ESP32 Connected</span>
							</div>
						</div>
						<div className="bg-[#F4F7F6] p-4 rounded-xl mb-4 border border-gray-200 text-center">
							<span className="text-[10px] uppercase font-bold tracking-widest text-[#3D5568]">
								Next Scheduled Feeding
							</span>
							<div className="text-4xl font-extrabold tracking-tight text-[#0A3D62] my-1">
								10:00 AM
							</div>
							<span className="text-xs bg-orange-100 text-[#E85A2A] font-bold px-2 py-0.5 rounded">
								330 Grams
							</span>
						</div>
						<div className="space-y-2.5">
							<div className="flex justify-between items-center text-xs border-b border-gray-200 pb-2">
								<span className="text-[#3D5568]">Current Feed FCR</span>
								<span className="font-bold">1.15 Optimal</span>
							</div>
							<div className="flex justify-between items-center text-xs border-b border-gray-200 pb-2">
								<span className="text-[#3D5568]">Last Biomass weight</span>
								<span className="font-bold">220g (July 3)</span>
							</div>
							<div className="flex justify-between items-center text-xs pb-1">
								<span className="text-[#3D5568]">Feeder Location</span>
								<span className="font-bold text-right">Pond 1, Western Visayas</span>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Trust / credibility strip */}
			<section className="bg-[#F4F7F6] py-12 px-6 border-b border-gray-200 text-center">
				<div className="max-w-4xl mx-auto">
					<div className="text-xs font-bold tracking-widest uppercase text-[#3D5568] mb-4">
						TRUSTED AQUACULTURE STANDARDS
					</div>
					<p className="italic text-base text-[#3D5568] leading-relaxed max-w-2xl mx-auto mb-6">
						"Developed with catfish farm owners in Iloilo and Western Visayas, aligning with the
						Bureau of Fisheries and Aquatic Resources (BFAR) guidelines for sustainable animal
						nutrition and cage-pond aquaculture development."
					</p>
					<div className="flex justify-center items-center gap-8 opacity-65 grayscale hover:grayscale-0 transition-all">
						<span className="text-sm font-extrabold tracking-widest">VISAYAS CATFISH ASSOC.</span>
						<span className="text-sm font-extrabold tracking-widest">PHIL-AQUA LABS</span>
						<span className="text-sm font-extrabold tracking-widest">
							ESP32 ECO-FEEDER APPROVED
						</span>
					</div>
				</div>
			</section>

			{/* FAQ */}
			<section className="py-16 px-6 md:px-12 max-w-4xl mx-auto">
				<h2 className="text-2xl md:text-3xl font-extrabold text-center mb-10 text-[#0A3D62]">
					Frequently Answered Questions
				</h2>
				<div className="space-y-4">
					{FAQS.map((faq, i) => (
						<div
							key={faq.q}
							className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
						>
							<button
								type="button"
								onClick={() => toggleFaq(i)}
								className="w-full px-6 py-5 flex justify-between items-center text-left font-bold text-base md:text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E85A2A] text-[#0A3D62]"
							>
								<span>{faq.q}</span>
								{openFaqIndex === i ? (
									<ChevronUp className="w-5 h-5 text-[#E85A2A] shrink-0" />
								) : (
									<ChevronDown className="w-5 h-5 text-[#3D5568] shrink-0" />
								)}
							</button>
							{openFaqIndex === i && (
								<div className="px-6 pb-5 text-sm md:text-base text-[#3D5568] leading-relaxed border-t border-gray-100 pt-3">
									{faq.a}
								</div>
							)}
						</div>
					))}
				</div>
			</section>

			{/* Closing CTA */}
			<section className="bg-white border-t border-gray-200 py-16 px-6 text-center">
				<div className="max-w-3xl mx-auto">
					<h2 className="text-3xl md:text-4xl font-black tracking-tight text-[#0A3D62] mb-4">
						Ready to secure your catfish pond?
					</h2>
					<p className="text-[#3D5568] text-base md:text-lg mb-8 max-w-xl mx-auto">
						Access your remote feed management console, connect your automated ESP32 hardware, and
						start saving bags of feed today.
					</p>
					<button
						type="button"
						onClick={() => router.push("/login")}
						className="bg-[#E85A2A] text-white font-extrabold text-lg px-8 py-4 rounded-xl shadow-lg hover:bg-[#d04a1f] transition-all transform hover:-translate-y-1 active:scale-95 inline-flex items-center gap-3"
					>
						Access Your Farm Board <ArrowRight className="w-5 h-5" />
					</button>
				</div>
			</section>

			{/* Footer */}
			<footer className="bg-[#0A3D62] text-white py-12 px-6 text-center border-t border-white/10 text-xs md:text-sm">
				<div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
					<div className="flex items-center gap-2">
						<span className="font-extrabold tracking-tight">
							Opti<span className="text-[#E85A2A]">Feed</span>
						</span>
						<span className="text-gray-400">| Remote Aquaculture Suite</span>
					</div>
					<div className="text-gray-300">
						© 2026 OptiFeed Philippines. All rights reserved. Western Visayas Aquaculture.
					</div>
					<div className="flex gap-4 text-gray-400">
						<span className="hover:text-white cursor-pointer">Privacy</span>
						<span className="hover:text-white cursor-pointer">Terms</span>
						<button
							type="button"
							onClick={() => router.push("/login")}
							className="hover:text-white cursor-pointer"
						>
							Login
						</button>
					</div>
				</div>
			</footer>
		</div>
	);
}
