# M17C — External acceptance handoff

Prepared on 2026-10-16. Status: **external review NOT APPROVED; A-1 open; official clinical use blocked**.

This handoff assembles existing evidence. It is not an independent audit or authorization to process real patients.

## Freeze and scope

- Repository: `atpmktagencia/allik-one`, branch `feature/allik-patients`.
- Previously audited code candidate: `d1ffc26ed8828807acab48d97ad5f293ff572f3f`, including scoped PARTNER_ADMIN administration, invitation email/manual sharing and recorded-consent enforcement. Record the full reviewed branch HEAD and identify later documentation-only differences.
- Previously reviewed Preview: `https://allik-wlyus66kf-atp-mkt.vercel.app`, deployment `dpl_3PMnhmsRRmKA3fb3oQH8GZbvX5rr` at the previously audited code candidate.
- Intended use: real patients plus operational inventory, after all release gates pass.
- Record the full reviewed SHA in the report. This handoff may be committed after the code candidate; compare any intervening commits and explicitly identify documentation-only differences. Any subsequent application, migration or configuration change requires assessment against the reviewed scope.

Read `AGENTS.md`, README's “Runtime activation and external audit release gate”, and `docs/beta-production-release.md`. The release procedure remains authoritative for target identity and maintenance steps.

Use disposable synthetic databases. Do not mutate Production, read real clinical records, copy credentials into reports, send real messages, disable triggers or grant ownership to make tests pass. The Preview demonstration operator is intentional; verify that it cannot act as an individual clinical author or enter official access.

## Existing evidence and its limits

| Evidence                         | Recorded result                                                                                                                                                            | Limit                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Local unit/UI                    | 171 passed; subsequently expanded navigation suite: five passed                                                                                                            | Synthetic execution, not independent acceptance             |
| Local PostgreSQL integration     | 223 passed; three runtime/tooling checks                                                                                                                                   | Disposable PostgreSQL                                       |
| Build preparation/journal guards | Seven passed                                                                                                                                                               | No live migrations during builds                            |
| Inventory browser E2E            | Eight passed with restricted SQL role                                                                                                                                      | Local test deployment                                       |
| Production-bundle beta scenario  | Passed login, clinical isolation/finalization, migration `0012`→`0060` and local restore                                                                                   | Synthetic database and intercepted delivery                 |
| Typecheck/lint                   | Typecheck passed; six existing Fast Refresh lint warnings                                                                                                                  | No certification implied                                    |
| Deployed Preview                 | READY; access page and catalog HTTP 200                                                                                                                                    | Not full deployed clinical browser acceptance               |
| Preview database                 | 61 migrations through `0060`; 80 inventory tables, 43 append-only; restricted authenticated role checked; temporary-table creation denied; 28 function search paths pinned | Neon MCP equivalent SQL/checks; live local CLI not executed |
| Preview recovery                 | Isolated preserved-branch recovery checked; fresh pre-0060 recovery branch retained                                                                                        | No Production restore or arbitrary PITR test                |
| Official deployment              | Last checked unchanged at `dpl_Dks1dBbZWMSeGjitvxWY5QjugWr2`                                                                                                               | Reconfirm at rollout                                        |

Previous findings and remediations are described in the README. In particular, reproduce the temporary-table trigger bypass denial, callback-based connection guard and recovery response deadline. Provider acceptance and inbox delivery remain unverified. Certified signing remains the separate M17B gate.

## Required adversarial checks

