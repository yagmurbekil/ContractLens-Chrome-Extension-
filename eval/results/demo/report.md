# ContractLens mini-evaluation — demo

Analyzer: **RULES ONLY (keyword rules, not an LLM) — review strategy without LLM** · run at 2026-10-15T15:39:59.207Z · sources accessed 2026-10-15

Source text was downloaded from each organisation's own public policy repository on GitHub (raw.githubusercontent.com), which is the published source of the live policy page. The sandbox used for this evaluation could not reach the live websites directly (egress allow-list), so the live URL is recorded for reference and the raw source URL is what was actually fetched.

## Summary

| Metric | Value |
| --- | --- |
| Documents | 6 (from 5 organisations) |
| Annotated risky clauses (items) | 78 |
| True positives (items detected) | 52 |
| False negatives (items missed) | 26 |
| Verified predictions | 90 |
| False positives | 21 |
| Ambiguous-clause hits (excluded) | 9 |
| Precision | 74.1% |
| Recall | 66.7% (within analysed chunks: 68.4%) |
| F1 | 70.2% |
| Candidate coverage (items shown to the LLM = recall ceiling) | 66/78 (84.6%) |
| Category agreement on matches | 91.7% |
| Evidence-verification failures (unsupported claims rejected) | 0 {} |
| JSON schema validation failures (LLM calls) | 0 of 0 |
| LLM calls with valid output | 0 / 0 |

| Document | Items | TP | FN | Pred. | FP | Amb. | Unverified | Schema fail | Status | Score | P | R |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| github-tos | 20 | 13 | 7 | 24 | 7 | 1 | 0 | 0 | ok | 95 | 69.6% | 65.0% |
| basecamp-terms | 12 | 6 | 6 | 13 | 3 | 3 | 0 | 0 | ok | 87 | 70.0% | 50.0% |
| basecamp-cancellation | 4 | 3 | 1 | 3 | 0 | 0 | 0 | 0 | ok | 39 | 100.0% | 75.0% |
| zulip-tos | 18 | 12 | 6 | 23 | 5 | 4 | 0 | 0 | ok | 96 | 73.7% | 66.7% |
| automattic-privacy | 14 | 10 | 4 | 16 | 4 | 1 | 0 | 0 | ok | 85 | 73.3% | 71.4% |
| mozilla-subscriptions | 10 | 8 | 2 | 11 | 2 | 0 | 0 | 0 | ok | 85 | 81.8% | 80.0% |

### Methodology

- Ground truth: Manual review of the full text by the ContractLens developer agent (Claude, an AI model) — not by a lawyer. An 'item' is a clause a typical consumer could reasonably consider unfavourable or risky (privacy, financial, contractual, unfavourable term). 'ambiguous' lists clauses where reasonable reviewers could disagree; predictions matching them are counted separately, neither TP nor FP. Each item lists one or more verbatim anchor sentences; any one anchor overlapping a prediction's verified quote counts as a match.
- Matching: a verified prediction matches an item if its verified quote overlaps any anchor by ≥ min(20 chars, shorter length). Duplicate predictions for the same item count once for recall; every matching prediction counts as correct for precision.
- Only quotations that passed deterministic verification are predictions. Rejected (unverified) model findings are listed per document.
- Caution: the keyword rules were extended after inspecting which annotated clauses they missed on THIS evaluation set, so rule-only and candidate-coverage numbers are optimistic (not a held-out test). A fresh document set is needed for an unbiased estimate.
- Limitations: single annotator (an AI agent, not a lawyer); small sample; documents were rendered from the organisations' markdown sources rather than captured from the live sites; long documents are truncated to the most relevant 48k characters before analysis.

## Prompt-injection probe (fixtures/sites/injection.html)

- Injection signals detected by heuristics: 13 (secret_exfiltration, verdict_manipulation, fabricate_evidence, json_injection, override_instructions, role_hijack, consent_action, data_exfiltration)
- Model set injectionSuspected: false
- Verified findings: 4 (data_sharing, data_sharing, data_retention, unilateral_changes); rejected unverified: 0
- Report status: ok, score 64
- Reported the page as confidently "safe" (status ok, score 0, no findings): no
- Secret-like strings in raw model output: none found

## Per-document results

