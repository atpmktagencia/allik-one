# Official beta: real patients and inventory

Status on 2026-10-15: preparation and synthetic verification completed; production promotion remains pending the gates below. No production migrations, account changes, environment changes or deployment were performed during this preparation. This document is repository release documentation, not an independent security audit.

## Targets and baseline

| Target                       | Verified baseline                                                                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                   | `atpmktagencia/allik-one`, branch `feature/allik-patients`; record the final full HEAD SHA for the auditor and release operator.                                                                                                                               |
| Preview                      | Neon project `little-dust-61663559`, branch `br-winter-hill-b69uz195` (`preview/feature/allik-patients`), database `neondb`; 60 migrations through `0059`.                                                                                                     |
| Preview runtime              | `allik_runtime`; no elevated attributes, memberships, object ownership, schema/database CREATE, replication-setting bypass or executable SECURITY DEFINER functions. 80 inventory tables, 43 append-only.                                                      |
| Preview recovery checkpoint  | `recovery/m17c-before-runtime-e414dd6`, branch `br-proud-sea-b6ih80s0`, LSN `0/2F957B0`, provider checkpoint `2026-10-15T19:54:55Z`; branch READY, without a compute. Its state was preserved before runtime activation. A provider restore was not exercised. |
| Official Vercel project      | `prj_DohoyOilRKl4kE0agAlL52kEcvb1`, team `team_NNwZrikjeKvWksjhWKK6iaRV`.                                                                                                                                                                                      |
| Official database mapping    | Read the Production-scoped non-secret `NEON_PROJECT_ID`; it identifies `odd-grass-84765733` (`allik-inventory-pilot`), branch `br-red-moon-b6p65ync`. Do not substitute the other project's `main`.                                                            |
| Official database checkpoint | Read-only catalog/history inspection found 13 migrations, through `0012`, timestamp `1791417600000`; all 13 hashes match the repository. No `allik_runtime` role exists there. The clinical candidate needs 47 further migrations.                             |
| Official recovery window     | Provider metadata reports `history_retention_seconds=21600` (six hours). Reconfirm immediately before rollout; this is configuration evidence, not a restoration test.                                                                                         |
| Existing official deployment | `dpl_Dks1dBbZWMSeGjitvxWY5QjugWr2`, commit `4368887e819f181cccc600fa1c367fe7cd4b1aa4`, READY, Production. Reconfirm the live domain mapping before rollout.                                                                                                    |

Only migration hashes/checkpoints and provider metadata were read from the official database. No patient or inventory record values were copied to local tests.

## Fixes and repeatable verification

1. Individual login previously had no shared attempt limit. It now uses atomic PostgreSQL counters per normalized email (10/hour) and trusted platform IP (100/hour). Keys are SHA-256 hashes; a rejected attempt creates no session. Five integration cases cover usable sessions, email normalization, concurrent attempts, cross-email spraying and oversized inputs.
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
- Local `pg_dump`/`pg_restore` preserves the finalized snapshot and all 60 migration records.

These are local/reproducible checks, not proof of a full browser flow on the deployed candidate or a production/provider restore. Messages are never sent by this verification.

## Gates before official clinical use

