# Paper ethics and data-gathering additions

The current Chapter III section **Ethical Considerations** covers animal welfare only. The study also involves **20 fish farmers and 10 IT professionals**, so the paper should describe human-participant consent, confidentiality, and data handling. The paragraphs below are written to be inserted after the existing animal-welfare paragraph.

## Suggested insertion — Ethical Considerations

> **Human participants.** The study also involved 20 fish farmers and 10 IT professionals who evaluated the system using the ISO/IEC 25010:2023 software quality model. Participation was voluntary and based on informed consent. Each respondent received a Research Information and Informed Consent Form, either on printed paper or through Google Forms, before answering the questionnaire. The form explained the purpose of the study, the procedures, the data to be collected, the risks and benefits, the confidentiality measures, the retention period, and the right to skip questions or withdraw at any time without penalty. Respondents were 18 years or older. They were not asked for email addresses, phone numbers, government IDs, health information, biometrics, precise location, audio, video, or photographs. Names were optional.
>
> **Confidentiality and data privacy.** Only the four researchers and the thesis adviser had access to the raw responses. Printed forms were kept in a locked cabinet accessible only to the researchers. Google Forms responses remained in Google Forms/Drive, were accessible only to the researchers, and were configured not to collect email addresses. Results were reported in aggregated or anonymized form; no respondent was named, quoted, or photographed without separate written permission. The research data are retained until the capstone is completed and the resulting paper is published in a reputable research journal, and then only for the period required by the University's records policy or the journal's data-availability policy, whichever is longer. After that, printed forms are shredded, Google Forms responses are deleted, and any research contact data in Supabase is deleted. The processing follows the Philippine Data Privacy Act of 2012 (RA 10173) and its Implementing Rules and Regulations, with consent as the lawful basis. The designated Data Protection Officer is Mr. Jeff Edrick C. Martinez, reachable at privacy@pakaonai.syntaxure.dev.

## Suggested insertion — Data Gathering Procedure

The current Data Gathering Procedure describes the pond sampling and grow-out phases but does not describe the respondent evaluation. Add a subsection such as:

> **Respondent evaluation.** After the field testing, 20 fish farmers and 10 IT professionals were invited to evaluate the PakaonAI web dashboard and feeder hardware using a questionnaire based on ISO/IEC 25010:2023. The questionnaire covered functionality, reliability, compatibility, security, usability, maintainability, efficiency, and portability. Respondents answered on printed paper or through Google Forms. Before answering, each respondent received the Research Information and Informed Consent Form and gave informed consent. The questionnaire collected an optional name, the date, the respondent's role (IT expert, hardware/electronics expert, agriculturist, or farm operator/field expert), and the evaluation responses. No email address, phone number, audio, video, photograph, or sensitive personal information was collected. Responses were used only for the capstone evaluation and were reported in aggregated or anonymized form.

## Suggested insertion — Scope and Limitation (optional)

If the panel asks about the human-participant scope, add:

> The evaluation covered 20 fish farmers and 10 IT professionals from the partner farm and the local aquaculture/IT community in Dingle, Iloilo. It did not include minors, sensitive personal information, clinical or veterinary trials, or a commercial production rollout. The results describe the pilot evaluation and are not a claim of commercial-scale performance.

## Where to put the files

- **Consent form (printed):** `docs/legal/research-information-and-consent.html` — print to A4, or use the Markdown version for copying into a Word document.
- **Consent form (Google Forms):** use the setup instructions in `docs/legal/research-information-and-consent.md`.
- **Privacy Policy:** `/privacy` (draft pending University Legal Office review).
- **Terms of Service:** `/terms` (draft pending University Legal Office review).

## Note for the defense

The paper currently says the respondents are 20 fish farmers and 10 IT professionals, but the Data Gathering Procedure does not explain how their data was collected or protected. Adding the two paragraphs above closes that gap and aligns the paper with the Privacy Policy and consent form. Do not claim that the University Legal Office has approved the documents until it actually has.