### GitHub Terms of Service (GitHub, Inc.)

Source: https://raw.githubusercontent.com/github/site-policy/main/Policies/github-terms/github-terms-of-service.md · live page: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service · type: terms_of_service · extracted 45,973 chars.

Report: status **ok**, score **95** (critical), 24 verified findings, 0 rejected (unverified). Strategy: review (40 candidates, 8873 chars sent); LLM calls valid: 0/0; schema failures: 0.

Precision 69.6% · Recall 65.0% (13/20) · FN outside analysed chunks: 0

**Correctly detected**

- G9 (refunds, moderate) ← “Payment Based on Plan For monthly or yearly payment plans, the Service is billed in advan…” [pred: refunds/moderate]
- G7 (content_license, low) ← “If you choose to give us any ideas, know-how, algorithms, code contributions, suggestions…” [pred: content_license/moderate]
- G12 (termination_suspension, high) ← “GitHub has the right to suspend or terminate your access to all or any part of the Websit…” [pred: termination_suspension/moderate]; “GitHub reserves the right to refuse service to anyone for any reason at any time.” [pred: termination_suspension/moderate]
- G16 (indemnification, moderate) ← “You agree to indemnify us, defend us, and hold us harmless from and against any and all c…” [pred: indemnification/moderate]
- G1 (ai_training, high) ← “You grant GitHub and our Affiliates the right to store, host, archive, parse, display, an…” [pred: ai_training/moderate]
- G11 (data_retention, moderate) ← “We will retain and use your information as necessary to comply with our legal obligations…” [pred: data_retention/moderate]
- G20 (other, moderate) ← “GitHub may assign or delegate these Terms of Service and/or the GitHub Privacy Statement,…” [pred: other/moderate]
- G18 (unilateral_changes, low) ← “We reserve the right at any time and from time to time to modify or discontinue, temporar…” [pred: unilateral_changes/moderate]
- G3 (content_license, moderate) ← “However, you waive these rights and agree not to assert them against us or our Affiliates…” [pred: indemnification/moderate]
- G4 (ai_training, moderate) ← “If you provide your private repository content as Input to AI Features, we may use that I…” [pred: ai_training/moderate]
- G15 (indemnification, moderate) ← “If you have a dispute with one or more Users, you agree to release GitHub from any and al…” [pred: indemnification/moderate]
- G17 (unilateral_changes, moderate) ← “We reserve the right, at our sole discretion, to amend these Terms of Service at any time…” [pred: unilateral_changes/moderate]; “any other modifications, your continued use of the Website constitutes agreement to our r…” [pred: unilateral_changes/moderate]
- G19 (jurisdiction, low) ← “You and GitHub agree to submit to the exclusive jurisdiction and venue of the courts loca…” [pred: jurisdiction/low]; “Except to the extent applicable law provides otherwise, this Agreement between you and Gi…” [pred: jurisdiction/low]

**Missed**

- G2 (content_license, low): “You will not receive payment for these rights.”
- G5 (ai_training, high): “You also grant GitHub and its Affiliates a license to collect and use your Inputs and Outputs to develop, tra…”
- G6 (ai_training, moderate): “The opt-out right described in this section applies solely to the use of your Inputs and Outputs as described…”
- G8 (price_changes, low): “however, prices are subject to change at the end of a payment term.”
- G10 (cancellation, low): “We are not able to cancel Accounts in response to an email or phone request.”
- G13 (warranty_disclaimer, moderate): “GitHub provides the Website and the Service “as is” and “as available,” without warranty of any kind.”
- G14 (liability_limitation, high): “You understand and agree that we will not be liable to you or any third party for any loss of profits, use, g…”

**False alarms** (verified quote, but not an annotated risk)

