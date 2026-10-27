import { LEGAL_VERSION } from "@/lib/legal/config";
import { getLocale } from "next-intl/server";

/**
 * A courtesy summary for Hiligaynon readers. The English document is the
 * authoritative legal text; this panel is deliberately a summary, not a
 * word-for-word translation, so legal meaning is not altered by translation.
 */
export async function HiligaynonSummary({ kind }: { kind: "privacy" | "terms" }) {
	const locale = await getLocale();
	if (locale !== "hil") return null;

	const privacy = [
		"Ang PakaonAI isa ka research project sang ISUFST Dingle Campus.",
		"Ginakolekta namon ang account, farm, device, AI, kag research data agud mapadalagan ang precision feeding system.",
		"Ang farm ukon cooperative amo ang may kontrol sang farm operational data; ang PakaonAI amo ang processor nga nagasunod sa ila instruksyon.",
		"Ginagamit namon ang Supabase (Singapore), Vercel (Sydney), OpenCodeGo, Resend, kag Google Forms. Wala kami Telegram kag wala kami ginabaligya nga personal data.",
		"Ang research data para sa 20 ka fish farmers kag 10 ka IT professionals: optional nga name, petsa, role, kag questionnaire answers. May consent ini kag ginabalitaan lamang sa aggregated ukon anonymized nga porma.",
		"May mga kinamatarong ka sa Data Privacy Act: access, correction, deletion ukon blocking, objection, portability, damages, kag reklamo sa NPC.",
		"Kontaka si Jeff Edrick C. Martinez sa privacy@pakaonai.syntaxure.dev. Target namon ang 14 ka business days.",
		"Ang research data ginatago tubtob matapos ang capstone kag mapublish ang paper. Ang printed forms yara sa locked cabinet; ang Google Forms responses yara sa Google.",
		"Ang English nga bersyon amo ang opisyal nga legal nga teksto. Ini nga summary para sa kasanag lamang.",
	];

	const terms = [
		"Ang PakaonAI isa ka research prototype. Gamita ini sa imo kaugalingon nga risk.",
		"Ikaw ang responsable sa feeding decisions, device maintenance, kuryente, connectivity, kag animal welfare.",
		"Ang AI advice advisory lamang. I-verify ang recommendation sa bag-o nga biomass sample kag sa imo kaugalingon nga obserbasyon.",
		"Ang farm data imo. Ginahatag mo sa PakaonAI ang limitado nga permiso sa pagproseso para mapadalagan ang service.",
		"Indi ka mag-hack, mag-abuso, mag-scrape, mag-enter sang sensitibo nga personal data, ukon makaguba sang device ukon iban nga users.",
		"Ang service ginahatag nga as-is, nga wala sang SLA. Mahimo ini magbago ukon magsuspinde para sa security ukon legal nga rason.",
		"Philippine law ang nagagobernar; Iloilo City ang venue. Wala sini ginabuhinan ang mga kinamatarong nga indi mabuhinan sa idalom sang Philippine law.",
		"Kontaka ang DPO sa privacy@pakaonai.syntaxure.dev para sa mga pamangkot.",
		`Bersyon ${LEGAL_VERSION}. Ang English nga bersyon amo ang opisyal.`,
	];

	const points = kind === "privacy" ? privacy : terms;

	return (
		<section
			lang="hil"
			className="rounded-2xl border border-[#0A3D62]/15 bg-[#F4F7F6] p-5 dark:border-white/10 dark:bg-white/[0.04]"
		>
			<h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#0A3D62] dark:text-[#8EC5EF]">
				Summary sa Hiligaynon
			</h2>
			<p className="mt-2 text-[12px] leading-5 text-slate-500 dark:text-slate-400">
				Courtesy summary lamang ini. Ang English nga bersyon amo ang opisyal kag magagahum nga
				teksto.
			</p>
			<ul className="mt-3 list-disc space-y-2 pl-5 text-[12.5px] leading-6 text-slate-600 marker:text-[#E85A2A] dark:text-slate-300">
				{points.map((point) => (
					<li key={point}>{point}</li>
				))}
			</ul>
		</section>
	);
}
