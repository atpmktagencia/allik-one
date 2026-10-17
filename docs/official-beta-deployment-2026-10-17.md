# Official clinical beta deployment — 2026-10-17

Status: official database migrated and production deployment promoted. Authorized by the owner after the maintenance/write-stop question. No application users, invitation emails or patient test records were created.

## Released candidate

- Commit: `091612549723e484d41bd3c984e877ddd19365e6`; application code unchanged from tested `df9b767400183de86769bf1abe7a6defc1acff87`.
- Production deployment: `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`, READY, production target, TanStack Start/Lovable, Node 24. Build phase approximately 20 seconds.
- Deployment URL: `https://allik-cz2dk6vej-atp-mkt.vercel.app`.
- Official domains: `https://oi-companion-beta.vercel.app` and `https://allik-one-atp-mkt.vercel.app`; both alias mappings verified to this deployment after deliberate promotion.
- Previous official deployment: `dpl_Dks1dBbZWMSeGjitvxWY5QjugWr2`, code `4368887e819f181cccc600fa1c367fe7cd4b1aa4`. A code rollback alone does not undo schema changes or preserve/reconcile later clinical writes.

## Maintenance and recovery

The project was paused for database maintenance; the official domain returned HTTP 503 with DEPLOYMENT_PAUSED, and zero other active database transactions were observed before migration. Fresh checkpoint `br-plain-unit-b6xyu3zb`, named `recovery/official-beta-0916125-20261017`, was created from official branch `br-red-moon-b6p65ync` in project `odd-grass-84765733` and verified READY. Parent LSN: `0/26AE940`; source timestamp 2026-10-17 14:07:50 UTC (11:07:50 America/Sao_Paulo). Keep this checkpoint; it does not contain subsequent writes and is not evidence of a completed production restore drill.

Rechecked the original 13 migration hashes/timestamps against the repository. Applied 48 pending migrations, 0013–0060, explicitly through a Neon transaction using the repository statement breakpoints, advisory transaction lock, history lock and target/history assertions; lock timeout five seconds, statement timeout fifteen minutes. No local CLI execution is claimed. Official history now contains 61 migrations, latest timestamp `1794272400017`.

Before/after counts and deterministic digests for all original columns of 34 tables matched exactly (1,222 rows in aggregate). This includes the existing owner password and membership data. Zero invalid indexes or unvalidated constraints were found. Record bodies were not exported.

Created a separate official `allik_runtime` role, with a new randomly generated secret stored as Vercel sensitive runtime configuration. Authenticated role checks passed: 80 inventory tables, 43 append-only; zero invalid table/sequence grants, role memberships, owned objects, elevated attributes, executable security-definer functions, unpinned inventory functions or migration-history write grants. Schema/database CREATE, TEMP and replication-setting permissions were denied. TEMP was revoked from PUBLIC and runtime, as required by the reviewed provisioning procedure. The session's Preview DATABASE_ADMIN_URL was not used for official maintenance or deployed.

## Configuration and traffic

Production-scoped runtime URLs, user/password/host/database aliases were replaced with the official restricted identity; no owner credential was copied into the new deployment. Build preparation, seeding and demo login are false. INVENTORY_ENVIRONMENT is production; CLINICAL_SIGNATURE_MODE is MANUSCRIPT. New paper documents use the reviewed handwritten-signature workflow, without a claim of certified digital signing.

AUTH_PUBLIC_ORIGIN is fixed to `https://oi-companion-beta.vercel.app`. AUTH_INVITES_ENABLED and AUTH_RECOVERY_ENABLED are false; Production has no configured Resend sending key. Email invitation and password recovery delivery remain unavailable until provider/inbox validation. Manual invitation links remain the owner's chosen workflow.

The first deployment request while the project was paused returned BLOCKED without build logs. It was not treated as success. After unpausing, automatic custom-domain assignment was explicitly disabled and a fresh production build succeeded. The provider nonetheless assigned the generated allik-one hostname and git-branch hostname when ready; therefore this was not a fully domain-isolated staging build. The canonical official hostname was deliberately promoted after HTTP checks. Automatic custom-domain assignment was restored afterward.

Restored the patients git-branch alias to synthetic Preview deployment `dpl_6Rs66HbTcQHT6DZjQ88bMsJB5HLV` and verified the mapping. Preview variables/database were not replaced with official credentials. Documentation pushes may create newer synthetic Preview deployments.

## Validation and remaining limits

- Production candidate and canonical official access page: HTTP 200.
- Unauthenticated session, patients and users endpoints on the candidate: HTTP 401. Canonical official session endpoint also returned 401. No shared demo identity was provided.
- Existing designated owner remained active with an active SUPER_ADMIN membership, a preserved password and global scope (zero per-unit links). No role promotion, password reset or Preview-profile import was performed.
- Initial deployment-scoped error/fatal runtime log query returned no groups. This is a short post-deploy observation, not a load test or proof of every clinical path. Ongoing monitoring/drain setup was not established by this step.
- Full authenticated browser login, clinical write/finalization/printing and inventory operation on the deployed official application remain for holder acceptance. Earlier automated production-bundle tests and database checks do not replace this deployed acceptance. No user password or fabricated privileged session was used.
- Actual email delivery, production restore/PITR drill, professional profile confirmation and eligibility of each document type for paper signing remain outside this deployment's evidence.

The owner's A-1 manual-link risk acceptance and independent-audit waiver remain in force. Deployment does not change the historical external negative verdict into approval or claim that A-1 was technically fixed.