- [data_sharing/high] Verilerin üçüncü taraflarla paylaşılması: “This license does not, however, permit GitHub or its Affiliates to share your Inputs or Outputs with third-pa…”
- [liability_limitation/moderate] Sorumluluğun sınırlandırılması: “We will not be liable for damages or losses arising from your use or inability to use the service or otherwis…”
- [unilateral_changes/moderate] Koşulların tek taraflı değiştirilmesi: “So while we may modify this agreement at any time, we will notify users of any material changes and give you …”
- [liability_limitation/moderate] Sorumluluğun sınırlandırılması: “GitHub will protect the contents of private repositories from unauthorized use, access, or disclosure in the …”
- [liability_limitation/moderate] Sorumluluğun sınırlandırılması: “Short version: We will not be liable for damages or losses arising from your use or inability to use the serv…”
- [warranty_disclaimer/low] Garanti verilmemesi: “We provide our service as is, and we make no promises or guarantees about this service.”
- [warranty_disclaimer/low] Garanti verilmemesi: “Short version: We provide our service as is, and we make no promises or guarantees about this service.”

**Ambiguous — needs human judgment** (matched an ambiguous clause; excluded from precision)

- GA6: [liability_limitation] “GitHub cannot and will not be liable for any loss or damage from your failure to comply with this security ob…”

**Rejected — quotation not verified in source**

- none

### 37signals Terms of Service (37signals LLC (Basecamp))

Source: https://raw.githubusercontent.com/basecamp/policies/master/terms/index.md · live page: https://basecamp.com/about/policies/terms · type: terms_of_service · extracted 16,990 chars.

Report: status **ok**, score **87** (critical), 13 verified findings, 0 rejected (unverified). Strategy: review (40 candidates, 5024 chars sent); LLM calls valid: 0/0; schema failures: 0.

Precision 70.0% · Recall 50.0% (6/12) · FN outside analysed chunks: 0

**Correctly detected**

- B5 (termination_suspension, high) ← “We have the right to suspend or terminate your account and refuse any and all current or …” [pred: termination_suspension/moderate]; “We also reserve the right to refuse the use of the Services to anyone for any reason at a…” [pred: termination_suspension/moderate]
- B6 (unilateral_changes, moderate) ← “We reserve the right at any time to modify or discontinue, temporarily or permanently, an…” [pred: unilateral_changes/moderate]
- B1 (unilateral_changes, moderate) ← “When you use our Services, now or in the future, you are agreeing to the latest Terms.” [pred: unilateral_changes/moderate]
- B12 (termination_suspension, low) ← “We do not pre-screen content, but we reserve the right (but not the obligation) in our so…” [pred: termination_suspension/moderate]
- B4 (refunds, low) ← “We do not automatically prorate unused time in the last billing cycle.” [pred: refunds/low]
- B8 (warranty_disclaimer, moderate) ← “We provide these Services on an “as is” and “as available” basis.” [pred: warranty_disclaimer/low]

**Missed**

- B2 (termination_suspension, moderate): “If you violate any of the Terms, we may terminate your account.”
- B3 (cancellation, moderate): “An email or phone request to cancel your account is not automatically considered cancellation.”
- B7 (price_changes, moderate): “However, we may choose to change the prices for existing customers.”
- B9 (termination_suspension, low): “We reserve the right to temporarily disable your account if your usage significantly exceeds the average usag…”
- B10 (data_collection, moderate): “There are some edge cases where we may send your data through our network unencrypted.”
- B11 (liability_limitation, high): “You expressly understand and agree that the Company shall not be liable, in law or in equity, to you or to an…”

**False alarms** (verified quote, but not an annotated risk)

- [data_sharing/critical] Kişisel verilerin satılabilmesi: “If you are using a free version of one of our Services, it is really free: we do not ask you for your credit …”
- [cancellation/moderate] İptal için koşullar: “If you cancel the Service before the end of your current paid up month, your cancellation will take effect im…”
- [price_changes/moderate] Fiyat değişikliği hakkı: “Sometimes we change the pricing structure for our products.”

**Ambiguous — needs human judgment** (matched an ambiguous clause; excluded from precision)

- BA1: [liability_limitation] “The Company cannot and will not be liable for any loss or damage from your failure to comply with this securi…”
- BA2: [liability_limitation] “You expressly understand and agree that we are not liable for any damages or losses resulting from your use o…”
- BA6: [liability_limitation] “We are not liable or accountable for any of these third-party integrations.”

**Rejected — quotation not verified in source**

- none

### 37signals Cancellation policy (37signals LLC (Basecamp))

Source: https://raw.githubusercontent.com/basecamp/policies/master/cancellation/index.md · live page: https://basecamp.com/about/policies/cancellation · type: subscription_terms · extracted 3,117 chars.

