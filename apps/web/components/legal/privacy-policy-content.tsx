import {
	LegalCallout,
	LegalLink,
	LegalList,
	LegalSection,
	LegalSubheading,
	LegalTable,
} from "@/components/legal/legal-ui";
import {
	DPO_ADDRESS,
	DPO_EMAIL,
	DPO_NAME,
	LEGAL_HISTORY,
	LEGAL_PUBLISHED,
	LEGAL_SUBPROCESSORS,
	NPC_ADDRESS,
	NPC_COMPLAINT_URL,
	NPC_PHONE,
	NPC_WEBSITE,
	RESEARCH_RETENTION,
} from "@/lib/legal/config";

export function PrivacyPolicyContent() {
	return (
		<>
			<LegalSection id="summary" title="At a glance">
				<p>
					PakaonAI is a precision feeding research prototype for African catfish (
					<em>Clarias gariepinus</em>), developed as a capstone project at the Iloilo State
					University of Fisheries Science and Technology (ISUFST), Dingle Campus. This policy
					explains what personal data we collect, why we collect it, who we share it with, how long
					we keep it, and the rights you have under the Philippine Data Privacy Act of 2012
					(Republic Act No. 10173) and its Implementing Rules and Regulations.
				</p>
				<LegalList>
					<li>
						We collect account, farm operations, device telemetry, AI assistant, website, and
						research data.
					</li>
					<li>
						For farm operational data, the farm or cooperative is the personal information
						controller (PIC); PakaonAI is a personal information processor (PIP) acting on its
						instructions. For account, website, AI, and research data, PakaonAI is the PIC.
					</li>
					<li>
						We use Supabase (Singapore), Vercel (Sydney, including Vercel Analytics and Speed
						Insights), OpenCodeGo, Resend, and Google Forms. We do not sell personal data, run
						advertising, or use Telegram.
					</li>
					<li>
						Research data comes from an optional name, date, role, and questionnaire answers. We do
						not ask for email, phone, audio, video, photos, or sensitive personal information.
					</li>
					<li>
						You have rights to be informed, object, access, correct, erase or block, portability,
						damages, and complaint. Contact our DPO; we aim to respond within 14 business days.
					</li>
					<li>
						This version is a draft for University Legal Office review. It is not yet effective.
					</li>
				</LegalList>
				<LegalCallout tone="info" title="Plain-language promise">
					<p>
						We collect what the system needs to feed fish accurately and to evaluate the capstone.
						We do not sell your data, and we do not use it for advertising. If something here is
						unclear, email the DPO and ask before you use the service.
					</p>
				</LegalCallout>
			</LegalSection>

			<LegalSection id="who-we-are" title="Who we are and our roles">
				<p>
					The personal information controller for this website, the PakaonAI dashboard, the
					progressive web app, the AI assistant, and the research questionnaires is:
				</p>
				<LegalCallout tone="info">
					<p className="font-semibold">PakaonAI Capstone Project</p>
					<p>College of Information and Communication Technology</p>
					<p>Iloilo State University of Fisheries Science and Technology, Dingle Campus</p>
					<p>Dingle, Iloilo, Philippines</p>
				</LegalCallout>
				<LegalSubheading>Farm operational data</LegalSubheading>
				<p>
					When a farm, cooperative, or independent farmer enters pond, biomass, feeding, harvest, or
					device data, that farm controls the purpose and extent of the processing. The farm is the
					PIC for that data. PakaonAI is the PIP and processes the data only to provide the service,
					secure it, and follow the farm&apos;s instructions. A farm may request a written data
					processing agreement for its pilot deployment.
				</p>
				<p>
					If you are a farm worker or operator, please contact your farm administrator first for
					requests about farm operational data. We will assist the farm in responding.
				</p>
				<LegalSubheading>Data Protection Officer</LegalSubheading>
				<p>
					Our designated Data Protection Officer and privacy contact is <strong>{DPO_NAME}</strong>.
					You can reach the DPO at <LegalLink href={`mailto:${DPO_EMAIL}`}>{DPO_EMAIL}</LegalLink>{" "}
					or at {DPO_ADDRESS}.
				</p>
				<LegalSubheading>NPC registration status</LegalSubheading>
				<p>
					PakaonAI is a research capstone project. It has not yet registered a data processing
					system with the National Privacy Commission. It will register if the processing meets the
					NPC&apos;s registration criteria or before commercial deployment. This does not affect
					your rights or our commitment to protect your data.
				</p>
			</LegalSection>

			<LegalSection id="scope" title="Scope of this policy">
				<p>This policy covers personal data processed through:</p>
				<LegalList>
					<li>the PakaonAI public website and login page;</li>
					<li>
						the authenticated web dashboard and its settings, biomass, schedule, growth, harvest,
						history, and audit pages;
					</li>
					<li>
						the installable progressive web app (PWA), including its offline snapshots and outbox;
					</li>
					<li>the ESP32 feeder service, device telemetry, commands, and acknowledgements;</li>
					<li>the AI assistant and feeding recommendation features;</li>
					<li>email notifications sent through Resend; and</li>
					<li>
						the capstone research questionnaires collected through printed forms or Google Forms.
					</li>
				</LegalList>
				<p>
					This policy does not govern third-party websites or services that we use, such as Google
					Forms/Drive, Supabase, Vercel, OpenCodeGo, or Resend. Those services have their own
					privacy notices. We choose processors that offer appropriate safeguards, but their
					independent processing is described in their terms.
				</p>
				<p>
					This policy is aligned with RA 10173 and its IRR. It is not a claim of NPC certification,
					accreditation, or a guarantee that no incident can occur.
				</p>
			</LegalSection>

			<LegalSection id="data-we-collect" title="Data we collect">
				<LegalTable
					caption="Categories of personal data processed by PakaonAI"
					columns={[
						{ key: "category", label: "Category" },
						{ key: "data", label: "What it includes" },
						{ key: "source", label: "Where it comes from" },
					]}
					rows={[
						{
							category: "Account and access",
							data: (
								<>
									Farm ID, display name, pond-provisioned email address, role and membership,
									authentication metadata, session information, IP address, rate-limit and lockout
									records, and audit events. Passwords are handled by Supabase Auth; we do not see
									plaintext passwords.
								</>
							),
							source: "You, your farm administrator, Supabase Auth, and our security logs.",
						},
						{
							category: "Farm operations",
							data: (
								<>
									Farm and pond names; pond area and depth; stocking date, count, and weight;
									grow-out cycles; biomass samples (weight, length, count, batch label); FCR and SGR
									values; feeding schedules; feed events; harvest records; calendar events; and
									notes.
								</>
							),
							source:
								"Farm staff and administrators through the dashboard, imports, or device records.",
						},
						{
							category: "Device and telemetry",
							data: (
								<>
									Device ID/MAC address, a hashed device token, firmware version, last-seen time,
									hopper feed level, water temperature, RTC status, commands and acknowledgements,
									dispense events, offline queue entries, and device audit events.
								</>
							),
							source: "The ESP32 feeder and the dashboard.",
						},
						{
							category: "AI assistant",
							data: (
								<>
									Chat messages and prompts, pond context needed to answer (such as biomass, FCR,
									schedule, and cycle status), and generated recommendations. Chat history is kept
									in your browser session storage.
								</>
							),
							source:
								"You, when you use the chat or advisor, and the data already in your farm records.",
						},
						{
							category: "Research",
							data: (
								<>
									Optional name, date, role (IT expert, hardware/electronics expert, agriculturist,
									or farm operator/field expert), and questionnaire responses under the ISO/IEC
									25010:2023 evaluation. We do not ask for email, phone, audio, video, photos, or
									sensitive personal information.
								</>
							),
							source:
								"Printed forms or Google Forms completed by the 20 farmer and 10 IT professional respondents.",
						},
						{
							category: "Website and technical",
							data: (
								<>
									IP address, user agent, request logs, error logs, timestamps, locale and theme
									preferences, remembered farm ID, security/rate-limit records, and aggregate
									page-view and performance measurements from Vercel Analytics and Speed Insights.
								</>
							),
							source: "Your browser and our hosting infrastructure.",
						},
						{
							category: "Offline and local",
							data: (
								<>
									Dashboard and page snapshots, the active pond, pending biomass samples, and the
									service-worker cache stored on your device. These may contain farm data.
								</>
							),
							source: "Your browser when you use the PWA or go offline.",
						},
					]}
				/>
				<LegalCallout tone="warning" title="Please do not enter sensitive personal information">
					<p>
						We do not intentionally collect sensitive personal information such as health,
						biometrics, government IDs, financial account details, precise location, or information
						about minors. Please do not enter it in biomass notes, chat, imports, or research forms.
						If you believe sensitive data has been entered, contact the DPO so we can assess and,
						where appropriate, delete it.
					</p>
				</LegalCallout>
			</LegalSection>

			<LegalSection id="how-we-use" title="How and why we use data">
				<LegalTable
					caption="Purposes and lawful bases"
					columns={[
						{ key: "purpose", label: "Purpose" },
						{ key: "example", label: "Examples" },
						{ key: "basis", label: "Lawful basis" },
					]}
					rows={[
						{
							purpose: "Provide the service",
							example:
								"Create and secure accounts, show the dashboard, calculate biomass, store farm records, and operate the feeder schedule.",
							basis: "Contract or steps before a contract with the farm or user.",
						},
						{
							purpose: "Device control and telemetry",
							example:
								"Send feed amounts, receive dispense confirmations, show hopper and temperature readings, and replay offline events.",
							basis: "Contract with the farm or user.",
						},
						{
							purpose: "Security and reliability",
							example:
								"Authenticate sessions, enforce role-based access, rate-limit login attempts, lock out repeated failures, and keep audit logs.",
							basis:
								"Legitimate interests in protecting the service and users; legal obligations where applicable.",
						},
						{
							purpose: "Notifications",
							example:
								"Send missed-feeding, device-offline, hopper-low, harvest, and sampling reminders by email.",
							basis: "Contract or consent, depending on the notification and your settings.",
						},
						{
							purpose: "AI advice",
							example:
								"Generate a chat answer or a feeding recommendation from the pond context you provide.",
							basis:
								"Contract or legitimate interests in providing the feature; the recommendation is advisory only.",
						},
						{
							purpose: "Research and evaluation",
							example:
								"Evaluate the system with farmers and IT professionals under ISO/IEC 25010:2023 and publish aggregated results.",
							basis: "Your consent as a research participant.",
						},
						{
							purpose: "Improve the service",
							example:
								"Use aggregated or de-identified statistics and aggregate Vercel Analytics/Speed Insights measurements to understand errors, usage, and performance.",
							basis:
								"Legitimate interests; data is aggregated or de-identified so it no longer identifies you.",
						},
						{
							purpose: "Legal compliance",
							example:
								"Respond to lawful requests, preserve records for legal claims, or meet regulatory duties.",
							basis: "Legal obligation or the establishment, exercise, or defense of legal claims.",
						},
					]}
				/>
				<p>
					Where we rely on consent, you may withdraw it at any time. Withdrawal does not affect
					processing that already happened, and it does not stop processing that is based on another
					lawful basis. We do not sell, rent, or trade personal data, and we do not use it for
					advertising.
				</p>
			</LegalSection>

			<LegalSection id="ai" title="AI advice and automated processing">
				<p>
					The AI assistant and feeding recommendation features use <strong>OpenCodeGo</strong> to
					generate responses. The prompt may include the pond context needed to answer, such as
					recent biomass samples, FCR, schedule, population, and cycle status. Chat history is kept
					in your browser session storage and is sent to the provider only when you use the feature.
				</p>
				<LegalList>
					<li>
						We have enabled the training opt-out on our OpenCodeGo account. We do not use your data
						to train our own models.
					</li>
					<li>
						OpenCodeGo may process or retain data under its own terms. We minimize the prompt and do
						not send account passwords, device tokens, or sensitive personal information.
					</li>
					<li>
						The AI recommendation is <strong>advisory only</strong>. It is not the sole basis for a
						decision that significantly affects you, and it does not replace your judgment, fresh
						sampling, or the device&apos;s RTC schedule and physical button.
					</li>
					<li>
						Do not enter sensitive personal information, credentials, or other people&apos;s data in
						the chat. If you do, we may remove it.
					</li>
					<li>
						If you prefer not to use AI processing, you can use the deterministic feed calculator
						and the manual schedule controls without opening the AI chat or advisor.
					</li>
				</LegalList>
			</LegalSection>

			<LegalSection id="cookies" title="Cookies, local storage, and offline data">
				<p>
					We use essential and functional storage to keep you signed in, remember your language and
					theme, and let the app work offline. We also use Vercel Analytics and Speed Insights for
					aggregate traffic and performance measurement. We do not use advertising cookies or build
					advertising profiles.
				</p>
				<LegalTable
					caption="Cookies and browser storage"
					columns={[
						{ key: "name", label: "Name" },
						{ key: "purpose", label: "Purpose" },
						{ key: "retention", label: "Type and retention" },
					]}
					rows={[
						{
							name: "Supabase auth cookies (sb-*-auth-token)",
							purpose: "Keep you signed in and refresh your session.",
							retention: "Essential cookie; session or refresh lifetime.",
						},
						{
							name: "Locale preference",
							purpose: "Remember English or Hiligaynon.",
							retention: "Functional; persistent until cleared.",
						},
						{
							name: "optifeed:theme",
							purpose: "Remember light or dark mode.",
							retention: "Functional localStorage; persistent until cleared.",
						},
						{
							name: "optifeed:last-farm-id",
							purpose: "Remember the farm ID on this device if you tick the box.",
							retention: "Functional localStorage; opt-in; until cleared.",
						},
						{
							name: "optifeed.chat.history",
							purpose: "Keep the current chat conversation.",
							retention: "Session storage; until the tab/session ends or you sign out.",
						},
						{
							name: "optifeed:offline:snapshots:v1, optifeed:offline:active:v1, optifeed:pwa:dashboard:v1",
							purpose: "Show the last known farm state offline.",
							retention: "Functional localStorage; until sign-out or manual clear.",
						},
						{
							name: "IndexedDB optifeed-offline and optifeed-offline-outbox",
							purpose: "Store per-pond snapshots and queued biomass samples for offline use.",
							retention: "Functional browser database; until sign-out or manual clear.",
						},
						{
							name: "pakaonai-static-v2 cache",
							purpose: "Serve the app shell and static assets offline.",
							retention: "Service-worker cache; replaced on version updates.",
						},
						{
							name: "Vercel Analytics and Speed Insights",
							purpose: "Aggregate page views and Core Web Vitals performance measurements.",
							retention: "No advertising cookies; aggregate measurement handled by Vercel.",
						},
					]}
				/>
				<LegalCallout tone="warning" title="Offline data stays on the device">
					<p>
						Offline snapshots and queued samples are stored in your browser and are not encrypted by
						PakaonAI. They may contain farm data. Use a trusted device, sign out when you finish,
						and clear the browser data if you share the device. Signing out or opening the login
						page clears the stored snapshots and outbox.
					</p>
				</LegalCallout>
				<p>
					Because we only use essential and functional storage plus aggregate, cookie-free
					measurement, we do not show a cookie consent banner. If we add advertising or other
					non-essential cookies, we will update this policy and ask for consent where required.
				</p>
			</LegalSection>

			<LegalSection id="sharing" title="Sharing and subprocessors">
				<p>
					We share personal data only as needed to run the service, secure it, comply with the law,
					or complete the research. We do not sell or rent personal data.
				</p>
				<LegalTable
					caption="Subprocessors and service providers"
					columns={[
						{ key: "name", label: "Provider" },
						{ key: "purpose", label: "Purpose" },
						{ key: "location", label: "Location" },
						{ key: "safeguard", label: "Safeguard" },
					]}
					rows={LEGAL_SUBPROCESSORS.map((processor) => ({
						name: processor.name,
						purpose: processor.purpose,
						location: processor.location,
						safeguard: processor.safeguard,
					}))}
				/>
				<LegalSubheading>Other recipients</LegalSubheading>
				<LegalList>
					<li>
						<strong>Farm administrators and tenant members.</strong> They can see the farm data they
						are authorized to manage.
					</li>
					<li>
						<strong>University Legal Office, adviser, and evaluation panel.</strong> They may review
						the research records and this policy under confidentiality.
					</li>
					<li>
						<strong>Journal editors and peer reviewers.</strong> They receive only aggregated or
						anonymized results, unless you give separate written consent for more.
					</li>
					<li>
						<strong>Government authorities and courts.</strong> We disclose only when required by
						law or a valid legal process.
					</li>
					<li>
						<strong>Professional advisers.</strong> Lawyers, auditors, or insurers may receive data
						under confidentiality when needed to protect the project.
					</li>
				</LegalList>
				<p>
					Google Forms responses stay in Google Forms/Drive and are accessible only to the
					researchers. Printed forms are kept in a locked cabinet accessible only to the
					researchers. We do not use Telegram for alerts.
				</p>
			</LegalSection>

			<LegalSection id="transfers" title="International transfers">
				<p>
					Some of our processors are outside the Philippines. Supabase stores data in Singapore;
					Vercel hosts the application in Sydney, Australia; Google, OpenCodeGo, and Resend may
					process data in the locations described in their terms. This means your data may be
					transferred to, stored in, or accessed from another country.
				</p>
				<p>
					We use contractual terms, access controls, encryption in transit and at rest where
					available, and data minimization to protect transfers. Where Philippine law requires a
					specific basis or safeguard for a transfer, we will put it in place before the transfer.
					Contact the DPO if you want more information about a specific processor.
				</p>
			</LegalSection>

			<LegalSection id="retention" title="How long we keep data">
				<p>
					We keep personal data only as long as needed for the purpose, for legal claims, or as
					required by law. The table below summarizes the current schedule.
				</p>
				<LegalTable
					caption="Retention schedule"
					columns={[
						{ key: "data", label: "Data" },
						{ key: "period", label: "Retention" },
					]}
					rows={[
						{
							data: "Account and access data",
							period:
								"While the account is active, then 30 days after deletion for recovery and audit.",
						},
						{
							data: "Farm operational records",
							period:
								"5 years after the record is created, unless the farm instructs earlier deletion or a legal hold applies.",
						},
						{
							data: "Security, rate-limit, and audit logs",
							period: "90 days, unless needed for an incident investigation or legal claim.",
						},
						{
							data: "AI chat",
							period:
								"Session storage until the tab/session ends or you sign out. Prompts sent to OpenCodeGo are handled under its terms.",
						},
						{
							data: "Import/export job artifacts",
							period: "7 days after the job completes or fails.",
						},
						{
							data: "Backups",
							period: "Up to 30 days, then overwritten or deleted.",
						},
						{
							data: "Offline snapshots and outbox",
							period: "Until sign-out, opening the login page, or manual browser clear.",
						},
						{
							data: "Research questionnaires and consent records",
							period: RESEARCH_RETENTION,
						},
						{
							data: "Aggregated or de-identified statistics",
							period: "May be kept longer because it no longer identifies you.",
						},
					]}
				/>
				<p>
					When a retention period ends, we delete, anonymize, or securely destroy the data. Printed
					forms are shredded; Google Forms responses are deleted from Google; research contact data,
					if any, is deleted from Supabase. A legal hold or a journal&apos;s data-availability
					policy may extend a period; we will document it.
				</p>
			</LegalSection>

			<LegalSection id="security" title="How we protect data">
				<LegalSubheading>Organizational</LegalSubheading>
				<LegalList>
					<li>Role-based access with tenant memberships and platform-admin separation.</li>
					<li>Least-privilege access for researchers, farm administrators, and operators.</li>
					<li>Confidentiality commitments for the project team, adviser, and panel.</li>
					<li>Incident response and DPO contact for suspected breaches.</li>
				</LegalList>
				<LegalSubheading>Physical</LegalSubheading>
				<LegalList>
					<li>
						Printed research forms are kept in a locked cabinet accessible only to the researchers.
					</li>
					<li>The ESP32 enclosure protects the controller from moisture and accidental contact.</li>
				</LegalList>
				<LegalSubheading>Technical</LegalSubheading>
				<LegalList>
					<li>
						Encrypted transport (HTTPS/TLS) between your browser, the app, and the device APIs.
					</li>
					<li>Supabase encryption at rest and access controls.</li>
					<li>Hashed device tokens and timing-safe token comparison.</li>
					<li>Login rate limits, lockout rules, session validation, and audit logs.</li>
					<li>Backups and recovery controls provided by Supabase and Vercel.</li>
				</LegalList>
				<p>
					No method of transmission or storage is completely secure. If you suspect unauthorized
					access, contact the DPO immediately. Offline snapshots are not encrypted by PakaonAI, so
					treat the device as sensitive when it contains farm data.
				</p>
			</LegalSection>

			<LegalSection id="rights" title="Your data privacy rights">
				<p>Under the Data Privacy Act, you have the right to:</p>
				<LegalList>
					<li>be informed whether your personal data is being or has been processed;</li>
					<li>
						object to processing, including direct marketing, automated processing, or profiling;
					</li>
					<li>reasonable access to your data, its source, recipients, and how it was processed;</li>
					<li>dispute inaccuracy and have it corrected;</li>
					<li>
						suspend, withdraw, or order the blocking, removal, or destruction of data in the cases
						allowed by law;
					</li>
					<li>
						be indemnified for damages caused by inaccurate, incomplete, outdated, false, unlawfully
						obtained, or unauthorized use;
					</li>
					<li>
						data portability for data processed electronically in a structured, commonly used
						format; and
					</li>
					<li>lodge a complaint with the National Privacy Commission.</li>
				</LegalList>
				<LegalSubheading>How to exercise your rights</LegalSubheading>
				<p>
					Email <LegalLink href={`mailto:${DPO_EMAIL}`}>{DPO_EMAIL}</LegalLink> with your name, farm
					ID (if applicable), the right you want to exercise, and enough detail for us to find the
					data. We may ask for reasonable proof of identity to protect you from impersonation. We
					aim to respond within <strong>14 business days</strong>. This is a service standard, not a
					statutory deadline.
				</p>
				<p>
					Requests are free. Authorized representatives and lawful heirs may act on your behalf with
					proper proof. If your request concerns farm operational data, contact your farm
					administrator first; we will assist the farm in responding. We may decline a vexatious or
					unreasonable request as allowed by law, and we will explain why.
				</p>
				<p>
					If you took part in the research, you may withdraw your consent by contacting the DPO.
					Withdrawal stops future research processing, but data already aggregated or published in a
					way that no longer identifies you may not be removable.
				</p>
			</LegalSection>

			<LegalSection id="breach" title="Data breaches">
				<p>
					If we become aware of a personal data breach that requires notification, we will notify
					the National Privacy Commission and affected data subjects within{" "}
					<strong>72 hours</strong> of knowledge, as required by IRR Section 38. The notification
					will describe the nature of the breach, the data possibly involved, and the measures we
					took.
				</p>
				<p>
					We may delay notification only to the extent allowed by law, such as to determine the
					scope, prevent further disclosure, or restore the integrity of the system. We will not
					conceal a breach. Contact the DPO if you suspect one.
				</p>
			</LegalSection>

			<LegalSection id="children" title="Children">
				<p>
					PakaonAI is intended for farm operators and adult research participants. We do not
					knowingly collect personal data from children. Accounts are issued by farm administrators,
					and research participants must be 18 or older.
				</p>
				<p>
					If you believe a child&apos;s personal data has been provided, contact the DPO. We will
					assess the request and delete the data where appropriate.
				</p>
			</LegalSection>

			<LegalSection id="research" title="Research participants">
				<p>
					The capstone evaluates PakaonAI with <strong>20 fish farmers</strong> and{" "}
					<strong>10 IT professionals</strong> using a questionnaire based on ISO/IEC 25010:2023.
					Participation is voluntary and based on your informed consent.
				</p>
				<LegalSubheading>What we collect</LegalSubheading>
				<p>
					An optional name, the date, your role (IT expert, hardware/electronics expert,
					agriculturist, or farm operator/field expert), and your questionnaire answers. We do not
					ask for email, phone, audio, video, photos, or sensitive personal information.
				</p>
				<LegalSubheading>How we collect and store it</LegalSubheading>
				<LegalList>
					<li>
						<strong>Printed forms.</strong> Kept in a locked cabinet accessible only to the
						researchers and shredded after the retention period.
					</li>
					<li>
						<strong>Google Forms.</strong> Responses stay in Google Forms/Drive and are accessible
						only to the researchers. The form is configured not to collect email addresses.
					</li>
					<li>
						No research response is exported to Supabase unless you separately provide contact
						details for follow-up.
					</li>
				</LegalList>
				<LegalSubheading>Confidentiality and publication</LegalSubheading>
				<p>
					We report results in aggregated or anonymized form. We do not name you, quote you, or
					publish your photo without separate written permission. The capstone paper may be
					published in a reputable research journal; only aggregated or anonymized results will be
					included.
				</p>
				<LegalSubheading>Withdrawal</LegalSubheading>
				<p>
					You may skip any question, stop at any time, or withdraw by contacting the DPO. There is
					no penalty. Withdrawal stops future processing; data already aggregated or published in a
					form that no longer identifies you may not be removable.
				</p>
				<LegalSubheading>Retention</LegalSubheading>
				<p>{RESEARCH_RETENTION}</p>
			</LegalSection>

			<LegalSection id="changes" title="Changes to this policy">
				<p>
					We may update this policy when the service, the law, or our processors change. The version
					number and last-updated date at the top of this page will change, and we will keep a
					version history below. For material changes, we will post a notice on the website and,
					where appropriate, send an email to the address on file before the change takes effect.
				</p>
				<p>
					This version is a draft for University Legal Office review. It is not effective until the
					review is complete, the status changes to effective, and the approved effective date is
					posted.
				</p>
			</LegalSection>

			<LegalSection id="contact" title="Contact and complaints">
				<p>
					For questions, requests, or complaints about privacy, contact our designated Data
					Protection Officer:
				</p>
				<LegalCallout tone="info">
					<p className="font-semibold">{DPO_NAME}</p>
					<p>{DPO_ADDRESS}</p>
					<p>
						Email: <LegalLink href={`mailto:${DPO_EMAIL}`}>{DPO_EMAIL}</LegalLink>
					</p>
				</LegalCallout>
				<p>You may also complain to the National Privacy Commission:</p>
				<LegalCallout tone="info">
					<p className="font-semibold">National Privacy Commission</p>
					<p>{NPC_ADDRESS}</p>
					<p>Telephone: {NPC_PHONE}</p>
					<p>
						Website:{" "}
						<LegalLink href={NPC_WEBSITE} external>
							{NPC_WEBSITE}
						</LegalLink>
					</p>
					<p>
						Complaints:{" "}
						<LegalLink href={NPC_COMPLAINT_URL} external>
							{NPC_COMPLAINT_URL}
						</LegalLink>
					</p>
				</LegalCallout>
				<p>
					We would appreciate the chance to resolve your concern first. Contacting us does not
					prevent you from exercising your rights with the NPC.
				</p>
			</LegalSection>

			<LegalSection id="version-history" title="Version history">
				<LegalTable
					caption="Privacy Policy version history"
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
			</LegalSection>
		</>
	);
}