1. **Database boundary:** owner aliases and maintenance credentials rejected in production mode; Promise and callback query/connect paths fail closed; valid concurrent runtime calls work; no TEMP/CREATE, ownership, memberships, replication-setting bypass, executable SECURITY DEFINER or migration-write grants. Try temporary-name shadowing against audit/balance triggers. Verify append-only enforcement and pinned paths after migration.
2. **Clinical authorization:** cross-organization/unit IDOR across reads, writes, print, PDF, verification, delivery and signing; other-author drafts excluded from quotes and summaries; allergies follow the patient appropriately; clinical problem editing remains unit-scoped; every disclosed private clinical record has the required access event.
3. **Clinical integrity:** finalized content immutable; rectified originals visibly superseded and refused for signing/delivery; finalized encounters cannot be canceled/no-show; frozen issuer/patient identity and document seals survive later profile edits; prescriptions do not imply administration or stock consumption.
4. **Accounts and recovery:** immutable activated registry, normalized/inactive/concurrent duplicate prevention, single-use activation and the unresolved A-1 administrator-impersonation risk, Preview/integration account-write denial, login throttling without third-party global lockout, generic recovery responses for known/unknown accounts, slow headers and stalled JSON bounded, ambiguous tokens revoked, session/token race handling, fixed public origin and no raw token logging.
5. **Operations:** receiving, consumption, duplicate operations, concurrent updates and rollback with actual restricted credentials; migration locks/timeouts and edited/unknown/skipped history rejection; synthetic legacy migration and restore integrity.
6. **Deployment configuration:** verify the exact candidate's scoped runtime identity, disabled automatic seed/migration, no owner aliases or maintenance secret, and no Preview access flags in official configuration. Report inaccessible checks as unverified.

## Release-owner decisions and remaining assessment

| Item             | Current behavior and owner decision                                                                                                                                                              | External assessment still required                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Printed identity | Owner requested complete available identity on prescriptions, including CPF/document and address; frozen historical documents remain unchanged                                                   | Verify canonical source and sealed bytes; assess minimum necessary identity on other document types                                                   |
| List access      | READ events are persisted before each authorized list disclosure; audit failure blocks response                                                                                                  | Retest actor/unit/organization boundaries and failure handling                                                                                        |
| Invitations      | Owner explicitly retained administrator-visible single-use links for manual WhatsApp sharing, in addition to holder email; owner reports successful manual-link activation but no received email | Assess administrator token access as an explicit exception; test link invalidation/single use and distinguish provider acceptance from inbox delivery |
| Delivery consent | Owner chose recorded consent: PENDING and REVOKED block email and WhatsApp preparation; existing general consent evidence is used                                                                | Retest enforcement; assess whether separate channel-specific evidence is necessary                                                                    |

Do not label these resolved merely because regression tests pass. Record the accountable release owner's disposition and any required remediation. No formal legal/compliance certification is claimed by this repository.

## Required report format and acceptance

Provide the reviewed full SHA, environment and commands actually used, per-finding severity and file/line, reproducible synthetic steps, expected/actual behavior, impact, regression coverage, retest result, and inaccessible or unverified checks. Distinguish provider acceptance from inbox delivery, finalization from certified signing, and WhatsApp preparation from sending.

External acceptance requires:

- No unresolved release-blocking finding; every remaining finding has an explicit disposition by the accountable release owner.
- All four items above assessed explicitly, including recorded owner decisions and remaining limitations.
- Retest of original findings plus the callback and slow/stalled-provider regressions.
- Exact reviewed candidate and any later differences identified.
- Separate list of operational gates still pending, even if code review passes.

Audit outcome for d1ffc26: **NOT APPROVED (A-1 blocking)**. Reviewer identity/date: **PENDING**. Reviewed SHA: **PENDING**. Release-owner decisions: **RECORDED ABOVE; independent assessment pending**.

## After audit acceptance

Proceed to operational homologation with individual synthetic identities, including the complete deployed clinical flow. A real recovery inbox test needs an explicitly designated recipient and authorized delivery. Then follow the official release procedure: fresh official recovery checkpoint/window, explicit migrations and restricted-role provisioning, official accounts, staged Production acceptance, controlled promotion and observation. No automatic promotion follows an audit pass.

## Follow-up: list access accountability