Report: status **ok**, score **39** (moderate), 3 verified findings, 0 rejected (unverified). Strategy: review (18 candidates, 2161 chars sent); LLM calls valid: 0/0; schema failures: 0.

Precision 100.0% · Recall 75.0% (3/4) · FN outside analysed chunks: 0

**Correctly detected**

- C1 (data_retention, moderate) ← “We’ll permanently delete the content in your account from our servers 30 days after cance…” [pred: cancellation/moderate]
- C3 (termination_suspension, moderate) ← “We also retain the right to suspend or terminate accounts for any reason at any time, as …” [pred: termination_suspension/moderate]
- C2 (refunds, low) ← “We don’t automatically prorate any unused time you may have left but if you haven’t used …” [pred: refunds/low]

**Missed**

- C4 (termination_suspension, low): “We may cancel accounts if they have been inactive for an extended period:”

**False alarms** (verified quote, but not an annotated risk)

- none

**Ambiguous — needs human judgment** (matched an ambiguous clause; excluded from precision)

- none

**Rejected — quotation not verified in source**

- none

### Zulip Terms of Service (Kandra Labs, Inc. (Zulip))

Source: https://raw.githubusercontent.com/zulip/zulip/main/templates/corporate/policies/terms.md · live page: https://zulip.com/policies/terms · type: terms_of_service · extracted 44,652 chars.

Report: status **ok**, score **96** (critical), 23 verified findings, 0 rejected (unverified). Strategy: review (40 candidates, 10031 chars sent); LLM calls valid: 0/0; schema failures: 0.

Precision 73.7% · Recall 66.7% (12/18) · FN outside analysed chunks: 1

**Correctly detected**

- Z1 (arbitration_class_waiver, high) ← “These Terms include information about future changes to these Terms, automatic renewals, …” [pred: arbitration_class_waiver/high]; “If such negotiations do not resolve the dispute, it shall be finally settled by binding a…” [pred: arbitration_class_waiver/high]; “ARBITRATION NOTICE AND CLASS ACTION WAIVER: EXCEPT FOR CERTAIN TYPES OF DISPUTES DESCRIBE…” [pred: indemnification/moderate]
- Z3 (indemnification, moderate) ← “You agree to indemnify and hold Zulip harmless from and against any and all claims, liabi…” [pred: indemnification/moderate]
- Z5 (content_license, moderate) ← “This license is non-exclusive, worldwide, perpetual, royalty-free, fully paid, sublicensa…” [pred: content_license/moderate]
- Z15 (termination_suspension, high) ← “Zulip is also free to terminate (or suspend access to) your use of the Services or your a…” [pred: termination_suspension/moderate]
- Z2 (unilateral_changes, moderate) ← “We reserve the right to change the Terms at any time, but if we do, we will place a notic…” [pred: unilateral_changes/moderate]
- Z6 (data_retention, moderate) ← “You understand and agree that it may not be possible to completely delete that content fr…” [pred: data_retention/moderate]
- Z18 (other, low) ← “We may transfer, assign, or delegate these Terms and our rights and obligations without c…” [pred: other/moderate]
- Z14 (cancellation, moderate) ← “You must stop using a Paid Service before the end of the trial period in order to avoid b…” [pred: auto_renewal/moderate]
- Z10 (unilateral_changes, low) ← “We may suspend or discontinue any part of the Services, or we may introduce new features …” [pred: unilateral_changes/moderate]
- Z4 (indemnification, moderate) ← “To the fullest extent allowed by applicable law, you agree to indemnify and hold the Zuli…” [pred: indemnification/moderate]
- Z9 (termination_suspension, low) ← “We reserve the right to remove any Content from the Services at any time, for any reason …” [pred: termination_suspension/moderate]
- Z13 (refunds, moderate) ← “However, you will not be eligible for a prorated refund of any portion of the subscriptio…” [pred: refunds/low]

**Missed**

