/**
 * Legal document configuration.
 *
 * Legal documents use their own semantic version, separate from the app
 * release. The app release below is the root package / CHANGELOG version
 * (1.11.0). `apps/web/package.json` is stale at 1.9.0 and must not be used
 * for the public "applies to" line.
 *
 * Publishing after University Legal Office review:
 *   1. Set LEGAL_STATUS to "effective".
 *   2. Set LEGAL_EFFECTIVE_DATE to the approved date.
 *   3. Add the approved entry to LEGAL_HISTORY.
 *   4. Run the full checks and deploy.
 *
 * While the status is "draft", the legal pages render a review banner, are
 * excluded from search engines, and do not appear in the footer or login
 * acceptance line.
 */
export const LEGAL_STATUS = "effective" as "draft" | "effective";
export const LEGAL_PUBLISHED = LEGAL_STATUS === "effective";

export const LEGAL_VERSION = "1.0";
export const LEGAL_LAST_UPDATED = "2026-10-26";
/** Approved effective date; published after University Legal Office review. */
export const LEGAL_EFFECTIVE_DATE = "2026-10-26";
export const LEGAL_APP_RELEASE = "1.32.0";
export const LEGAL_REVIEWER = "University Legal Office, ISUFST Dingle Campus";

export const DPO_NAME = "Jeff Edrick C. Martinez";
export const DPO_EMAIL = "privacy@pakaonai.syntaxure.dev";
export const DPO_ADDRESS =
	"PakaonAI Capstone Project, College of Information and Communication Technology, ISUFST Dingle Campus, Dingle, Iloilo, Philippines";

export const NPC_ADDRESS =
	"25thâ€“27th Floors, The Upper Class Tower, Quezon Avenue corner Scout Reyes Street, Quezon City, Philippines";
export const NPC_PHONE = "(+63) 2 5322 1322";
export const NPC_WEBSITE = "https://privacy.gov.ph";
export const NPC_COMPLAINT_URL = "https://privacy.gov.ph/contactus/";

export type LegalSubprocessor = {
	name: string;
	purpose: string;
	location: string;
	safeguard: string;
};

export const LEGAL_SUBPROCESSORS: readonly LegalSubprocessor[] = [
	{
		name: "Supabase, Inc.",
		purpose: "Authentication, database, file storage, and backups.",
		location: "Singapore",
		safeguard:
			"Access controls, encryption in transit and at rest, and Supabase data processing terms.",
	},
	{
		name: "Vercel, Inc.",
		purpose:
			"Application hosting, server functions, operational logs, and aggregate Vercel Analytics/Speed Insights measurement.",
		location: "Sydney, Australia",
		safeguard: "Access controls, encrypted transport, and Vercel data processing terms.",
	},
	{
		name: "OpenCodeGo",
		purpose: "AI inference for the assistant and feeding recommendations.",
		location: "Per OpenCodeGo's terms",
		safeguard:
			"Training opt-out enabled on our account; prompts are minimized and must not contain sensitive personal information.",
	},
	{
		name: "Resend, Inc.",
		purpose: "Transactional email delivery for account and farm notifications.",
		location: "Per Resend's terms",
		safeguard:
			"Only the recipient address and the notification content are shared; no marketing lists.",
	},
	{
		name: "Google LLC (Google Forms / Drive)",
		purpose: "Research questionnaire collection and storage for the capstone evaluation.",
		location: "Per Google's terms",
		safeguard:
			"Responses stay in Google Forms/Drive and are accessible only to the researchers; email collection is disabled in the form.",
	},
] as const;

export const LEGAL_HISTORY = [
	{
		version: LEGAL_VERSION,
		date: LEGAL_EFFECTIVE_DATE,
		note: "Initial Privacy Policy and Terms of Service, effective 26 October 2026 after University Legal Office review.",
	},
] as const;

export const RESEARCH_RETENTION =
	"Until the capstone is completed and the resulting paper is published in a reputable research journal, then for the period required by the University's records policy or the journal's data-availability policy, whichever is longer. After that, the data is securely destroyed.";

const LEGAL_PATHS = {
	privacy: "/privacy",
	terms: "/terms",
} as const;
