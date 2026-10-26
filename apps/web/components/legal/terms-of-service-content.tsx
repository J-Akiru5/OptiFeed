import {
	LegalCallout,
	LegalLink,
	LegalList,
	LegalSection,
	LegalSubheading,
	LegalTable,
} from "@/components/legal/legal-ui";
import {
	DPO_EMAIL,
	DPO_NAME,
	LEGAL_HISTORY,
	LEGAL_PUBLISHED,
	LEGAL_VERSION,
} from "@/lib/legal/config";

export function TermsOfServiceContent() {
	return (
		<>
			<LegalSection id="acceptance" title="Acceptance">
				<p>
					These Terms of Service govern your access to and use of the PakaonAI website, dashboard,
					progressive web app, AI assistant, and ESP32 feeder service (together, the
					&ldquo;Service&rdquo;). By signing in, accessing, or using the Service, you agree to these
					Terms and to our Privacy Policy. If you do not agree, do not use the Service.
				</p>
				<LegalCallout tone="warning" title="Research prototype">
					<p>
						PakaonAI is a capstone research prototype, not a commercial, life-safety, or regulated
						aquaculture control system. It is provided on an &ldquo;as is&rdquo; and &ldquo;as
						available&rdquo; basis. The ESP32 real-time clock schedule, the physical feed button,
						and your own supervision remain the fallback for feeding.
					</p>
				</LegalCallout>
			</LegalSection>

			<LegalSection id="service" title="The service">
				<p>
					PakaonAI helps farm operators record biomass samples, calculate feed amounts, monitor
					feeding and device telemetry, track FCR and growth, plan harvests, and review feeding
					history. It may include an AI assistant and feeding recommendation. The Service is offered
					for the capstone evaluation and pilot use described in the project materials.
				</p>
				<p>
					We may add, change, suspend, or remove features to improve the Service, address security,
					or comply with law. We will try to give reasonable notice of material changes that affect
					how you use the Service.
				</p>
			</LegalSection>

			<LegalSection id="accounts" title="Accounts and security">
				<LegalList>
					<li>
						Accounts are issued by a farm administrator or the PakaonAI team. You must provide
						accurate information and keep it up to date.
					</li>
					<li>
						Keep your password confidential. Do not share your account or let another person use
						your session. Notify your administrator or the DPO immediately if you suspect
						unauthorized access.
					</li>
					<li>
						You are responsible for activity under your account, to the extent allowed by law.
					</li>
					<li>
						We may suspend or revoke access for security, abuse, legal reasons, or a violation of
						these Terms.
					</li>
				</LegalList>
			</LegalSection>

			<LegalSection id="acceptable-use" title="Acceptable use">
				<p>You agree not to:</p>
				<LegalList>
					<li>access another farm, account, or tenant without authorization;</li>
					<li>probe, scan, bypass, or defeat authentication, rate limits, or access controls;</li>
					<li>
						scrape, harvest, or bulk-extract data except through the export features we provide;
					</li>
					<li>
						reverse engineer, decompile, or attempt to derive source code except as allowed by law;
					</li>
					<li>
						upload malware, malicious code, or content that infringes another person&apos;s rights;
					</li>
					<li>
						enter sensitive personal information, another person&apos;s data without authority, or
						unlawful content;
					</li>
					<li>interfere with the ESP32, the feeder, the pond, or another user&apos;s device;</li>
					<li>use the Service to harm animals, people, property, or the environment; or</li>
					<li>use the Service for an illegal purpose or in violation of Philippine law.</li>
				</LegalList>
			</LegalSection>

			<LegalSection id="farm-data" title="Farm data and ownership">
				<p>
					As between you and PakaonAI, the farm or farmer that controls the pond owns its farm
					operational data. You grant PakaonAI a limited, non-exclusive, revocable license to host,
					process, transmit, back up, and display that data only to provide the Service, secure it,
					and follow your instructions.
				</p>
				<p>
					You are responsible for having the authority to enter data about your farm, your workers,
					and your devices. Do not upload another person&apos;s personal data without their consent
					or another lawful basis.
				</p>
				<p>
					We may use aggregated or de-identified statistics for research, evaluation, and service
					improvement. Research use of identifiable data requires consent, as described in the
					Privacy Policy. We do not sell farm data.
				</p>
				<p>
					If you are a farm tenant, your farm administrator controls membership and access. A farm
					may request a written data processing agreement for its pilot deployment.
				</p>
			</LegalSection>

			<LegalSection id="ai-feeding-safety" title="AI advice and feeding safety">
				<LegalCallout tone="important" title="Do not rely on the app alone">
					<p>
						Feeding decisions affect animal health, water quality, cost, and yield. The farmer and
						farm staff remain responsible for the pond, the fish, the feed, the device, the power
						supply, the hopper, and the schedule. Check the physical feeder and the pond. The ESP32
						RTC and the physical button must remain available as the offline fallback.
					</p>
				</LegalCallout>
				<LegalList>
					<li>
						AI recommendations are estimates and advisory only. They are not veterinary,
						nutritional, legal, financial, or engineering advice.
					</li>
					<li>
						Verify a recommendation with a fresh biomass sample, your records, and your own
						observation before you apply it.
					</li>
					<li>
						We do not guarantee a specific feed amount, growth rate, FCR, survival rate, harvest
						weight, income, or water-quality outcome.
					</li>
					<li>
						Do not enter sensitive personal information or credentials in the AI chat. If you do, we
						may remove it.
					</li>
					<li>
						If the device is offline, the app cannot send commands. Scheduled feeding depends on the
						device&apos;s RTC and local cache.
					</li>
				</LegalList>
			</LegalSection>

			<LegalSection id="availability" title="Availability and changes">
				<p>
					The Service is provided as available. We do not promise uninterrupted, error-free, or
					secure operation, a service-level agreement, or a specific uptime. Maintenance, network
					failures, third-party outages, device faults, and power interruptions may affect
					availability.
				</p>
				<p>
					We may change, suspend, or discontinue all or part of the Service. Where practicable, we
					will give notice and a reasonable opportunity to export farm data before a
					discontinuation.
				</p>
			</LegalSection>

			<LegalSection id="intellectual-property" title="Intellectual property">
				<p>
					The Service, its software, design, documentation, branding, and research materials are
					owned by the PakaonAI project team, ISUFST, or their licensors. These Terms do not
					transfer ownership to you.
				</p>
				<p>
					You retain ownership of your farm data. You may export it using the features we provide.
					Open-source components remain under their respective licenses. If you send us feedback or
					suggestions, you allow us to use them to improve the Service without a fee.
				</p>
			</LegalSection>

			<LegalSection id="third-party" title="Third-party services">
				<p>
					The Service relies on third-party providers, including Supabase, Vercel, OpenCodeGo,
					Resend, and Google Forms/Drive. Their terms and privacy notices apply to their processing.
					We are not responsible for a third party&apos;s independent acts or omissions, but we
					choose providers with appropriate safeguards and remain accountable for personal data we
					control.
				</p>
				<p>
					The Service may link to third-party websites. We do not control their content or privacy
					practices.
				</p>
			</LegalSection>

			<LegalSection id="disclaimers" title="Disclaimers">
				<p>
					To the maximum extent permitted by Philippine law, the Service is provided without
					warranties of any kind, express or implied, including merchantability, fitness for a
					particular purpose, non-infringement, accuracy, and uninterrupted availability.
				</p>
				<p>
					We do not warrant that the Service will meet your requirements, that data will be accurate
					or complete, that defects will be corrected, or that the Service will be free of viruses
					or other harmful components. You are responsible for maintaining backups of critical farm
					records.
				</p>
				<p>
					Nothing in these Terms excludes or limits a warranty or right that cannot be excluded or
					limited under Philippine law, including consumer rights and liability for gross
					negligence, fraud, or willful misconduct.
				</p>
			</LegalSection>

			<LegalSection id="liability" title="Limitation of liability">
				<p>
					To the maximum extent permitted by law, PakaonAI, its project team, ISUFST, and their
					advisers will not be liable for indirect, incidental, special, consequential, exemplary,
					or punitive damages, or for loss of profit, revenue, harvest, fish, feed, data, goodwill,
					or business opportunity, arising from or related to the Service.
				</p>
				<p>
					Because the pilot is provided free of charge, our aggregate liability for direct damages
					is limited to the amount you paid us for the Service in the 12 months before the claim, or
					PHP 1,000 if you paid nothing, whichever is lower. This cap does not apply to liability
					that cannot be limited by law.
				</p>
				<p>
					The parties will try to resolve a dispute in good faith before filing a claim. This
					section does not limit your rights under the Data Privacy Act or the National Privacy
					Commission.
				</p>
			</LegalSection>

			<LegalSection id="indemnity" title="Indemnity">
				<p>
					To the extent allowed by law, you agree to indemnify and hold harmless PakaonAI, its
					project team, ISUFST, and their advisers from claims, losses, liabilities, and reasonable
					costs arising from your misuse of the Service, your violation of these Terms, your
					violation of another person&apos;s rights, or data you entered without authority. This
					does not apply to our own negligence or willful misconduct.
				</p>
			</LegalSection>

			<LegalSection id="termination" title="Termination">
				<p>
					You may stop using the Service at any time. A farm administrator may remove your account.
					We may suspend or terminate access for a violation of these Terms, a security risk, a
					legal requirement, or discontinuation of the pilot.
				</p>
				<p>
					On termination, you may request an export of your farm data within a reasonable period. We
					will delete or anonymize data according to the Privacy Policy and any legal retention
					obligation. Provisions that by their nature should survive termination (including
					ownership, disclaimers, liability, and governing law) will survive.
				</p>
			</LegalSection>

			<LegalSection id="governing-law" title="Governing law and venue">
				<p>
					These Terms are governed by the laws of the Republic of the Philippines. Subject to the
					dispute-resolution paragraph above, the courts of Iloilo City have exclusive jurisdiction
					over disputes arising from these Terms, unless a mandatory law provides otherwise.
				</p>
				<p>
					Nothing in these Terms prevents you from exercising your rights under the Data Privacy Act
					or filing a complaint with the National Privacy Commission.
				</p>
			</LegalSection>

			<LegalSection id="changes" title="Changes to these terms">
				<p>
					We may update these Terms when the Service, the law, or our practices change. The version
					number and last-updated date will change, and we will keep a version history below. For
					material changes, we will post a notice on the website and, where appropriate, notify the
					farm administrator before the change takes effect. Continued use after the effective date
					means you accept the updated Terms.
				</p>
				<p>
					This version is a draft for University Legal Office review and is not effective until the
					review is complete.
				</p>
			</LegalSection>

			<LegalSection id="contact" title="Contact">
				<p>
					For questions about these Terms, contact the designated Data Protection Officer,{" "}
					<strong>{DPO_NAME}</strong>, at{" "}
					<LegalLink href={`mailto:${DPO_EMAIL}`}>{DPO_EMAIL}</LegalLink>.
				</p>
				<p>
					For farm access or account issues, contact your farm administrator first. For privacy
					requests, see the Privacy Policy.
				</p>
			</LegalSection>

			<LegalSection id="version-history" title="Version history">
				<LegalTable
					caption="Terms of Service version history"
					columns={[
						{ key: "version", label: "Version" },
						{ key: "date", label: "Date" },
						{ key: "note", label: "Change" },
					]}
					rows={LEGAL_HISTORY.map((entry) => ({
						version: entry.version,
						date: LEGAL_PUBLISHED ? entry.date : `Proposed: ${entry.date}`,
						note: entry.note,
					}))}
				/>
				<p className="text-[12px] text-slate-500 dark:text-slate-400">
					Current version: {LEGAL_VERSION}. This is a draft for University Legal Office review.
				</p>
			</LegalSection>
		</>
	);
}
