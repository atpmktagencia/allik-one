# Official beta: real patients and inventory

Status on 2026-10-15: preparation and synthetic verification completed; the re-audit findings for `39b5584` are integrated into `feature/allik-patients`, together with follow-up fixes for callback runtime access and slow recovery delivery (see the README section "Re-audit remediation of `39b5584`"); production promotion remains pending the gates below. No production migrations, account changes, environment changes or deployment were performed during this preparation. This document is repository release documentation, not an independent security audit.

## Targets and baseline

| Target                       | Verified baseline                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                   | `atpmktagencia/allik-one`, branch `feature/allik-patients`; record the final full HEAD SHA for the auditor and release operator.                                                                                                                                                                                                   |
| Preview                      | Neon project `little-dust-61663559`, branch `br-winter-hill-b69uz195` (`preview/feature/allik-patients`), database `neondb`; 61 migrations through `0060`; migration and equivalent runtime grant reapplication completed in an authenticated Neon transaction. TEMPORARY is denied and all 28 functions have pinned search paths. |
| Preview runtime              | `allik_runtime`; no elevated attributes, memberships, object ownership, schema/database CREATE, replication-setting bypass or executable SECURITY DEFINER functions. 80 inventory tables, 43 append-only.                                                                                                                          |
| Preview recovery checkpoint  | `recovery/m17c-before-runtime-e414dd6`, branch `br-proud-sea-b6ih80s0`, LSN `0/2F957B0`, provider checkpoint `2026-10-15T19:54:55Z`; branch READY, without a compute. Its state was preserved before runtime activation. Recovery into an isolated provider branch was verified as described below.                                |
| Official Vercel project      | `prj_DohoyOilRKl4kE0agAlL52kEcvb1`, team `team_NNwZrikjeKvWksjhWKK6iaRV`.                                                                                                                                                                                                                                                          |
| Official database mapping    | Read the Production-scoped non-secret `NEON_PROJECT_ID`; it identifies `odd-grass-84765733` (`allik-inventory-pilot`), branch `br-red-moon-b6p65ync`. Do not substitute the other project's `main`.                                                                                                                                |
| Official database checkpoint | Read-only catalog/history inspection found 13 migrations, through `0012`, timestamp `1791417600000`; all 13 hashes match the repository. No `allik_runtime` role exists there. The clinical candidate needs 48 further migrations (`0013`–`0060`; `0060` was added by the re-audit remediation).                                   |
| Official recovery window     | Provider metadata reports `history_retention_seconds=21600` (six hours). Reconfirm immediately before rollout; this is configuration evidence, not a restoration test.                                                                                                                                                             |
| Existing official deployment | `dpl_Dks1dBbZWMSeGjitvxWY5QjugWr2`, commit `4368887e819f181cccc600fa1c367fe7cd4b1aa4`, READY, Production. Reconfirm the live domain mapping before rollout.                                                                                                                                                                        |

Only migration hashes/checkpoints and provider metadata were read from the official database. No patient or inventory record values were copied to local tests.

## Fixes and repeatable verification

1. Individual login previously had no shared attempt limit. It now uses atomic PostgreSQL counters per trusted platform IP (100/hour) and failure-only account counters per normalized email and IP (10/hour) and per email (50/hour). Keys are SHA-256 hashes; a rejected attempt creates no session. Five integration cases cover usable sessions, email normalization, concurrent attempts, cross-email spraying and oversized inputs.
2. Receiving a purchase under restricted credentials previously failed because `FOR NO KEY UPDATE` on the append-only purchase header requires UPDATE privileges. Deliveries now serialize by purchase using `pg_advisory_xact_lock`; the mutable supplier is locked separately. The conditional received-quantity update and transaction rollback remain in place. Grants on immutable history remain SELECT/INSERT only.
3. Inventory browser tests now run with the restricted database login, so this regression is covered by the actual partial/full receipt and supplier-order flows.

Commands run against disposable local PostgreSQL only:

```sh
npm run test:preview-guard
npm run typecheck
npm run lint
npm run test
npm run test:integration:local
npm run test:e2e:local
npm run test:beta:local
```

Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if Chromium is supplied by the environment rather than Playwright's browser cache. Docker must be available through the local socket. CI installs Playwright Chromium. The beta runner generates its own passwords and never accepts an external database target. It builds with no database/provider sending credentials, and the served application receives only its restricted local URL with `INVENTORY_ENVIRONMENT=production`.