Patient lists and appointment lists now record authorized disclosures in the existing append-only clinical access table. Appointment patient-search results are included. A single atomic batch insert records patient/unit, optional appointment and actor identifiers with action READ, before the response is constructed. No search terms, names, phone numbers or clinical bodies are copied into events. Empty results create no patient access event; rejected authorization creates none. Persistence failures propagate before any list is returned. This requires no new migration or expanded runtime grants. Retest this change against the final SHA; earlier audit acceptance cannot cover it automatically.

Follow-up validation: 217 PostgreSQL integration tests and three runtime/tooling checks passed, including four new list-audit cases (authorized disclosure/unit denial, appointment/search disclosure, persistence failure on both endpoints and empty results). Typecheck passed; lint has only the six existing Fast Refresh warnings. A fresh production-bundle beta scenario passed with the restricted role, synthetic legacy migration and local backup/restore. Prior 171-unit/eight-E2E results belong to the preceding candidate and were not rerun for this server-only change.

Deployed verification on 2026-10-16: the exact `fcea75d` Preview was READY. Patient list returned HTTP 200 with one synthetic patient; appointment list returned HTTP 200 with four synthetic appointments and no patient-search results. Authenticated read-only Neon checks as `allik_runtime` observed access events increase from 114 to 119; the five latest events were READ events attributed to the Preview operator, matching the five disclosed records. No record contents or secrets were printed. The verification initially attempted an unsupported `max(uuid)` aggregate; the corrected read-only count/time-order query produced this evidence. Official deployment remained `dpl_Dks1dBbZWMSeGjitvxWY5QjugWr2`; no production mutation or real message was performed. This is deployed synthetic list verification, not individual clinical acceptance.

## Release-owner decisions and subsequent implementation — 2026-10-16

The release owner requested complete available CPF/address identification on prescriptions, recorded consent before sending, and holder email invitations with an administrator-visible link retained for manual WhatsApp sharing. This supersedes the earlier undecided entries for these specific behaviors. Prescriptions already use frozen canonical identity. Non-prescription identity minimization remains open to review. Consent gating uses the existing general consent record; per-channel consent evidence is not implemented. Invitations are not holder-only secrets while the administrator can share their links: this access was explicitly requested. Email acceptance is not inbox delivery; manual WhatsApp preparation is not a sent message. Retest the current full branch HEAD rather than relying on the previously frozen candidate.

Recovery was reported functioning by the release owner; do not infer the test environment or official-domain acceptance from that report alone. The new invitation delivery flow requires its own holder inbox acceptance. No real invitations were sent during local verification.

Verification of the consent/invitation implementation: 222 PostgreSQL integration tests and three runtime/tooling checks passed; typecheck passed and lint retains six existing Fast Refresh warnings. Tests use intercepted delivery, verify holder email, manual-link equivalence, reinvitation invalidation, single-use activation, disabled/unsafe email configuration, provider failure, and pending-consent denial for both email and WhatsApp. The production-bundle clinical/migration/local-restore scenario also passed. Existing prescription snapshot tests verify canonical patient identity and frozen print data. `AUTH_INVITES_ENABLED=true` was scoped only to the patients Preview branch; no Production environment variable was changed. Real invitation inbox delivery remains unverified.

The updated 171 unit/UI tests passed. The invitation UI tests additionally verify the new create/send action, manual WhatsApp link, email failure notice and continued link availability when clipboard access is denied. The reinvitation action is labeled “Reenviar convite”; it does not reset an activated user's password. No real mailbox acceptance is claimed.

## Authorized PARTNER_ADMIN delegation

The release owner explicitly authorized PARTNER_ADMIN user administration within their own units, with SUPER_ADMIN protected and no self-escalation. The policy now permits scoped administration and filters the account list. Mutations reject self-targets, SUPER_ADMIN, zero-unit targets, targets with any outside unit and accounts shared across organizations. Requested unit assignments must be nonempty and wholly within the caller's existing units. Update/reinvite/state changes recheck target scope while holding the user lock. Integration-credential and signing-identity administration remain SUPER_ADMIN-only. This changes authorization code, not existing memberships, and requires external review of the new final SHA.

