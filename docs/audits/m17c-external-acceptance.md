# M17C — External acceptance handoff

Prepared on 2026-10-16. Status: **external acceptance pending; official clinical use blocked**.

This handoff assembles existing evidence. It is not an independent audit or authorization to process real patients.

## Freeze and scope

- Repository: `atpmktagencia/allik-one`, branch `feature/allik-patients`.
- Code candidate: `9f532b9d9b87e824cc811f5c5465057c24272f9e`.
- Verified Preview: `https://allik-etquy85tv-atp-mkt.vercel.app`, deployment `dpl_CdoxZEp5yHjCoKZhkMQUK3YT5XFf`.
- Intended use: real patients plus operational inventory, after all release gates pass.
- Record the full reviewed SHA in the report. This handoff may be committed after the code candidate; compare any intervening commits and explicitly identify documentation-only differences. Any subsequent application, migration or configuration change requires assessment against the reviewed scope.

Read `AGENTS.md`, README's “Runtime activation and external audit release gate”, and `docs/beta-production-release.md`. The release procedure remains authoritative for target identity and maintenance steps.

Use disposable synthetic databases. Do not mutate Production, read real clinical records, copy credentials into reports, send real messages, disable triggers or grant ownership to make tests pass. The Preview demonstration operator is intentional; verify that it cannot act as an individual clinical author or enter official access.

## Existing evidence and its limits

| Evidence                         | Recorded result                                                                                                                                                            | Limit                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Local unit/UI                    | 171 passed                                                                                                                                                                 | Synthetic execution, not independent acceptance             |
| Local PostgreSQL integration     | 213 passed; three runtime/tooling checks                                                                                                                                   | Disposable PostgreSQL                                       |
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
4. **Accounts and recovery:** immutable activated registry, normalized/inactive/concurrent duplicate prevention, holder-controlled single-use activation, Preview/integration account-write denial, login throttling without third-party global lockout, generic recovery responses for known/unknown accounts, slow headers and stalled JSON bounded, ambiguous tokens revoked, session/token race handling, fixed public origin and no raw token logging.
5. **Operations:** receiving, consumption, duplicate operations, concurrent updates and rollback with actual restricted credentials; migration locks/timeouts and edited/unknown/skipped history rejection; synthetic legacy migration and restore integrity.
6. **Deployment configuration:** verify the exact candidate's scoped runtime identity, disabled automatic seed/migration, no owner aliases or maintenance secret, and no Preview access flags in official configuration. Report inaccessible checks as unverified.

## Open decisions that require explicit disposition

| Item             | Current behavior                                           | Required report/release disposition                                                                                                  |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Printed identity | CPF/birth date present on all printed document types       | Assess minimum necessary disclosure; approve scope or specify a prospective correction without rewriting sealed historical bytes     |
| List access      | Patient/schedule list reads lack dedicated access audit    | Assess exposed fields and accountability requirements; accept with rationale or require audited disclosure                           |
| Invitations      | Invitation token returned to administrator                 | Assess holder identity/activation controls and token access; accept with rationale or require holder-only delivery                   |
| Delivery consent | REVOKED blocks sending; PENDING does not necessarily block | Define whether recorded affirmative consent is required and which channels/legal basis apply; verify implementation matches decision |

Do not label these resolved merely because regression tests pass. Record the accountable release owner's disposition and any required remediation. No formal legal/compliance certification is claimed by this repository.

## Required report format and acceptance

Provide the reviewed full SHA, environment and commands actually used, per-finding severity and file/line, reproducible synthetic steps, expected/actual behavior, impact, regression coverage, retest result, and inaccessible or unverified checks. Distinguish provider acceptance from inbox delivery, finalization from certified signing, and WhatsApp preparation from sending.

External acceptance requires:

- No unresolved release-blocking finding; every remaining finding has an explicit disposition by the accountable release owner.
- All four open decisions above addressed explicitly.
- Retest of original findings plus the callback and slow/stalled-provider regressions.
- Exact reviewed candidate and any later differences identified.
- Separate list of operational gates still pending, even if code review passes.

Audit outcome: **PENDING**. Reviewer identity/date: **PENDING**. Reviewed SHA: **PENDING**. Release-owner dispositions: **PENDING**.

## After audit acceptance

Proceed to operational homologation with individual synthetic identities, including the complete deployed clinical flow. A real recovery inbox test needs an explicitly designated recipient and authorized delivery. Then follow the official release procedure: fresh official recovery checkpoint/window, explicit migrations and restricted-role provisioning, official accounts, staged Production acceptance, controlled promotion and observation. No automatic promotion follows an audit pass.