Observed results: 169 unit/UI tests, 196 PostgreSQL integration tests, three runtime/tooling checks, seven build-preparation/journal guards, eight inventory browser E2E, plus the production-bundle beta scenario. Typecheck passes; lint has six existing Fast Refresh warnings. The beta scenario verifies:

- Real browser login with individual synthetic credentials; no shared or automatic Preview identity in production mode; unit-scoped session.
- Other-author draft privacy; foreign-unit clinical read/print/source-PDF denial.
- Draft save, finalization, print, source PDF and internal verification; finalized-content rewrite denial.
- Duplicate professional registration denial; audited administrative profile update; the finalized PDF stays byte-identical after the current issuer profile changes.
- Password change invalidates the old password/session; login with the new password works; logout invalidates the session.
- Synthetic legacy `0012` migration followed by all pending migrations preserves preexisting movements and balances.
- Local `pg_dump`/`pg_restore` preserves the finalized snapshot and every migration record (61 through `0060`).

Re-audit remediation, re-run on disposable local PostgreSQL 16 against the remediated candidate: 171 unit/UI tests, 213 PostgreSQL integration tests, three runtime/tooling checks, seven build-preparation/journal guards, eight inventory browser E2E with the restricted role, and the production-bundle beta scenario all pass. The production bundle served in official mode (restricted role, intercepted email provider) also passed:

- Recovery: identical response and time (about 2.5 s) for existing and unknown accounts, also with a 900 ms provider delay. Additional integration tests verify a 3.4-second provider and a stalled JSON body: a two-second request-wide delivery budget aborts the attempt and revokes its token before the generic 2.5-second response; the holder may need to retry; one email to the holder only, with an idempotency key; link origin fixed to `AUTH_PUBLIC_ORIGIN` despite forged forwarding headers; token in the URL fragment and stored only as a hash; reset revokes sessions and the old password; links are single-use; at most three emails per account per hour; `AUTH_RECOVERY_ENABLED` other than `true` answers 503 without sending.
- Accounts: single-use invitation activation (link possession only; external A-1 disproves exclusive holder control), no login before activation, registry duplicates rejected across formats, unit isolation, shared login refused, logout revokes the session, authentication events recorded.
- Configuration: an owner identity, a missing `INVENTORY_RUNTIME_ROLE` or a present `DATABASE_ADMIN_URL` each fail closed with `INVENTORY_RUNTIME_ROLE_REJECTED` and no session is created.
- Migration rehearsal `0012`→`0060` in production mode: 48 pending applied in about two seconds on synthetic data; a concurrent second run waited on the advisory lock and found nothing pending; 32 of 34 legacy tables are byte-identical on their original columns, and the two differences are the intended `0054` revocation of a stale invite for an activated account and its audit event; no `NOT VALID` constraints, disabled triggers, invalid indexes or unpinned functions; the restricted role verifies and cannot create temporary tables; restoring the pre-migration dump returns exactly to the `0012` snapshot.

These local tests use intercepted delivery and disposable credentials. Real provider acceptance and inbox delivery remain unverified; live Preview configuration checks are recorded separately below.

These are local/reproducible checks, not proof of a full browser flow on the deployed candidate or a production/provider restore. Messages are never sent by this verification.

### Neon checkpoint recovery rehearsal

The provider-side rehearsal created `rehearsal/m17c-recovery-ec049e4` (`br-flat-frost-b6966y0k`) directly from the preserved recovery branch, not from current Preview or either production branch. Neon reported READY with the exact parent LSN `0/2F957B0` and timestamp `2026-10-15T19:54:55Z`. Read-only validation on the recovered branch found all 60 migration records, nine movements, nine balances, zero ledger/balance mismatches, five document seals with zero integrity mismatches, and 114 clinical access events. The absence of `allik_runtime` matched the checkpoint taken before role activation.

This exercises recovery from a preserved branch checkpoint in Neon. It does not claim a snapshot restore, arbitrary timestamp/PITR restore, production data restore, or an application cutover. Neon's snapshot API refused the non-root source branch, so the documented preserved-branch recovery path was used. The initial request to set a suspend interval was rejected by the account before branch creation; the retry used provider defaults. The rehearsal compute was suspended after validation; recovery branches were retained for review.

The verified code candidate `ec049e49e1aa50d1b6955c449685c17fd2dc3162` deployed as Preview `dpl_3nT3PMpkEz2SRbw5AzzR3syBN2w9`, READY at `https://allik-m910jvgy3-atp-mkt.vercel.app`. Its access page and product catalog endpoint both returned HTTP 200. This HTTP check does not replace the deployed individual clinical acceptance flow.