Scoped administration validation: 223 PostgreSQL integration tests and three runtime/tooling checks passed, including allowed create/edit/state/reinvite operations, denial of outside-unit/empty-unit/SUPER_ADMIN grants, protected self/SUPER_ADMIN/mixed-unit/shared-organization targets, and filtered lists. The 171 existing unit/UI tests passed; the subsequently expanded navigation suite passed all five cases, confirming PARTNER_ADMIN sees Users but not Integrations, SUPER_ADMIN sees both and VIEWER sees neither. Typecheck and lint passed (six existing Fast Refresh warnings). The restricted-role production-bundle clinical/migration/local-restore scenario passed. Read-only Preview metadata confirmed the reported PARTNER_ADMIN account is active with two units; no memberships or account permissions were rewritten in the database. No real email was sent during verification. Official Production remains unchanged.

## M17C handoff checkpoint — 2026-10-16

The release owner confirmed that scoped PARTNER_ADMIN user creation now works and that the test account activated through the manually shared WhatsApp link. The invitation email was not received. These are owner-reported observations, not independently reproduced inbox or delivery evidence. Provider acceptance for that actual invitation is unknown; do not mark email delivery passed or assume a cause. The user authorized proceeding with M17C while this remains an operational delivery issue. Recovery was separately reported working; it must not be confused with invitation delivery.

Read-only deployment inspection reconfirmed the code candidate `d1ffc26ed8828807acab48d97ad5f293ff572f3f` READY at the Preview above, and official Production unchanged at `dpl_Dks1dBbZWMSeGjitvxWY5QjugWr2`, commit `4368887e819f181cccc600fa1c367fe7cd4b1aa4`. This handoff update changes documentation only. No further feature work or production promotion is part of the audit request. M17B provider homologation, actual invitation email delivery and official operational acceptance remain separate pending gates.

### Copyable auditor instruction

Review `atpmktagencia/allik-one`, branch `feature/allik-patients`, code candidate `d1ffc26ed8828807acab48d97ad5f293ff572f3f`. Read `AGENTS.md`, the README M17C release gate, this handoff and `docs/beta-production-release.md`. Record the full reviewed SHA and compare later commits; documentation-only handoff changes do not replace the code candidate. Perform a read-only source audit and adversarial reproduction on disposable synthetic databases, without using live credentials, production/Preview mutations or real messages. Do not edit the application during the initial review. Retest all required checks in this handoff, especially callbacks, temporary-table trigger bypass, recovery timing, scoped PARTNER_ADMIN administration, token/activation races, consent and clinical immutability/isolation. Report severity, file/line, synthetic reproduction, impact, missing tests, actual checks executed and unverified environmental gates. Assess the documented owner decisions rather than assuming they close technical risks. Manual-link activation succeeded according to the owner; invitation email was not received. Certified VIDaaS signing is not homologated. Return an explicit code-audit verdict and release-blocking findings; do not authorize official clinical use solely from passing tests.

## Follow-up after external report

See [external finding dispositions](m17c-review-d1ffc26-disposition.md). The owner explicitly declined an independent email confirmation while keeping the manual WhatsApp link. A-1 remains OPEN; it is not silently accepted for clinical release. Only SUPER_ADMIN may create/promote/manage PARTNER_ADMIN accounts after the follow-up. New tokens use cleared URL fragments, and invitation sends have per-token provider idempotency. The supplier E2E waits for network idle after reload. Review the new full branch HEAD for these code changes; the older d1ffc26 audit is not an approval of them. No production mutation is authorized by this record.

Follow-up local verification: 176 unit/UI tests, 224 integration tests, three runtime/tooling checks and eight E2E passed; typecheck/lint passed with six existing Fast Refresh warnings. New code needs independent retest; A-1 remains blocking and no production promotion was performed.