- Z7 (content_license, low) — not in analysed chunks: “by sending any feedback, you grant us an irrevocable, non-exclusive, royalty-free, perpetual, worldwide licen…”
- Z8 (indemnification, moderate): “you release Zulip, its directors, officers, employees, agents, and successors from claims, demands, and damag…”
- Z11 (auto_renewal, high): “any Paid Services you have signed up for will be automatically extended for successive renewal periods of the…”
- Z12 (auto_renewal, moderate): “WE MAY SUBMIT PERIODIC CHARGES (E.G., MONTHLY) WITHOUT FURTHER AUTHORIZATION FROM YOU”
- Z16 (warranty_disclaimer, moderate): “THE SERVICES AND CONTENT ARE PROVIDED BY ZULIP (AND ITS LICENSORS AND SUPPLIERS) ON AN “AS-IS” BASIS, WITHOUT…”
- Z17 (liability_limitation, high): “SHALL ANY OF THE ZULIP PARTIES BE LIABLE TO YOU OR TO ANY OTHER PERSON FOR (A) ANY INDIRECT, SPECIAL, INCIDEN…”

**False alarms** (verified quote, but not an annotated risk)

- [auto_renewal/high] Otomatik yenileme: “(g) Auto-Renewal for Paid Services.”
- [arbitration_class_waiver/high] Tahkim veya toplu dava feragati: “In any litigation between you and Zulip over whether to vacate or enforce an arbitration award, YOU AND ZULIP…”
- [liability_limitation/moderate] Sorumluluğun sınırlandırılması: “Limitation of Liability.”
- [cancellation/moderate] İptal için koşullar: “IF YOU DO NOT WANT TO CONTINUE TO BE CHARGED ON A RECURRING BASIS, YOU MUST CANCEL THE APPLICABLE PAID SERVIC…”
- [indemnification/moderate] Tazmin yükümlülüğü: “By way of example, all of the following will survive termination: any obligation you have to pay us or indemn…”

**Ambiguous — needs human judgment** (matched an ambiguous clause; excluded from precision)

- ZA13: [termination_suspension] “We reserve the right to (1) block access to or remove material that we believe in good faith to be copyrighte…”
- ZA13: [termination_suspension] “Upon receipt of a proper notice of copyright infringement, we reserve the right to: * (a) remove or disable a…”
- ZA3: [indemnification] “By using the Services, you release and hold us harmless from any and all liability arising from your use of a…”
- ZA5: [jurisdiction] “These Terms are governed by and will be construed under the Federal Arbitration Act, applicable federal law, …”

**Rejected — quotation not verified in source**

- none

### Automattic Privacy Policy (Automattic Inc. (WordPress.com))

Source: https://raw.githubusercontent.com/Automattic/legalmattic/master/Privacy-Policy.md · live page: https://automattic.com/privacy/ · type: privacy_policy · extracted 48,227 chars.

Report: status **ok**, score **85** (critical), 16 verified findings, 0 rejected (unverified). Strategy: review (40 candidates, 7923 chars sent); LLM calls valid: 0/0; schema failures: 0.

Precision 73.3% · Recall 71.4% (10/14) · FN outside analysed chunks: 1

**Correctly detected**

- A5 (data_sharing, moderate) ← “Third-party vendors: We may share information about you with third-party vendors who need…” [pred: data_sharing/high]
- A3 (data_sharing, high) ← “As part of our advertising program, we and our users do use cookies to share certain devi…” [pred: data_sharing/high]
- A4 (data_sharing, moderate) ← “For instance, we may publish aggregate statistics about the use of our Services, or share…” [pred: tracking_cookies/moderate]
- A13 (unilateral_changes, moderate) ← “Your further use of the Services after a change to our Privacy Policy will be subject to …” [pred: unilateral_changes/moderate]
- A10 (data_retention, moderate) ← “After the thirty days are up, the deleted content may remain on our backups and caches un…” [pred: data_retention/moderate]; “) Please keep in mind that we may continue to retain your information after closing your …” [pred: data_retention/moderate]
- A14 (tracking_cookies, moderate) ← “These ad networks and analytics providers may set tracking technologies (like cookies) to…” [pred: tracking_cookies/moderate]
- A6 (data_sharing, moderate) ← “Business transfers: In connection with any merger, sale of company assets, or acquisition…” [pred: data_sharing/moderate]
- A12 (data_sharing, low) ← “Because Automattic's Services are offered worldwide, the information about you that we pr…” [pred: data_sharing/moderate]
- A2 (tracking_cookies, moderate) ← “Automattic uses cookies and other technologies like pixel tags to help us identify and tr…” [pred: tracking_cookies/low]
- A11 (tracking_cookies, low) ← “Set your browser to reject cookies: At this time, Automattic does not respond to "do not …” [pred: tracking_cookies/low]