### Preview hardening after follow-up verification

Before applying `0060`, Neon preserved `recovery/m17c-before-0060` (`br-patient-paper-b6f6d6j5`) at parent LSN `0/3018620`. An explicitly targeted transaction on `br-winter-hill-b69uz195` applied the repository migration under the migration advisory lock, checked the previous 60-entry history, and recorded hash `37281c1ebedde5bd04d3228882c34ec0f3360de3df3d2a9d72cc9a6512fb8f3a` at timestamp `1794272400017`. The same transaction reapplied runtime grants and revoked TEMPORARY from PUBLIC and the runtime role.

Authenticated checks as `allik_runtime` verified 80 inventory tables, 43 append-only tables, zero invalid table/sequence grants, zero migration-write grants, zero elevated attributes/memberships/ownership, and no CREATE, TEMPORARY, replication-setting bypass or executable SECURITY DEFINER functions. All 28 inventory functions have pinned search paths. An actual temporary-table creation was denied. Movement/audit/access counts and the aggregate digest of five document seals were unchanged. This was equivalent SQL application and checking through Neon MCP; the live local CLI was not executed because executor TCP was unavailable. Production was not modified.

The [external acceptance handoff](audits/m17c-external-acceptance.md) freezes the code candidate, assembles evidence and lists unresolved policy decisions. External acceptance is pending.

## Gates before official clinical use

| Gate                        | Required evidence                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent re-audit        | Review the final full SHA using the scope in the README release gate; reproduce findings on synthetic/disposable databases. Resolve release-blocking findings. This preparation is not that audit.                                                                                                                                            |
| Provider recovery rehearsal | Isolated synthetic checkpoint recovery passed in Neon. Before official maintenance, preserve a fresh official checkpoint/backup and agree on a recovery window covering maintenance and observation, recovery procedure and stop-write criteria. Production restore and PITR were not exercised. Do not assume a code rollback restores data. |
| Official runtime separation | A separate maintenance process explicitly migrates the verified official database, creates a non-elevated runtime role by SQL, applies/checks grants, and checks a real authenticated runtime connection. No owner credentials remain in the candidate deployment, including integration aliases.                                             |
| Individual accounts         | Authorized operator confirms real users, organizational/unit roles, professional registration, issuer contact information and holder-controlled activation. Do not import synthetic patients or change existing roles automatically.                                                                                                          |
| Recovery email              | Configure server-only verified sender and least-privilege sending key, `AUTH_RECOVERY_ENABLED` and the exact HTTPS `AUTH_PUBLIC_ORIGIN` for the official domain. Verify provider acceptance and the holder's inbox separately through an explicitly authorized real delivery.                                                                 |
| Candidate verification      | Test the staged Production build with the exact official runtime configuration; confirm domain/origin, login/logout, unit isolation, account edit, clinical draft/final/print/history, receiving/consumption and rollback. Use designated synthetic records only where explicitly permitted; avoid altering real histories to test.           |
| Signing and delivery scope  | Finalization/printing are not certified signing. Lacuna/VIDaaS/BirdID homologation remains M17B. Keep unavailable provider features disabled; do not advertise certified signing or actual WhatsApp sending without evidence.                                                                                                                 |

## Controlled rollout procedure

1. Record final commit, current official deployment and domains, branch/database identity, migration history, environment variable names/scopes and recovery checkpoint. Obtain the independent audit outcome. Recheck active writers and define a maintenance window before applying the 48 pending migrations.
2. Establish and verify recoverability before database changes. If a rehearsal needs official data, arrange the authorized controlled environment separately; the local runner intentionally uses synthetic data only.
3. Use the official maintenance connection only in its secure runner. Never reuse this session's Preview `DATABASE_ADMIN_URL` for production. Do not invoke seed, supplier imports, bootstrap, password resets or reconciliation as part of a build or migration.
4. Apply pending migrations explicitly with `INVENTORY_ENVIRONMENT=production npm run db:migrate` from the maintenance runner; it must report `Applied: 13. Pending: 48.` for the official database, and stops on unknown, edited or skipped migrations or on a lock wait over five seconds. Preserve ownership and ledger/audit history. Create the official runtime account directly by SQL with non-elevated attributes, not the Neon API's administrative defaults. Apply and check table/sequence grants with `node scripts/provision-runtime-role.mjs --apply` and `--check` (this revokes `TEMPORARY` on the database from `PUBLIC` and the role), then authenticate as runtime and run `db:check-runtime` or the documented authenticated Neon equivalent. If the role is created by hand, also run `REVOKE TEMPORARY ON DATABASE <db> FROM PUBLIC` and from the role, or the application will refuse the connection. Stop on any failure.
5. Prepare the exact candidate environment: `INVENTORY_ENVIRONMENT=production`; `INVENTORY_RUNTIME_ROLE` naming the runtime role; seed/build preparation false; runtime `DATABASE_URL`; explicitly scoped user/password/unpooled aliases; no `DATABASE_ADMIN_URL` or maintenance password. Keep Preview auto-login/classification flags out of official access. Configure stable recovery/signature origins only for enabled capabilities.
6. Stage a Production deployment without assigning the official domains. A Preview promotion may rebuild with different variables; validate the actual staged Production build. Run the designated acceptance checks, then explicitly promote only after the gates pass.
7. Observe authentication failures, application/API errors, clinical access auditing, stock transaction errors and provider delivery outcomes. Record who can stop the beta and how users are notified through the existing operational process.

