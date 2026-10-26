export type LegalSectionDescriptor = {
	id: string;
	title: string;
};

export const PRIVACY_SECTIONS: readonly LegalSectionDescriptor[] = [
	{ id: "summary", title: "At a glance" },
	{ id: "who-we-are", title: "Who we are and our roles" },
	{ id: "scope", title: "Scope of this policy" },
	{ id: "data-we-collect", title: "Data we collect" },
	{ id: "how-we-use", title: "How and why we use data" },
	{ id: "ai", title: "AI advice and automated processing" },
	{ id: "cookies", title: "Cookies, local storage, and offline data" },
	{ id: "sharing", title: "Sharing and subprocessors" },
	{ id: "transfers", title: "International transfers" },
	{ id: "retention", title: "How long we keep data" },
	{ id: "security", title: "How we protect data" },
	{ id: "rights", title: "Your data privacy rights" },
	{ id: "breach", title: "Data breaches" },
	{ id: "children", title: "Children" },
	{ id: "research", title: "Research participants" },
	{ id: "changes", title: "Changes to this policy" },
	{ id: "contact", title: "Contact and complaints" },
	{ id: "version-history", title: "Version history" },
] as const;

export const TERMS_SECTIONS: readonly LegalSectionDescriptor[] = [
	{ id: "acceptance", title: "Acceptance" },
	{ id: "service", title: "The service" },
	{ id: "accounts", title: "Accounts and security" },
	{ id: "acceptable-use", title: "Acceptable use" },
	{ id: "farm-data", title: "Farm data and ownership" },
	{ id: "ai-feeding-safety", title: "AI advice and feeding safety" },
	{ id: "availability", title: "Availability and changes" },
	{ id: "intellectual-property", title: "Intellectual property" },
	{ id: "third-party", title: "Third-party services" },
	{ id: "disclaimers", title: "Disclaimers" },
	{ id: "liability", title: "Limitation of liability" },
	{ id: "indemnity", title: "Indemnity" },
	{ id: "termination", title: "Termination" },
	{ id: "governing-law", title: "Governing law and venue" },
	{ id: "changes", title: "Changes to these terms" },
	{ id: "contact", title: "Contact" },
	{ id: "version-history", title: "Version history" },
] as const;