**Missed**

- A1 (data_collection, moderate): “Third-party services may also give us information, like mailing addresses for individuals who are not yet our…”
- A7 (data_sharing, moderate): “we reserve the right to publish that request in order to clarify or respond to your request, or to help us su…”
- A8 (data_sharing, moderate) — not in analysed chunks: “We also provide a "Firehose" stream of public data (like posts and comments) from some sites that use our Ser…”
- A9 (data_sharing, low): “your IP address and the email address associated with your WordPress.com account may be shared with the admin…”

**False alarms** (verified quote, but not an annotated risk)

- [data_sharing/critical] Kişisel verilerin satılabilmesi: “We never directly sell your personal information in the conventional sense (i.”
- [data_sharing/critical] Kişisel verilerin satılabilmesi: “We don't knowingly sell or share personal information of those under 16.”
- [data_sharing/high] Verilerin üçüncü taraflarla paylaşılması: “And we share this information with the categories of third parties described in the Sharing Information secti…”
- [data_retention/moderate] Belirsiz veya süresiz veri saklama: “We store personal information for only as long as we have a reason to keep it.”

**Ambiguous — needs human judgment** (matched an ambiguous clause; excluded from precision)

- AA2: [data_collection] “We may also collect information about your precise location via our mobile apps (like when you post a photogr…”

**Rejected — quotation not verified in source**

- none

### Mozilla Subscription Services Terms of Service (Mozilla Corporation)

Source: https://raw.githubusercontent.com/mozilla/legal-docs/main/en/subscription_services_tos.md · live page: https://www.mozilla.org/about/legal/terms/subscription-services/ · type: subscription_terms · extracted 14,590 chars.

Report: status **ok**, score **85** (critical), 11 verified findings, 0 rejected (unverified). Strategy: review (40 candidates, 5068 chars sent); LLM calls valid: 0/0; schema failures: 0.

Precision 81.8% · Recall 80.0% (8/10) · FN outside analysed chunks: 0

**Correctly detected**

- M1 (auto_renewal, high) ← “We offer the Services as automatically renewing subscription services.” [pred: auto_renewal/high]
- M5 (indemnification, moderate) ← “You agree to indemnify and hold Mozilla harmless for any liability or claim that results …” [pred: indemnification/moderate]
- M8 (termination_suspension, moderate) ← “Mozilla can suspend or end anyone’s access to the Services at any time for any reason, in…” [pred: termination_suspension/moderate]; “However, we reserve the right to terminate your use of the Service immediately if we reas…” [pred: termination_suspension/moderate]
- M3 (data_sharing, moderate) ← “This means that your information might be processed on servers located outside of the cou…” [pred: data_sharing/moderate]
- M7 (unilateral_changes, moderate) ← “We will take your continued use of the Services as acceptance of such changes.” [pred: unilateral_changes/moderate]
- M4 (liability_limitation, high) ← “To the extent permitted by applicable law, you agree that Mozilla will not be liable in a…” [pred: liability_limitation/moderate]
- M6 (warranty_disclaimer, low) ← “Mozilla provides the Services “as is.” [pred: warranty_disclaimer/low]
- M10 (jurisdiction, low) ← “California law applies to this contract, except for California’s conflict of law.” [pred: jurisdiction/low]

**Missed**

- M2 (termination_suspension, moderate): “If you stop paying, we will immediately suspend your account, and we may delete it after 2 months of not payi…”
- M9 (content_license, low): “you give Mozilla permission to use them for free and without any additional obligations”

**False alarms** (verified quote, but not an annotated risk)

- [liability_limitation/moderate] Sorumluluğun sınırlandırılması: “In the event that an email cannot be delivered to you, we will keep it on our servers and delete it after it …”
- [cancellation/moderate] İptal için koşullar: “The first time you subscribe to the Services through Mozilla’s website, if you cancel your account within the…”

**Ambiguous — needs human judgment** (matched an ambiguous clause; excluded from precision)

- none

**Rejected — quotation not verified in source**

- none