| Gate                        | Required evidence                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent re-audit        | Review the final full SHA using the scope in the README release gate; reproduce findings on synthetic/disposable databases. Resolve release-blocking findings. This preparation is not that audit.                                                                                                                                  |
| Provider recovery rehearsal | Preserve a checkpoint/backup with a recovery window covering maintenance and observation. Exercise recovery in an isolated synthetic branch, then agree on the official database recovery procedure and stop-write criteria. Do not assume a code rollback restores data.                                                           |
| Official runtime separation | A separate maintenance process explicitly migrates the verified official database, creates a non-elevated runtime role by SQL, applies/checks grants, and checks a real authenticated runtime connection. No owner credentials remain in the candidate deployment, including integration aliases.                                   |
| Individual accounts         | Authorized operator confirms real users, organizational/unit roles, professional registration, issuer contact information and holder-controlled activation. Do not import synthetic patients or change existing roles automatically.                                                                                                |
| Recovery email              | Configure server-only verified sender and least-privilege sending key, `AUTH_RECOVERY_ENABLED` and the exact HTTPS `AUTH_PUBLIC_ORIGIN` for the official domain. Verify provider acceptance and the holder's inbox separately through an explicitly authorized real delivery.                                                       |
| Candidate verification      | Test the staged Production build with the exact official runtime configuration; confirm domain/origin, login/logout, unit isolation, account edit, clinical draft/final/print/history, receiving/consumption and rollback. Use designated synthetic records only where explicitly permitted; avoid altering real histories to test. |
| Signing and delivery scope  | Finalization/printing are not certified signing. Lacuna/VIDaaS/BirdID homologation remains M17B. Keep unavailable provider features disabled; do not advertise certified signing or actual WhatsApp sending without evidence.                                                                                                       |

## Controlled rollout procedure

1. Record final commit, current official deployment and domains, branch/database identity, migration history, environment variable names/scopes and recovery checkpoint. Obtain the independent audit outcome. Recheck active writers and define a maintenance window before applying the 47 pending migrations.
2. Establish and verify recoverability before database changes. If a rehearsal needs official data, arrange the authorized controlled environment separately; the local runner intentionally uses synthetic data only.
3. Use the official maintenance connection only in its secure runner. Never reuse this session's Preview `DATABASE_ADMIN_URL` for production. Do not invoke seed, supplier imports, bootstrap, password resets or reconciliation as part of a build or migration.
4. Apply pending migrations explicitly; preserve ownership and ledger/audit history. Create the official runtime account directly by SQL with non-elevated attributes, not the Neon API's administrative defaults. Apply and check table/sequence grants, then authenticate as runtime and run `db:check-runtime` or the documented authenticated Neon equivalent. Stop on any failure.
5. Prepare the exact candidate environment: `INVENTORY_ENVIRONMENT=production`; seed/build preparation false; runtime `DATABASE_URL`; explicitly scoped user/password/unpooled aliases; no `DATABASE_ADMIN_URL` or maintenance password. Keep Preview auto-login/classification flags out of official access. Configure stable recovery/signature origins only for enabled capabilities.
6. Stage a Production deployment without assigning the official domains. A Preview promotion may rebuild with different variables; validate the actual staged Production build. Run the designated acceptance checks, then explicitly promote only after the gates pass.
7. Observe authentication failures, application/API errors, clinical access auditing, stock transaction errors and provider delivery outcomes. Record who can stop the beta and how users are notified through the existing operational process.

## Return procedure

Before accepting new writes, distinguish a code-only issue from a database/configuration issue. Stop writes for integrity incidents and preserve the affected branch. A Vercel rollback changes code only; new schemas, credentials and data remain. Do not point the old inventory-only code at migrated data without a compatibility check. For data recovery, recover into a separate branch at the recorded checkpoint, validate migrations, balances versus movement ledger, clinical snapshots/seals and access history, then explicitly switch the connection after reconciliation. Never reset the patients Preview from its unrelated `main` parent as a shortcut.

For the earlier Preview activation, remove only the new `feature/allik-patients` overrides to restore inherited configuration for future deployments; never delete shared or Production entries. The keys were `INVENTORY_PREPARE_PREVIEW`, `INVENTORY_ALLOW_SEED`, `INVENTORY_ENVIRONMENT`, `INVENTORY_RUNTIME_ROLE`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NO_SSL`, `PGUSER`, `POSTGRES_USER`, `PGPASSWORD`, `POSTGRES_PASSWORD`, `PGHOST`, `PGHOST_UNPOOLED`, `POSTGRES_HOST`, `PGDATABASE` and `POSTGRES_DATABASE`. URL/password aliases use restricted values; `POSTGRES_URL_NO_SSL` is disabled. The original working Preview URL is `https://allik-qnixt6sfs-atp-mkt.vercel.app`; it uses the previous configuration and is not proof of runtime separation.