## Return procedure

Before accepting new writes, distinguish a code-only issue from a database/configuration issue. Stop writes for integrity incidents and preserve the affected branch. A Vercel rollback changes code only; new schemas, credentials and data remain. Do not point the old inventory-only code at migrated data without a compatibility check. For data recovery, recover into a separate branch at the recorded checkpoint, validate migrations, balances versus movement ledger, clinical snapshots/seals and access history, then explicitly switch the connection after reconciliation. Never reset the patients Preview from its unrelated `main` parent as a shortcut.

For the earlier Preview activation, remove only the new `feature/allik-patients` overrides to restore inherited configuration for future deployments; never delete shared or Production entries. The keys were `INVENTORY_PREPARE_PREVIEW`, `INVENTORY_ALLOW_SEED`, `INVENTORY_ENVIRONMENT`, `INVENTORY_RUNTIME_ROLE`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NO_SSL`, `PGUSER`, `POSTGRES_USER`, `PGPASSWORD`, `POSTGRES_PASSWORD`, `PGHOST`, `PGHOST_UNPOOLED`, `POSTGRES_HOST`, `PGDATABASE` and `POSTGRES_DATABASE`. URL/password aliases use restricted values; `POSTGRES_URL_NO_SSL` is disabled. The original working Preview URL is `https://allik-qnixt6sfs-atp-mkt.vercel.app`; it uses the previous configuration and is not proof of runtime separation.

## Follow-up list-access hardening

The candidate after `5574d73` adds pre-disclosure READ auditing for patient lists, appointment lists and appointment patient-search results using existing append-only grants. Empty lists create no event; failed persistence blocks disclosure. This supersedes the earlier code candidate for external acceptance. Real provider/inbox checks and official rollout gates remain pending; production was not modified.

## M17C candidate frozen for external review

On 2026-10-16, candidate `d1ffc26ed8828807acab48d97ad5f293ff572f3f` was reconfirmed READY in Preview at `https://allik-wlyus66kf-atp-mkt.vercel.app`. The release owner reported successful PARTNER_ADMIN account creation and activation via the manual WhatsApp invitation link, but did not receive the invitation email. Invitation email delivery remains pending and provider acceptance for that request is unverified. The owner requested continuing the independent M17C review; no production rollout is implied. Use the updated [external handoff](audits/m17c-external-acceptance.md) and its copyable audit instruction. Official deployment and database were not modified by this handoff preparation.

## External audit disposition — release still blocked

The external audit of `d1ffc26` returned NOT APPROVED. See the [finding dispositions](audits/m17c-review-d1ffc26-disposition.md). A-1 remains open by explicit owner choice to keep manual invitation links without another confirmation factor. No new candidate is authorized for official clinical use. A-2, B-1, B-2 and provider idempotency have follow-up changes requiring independent retest. The real invitation email delivery problem remains unverified; manual link activation does not close it.

## Latest owner-directed preparation

The owner accepted the manual-invitation A-1 risk, waived another independent audit and chose printed documents with handwritten signatures instead of VIDaaS for the beta. The external negative verdict remains historical evidence, not a positive audit. The [2026-10-16 readiness/access plan](beta-readiness-2026-10-16.md) is the current operational preparation record, including read-only official account/target checks and the explicit configuration/maintenance plan. Official migration, runtime provisioning, staging, domain promotion and full deployed acceptance have not been performed by that preparation.
