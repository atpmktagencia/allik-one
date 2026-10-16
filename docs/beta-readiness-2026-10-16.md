# Clinical beta preparation — 2026-10-16

Status: preparation and local verification completed; production rollout, actual invitation inbox delivery and full individual acceptance on the deployed Preview are not completed by this record.

## Release-owner decisions

- The owner accepts the A-1 administrator-held invitation risk and requests proceeding without another independent audit. This is a release-owner decision, not a technical fix or a positive independent security verdict. The external d1ffc26 report remains historically NOT APPROVED.
- Retain manual WhatsApp invitation links and single-use activation. Do not represent link possession as proof of professional identity.
- Start official access organization with the existing designated owner account only. Do not automatically import Preview users or grant new roles.
- Use printing and handwritten signatures for the beta. Certified VIDaaS/Lacuna signing is outside the selected beta scope. This record makes no legal determination that every document/prescription type is eligible for the chosen paper workflow.

## Verification and practical limits

| Work                  | Evidence                                                                                                                                                                                                                                                              | Remaining                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact f2c92b8 retest  | Detached worktree at `f2c92b8d48b245a722acda4739f32fecfe83dd7f`: 176 unit/UI, 224 PostgreSQL integration, three runtime checks, seven build guards, eight stock E2E, typecheck and production-bundle clinical/migration/local-restore scenario passed                 | Executed by this assistant, not an independent external auditor                                                                                                                                                       |
| Invitation email      | Preview key metadata and configured sender domain inspected without displaying credentials; server now emits only a static failure reason and exposes an actionable reason to the authorized administrator                                                            | Original provider outcome unknown; old logs expired. Actual new provider request and holder inbox delivery still need verification. An activated account cannot be reinvited                                          |
| Operational workflow  | Fresh production-bundle test with restricted SQL role and MANUSCRIPT mode passed individual login, unit/draft isolation, clinical finalization/printing/PDF/verification, unchanged frozen PDF after profile edit, password/session revocation, migration and restore | This is a local production bundle. Deployed Preview HTTP checks do not equal a complete individual browser acceptance. No connected interactive browser or authenticated POST connector was available in this session |
| Handwritten signature | New final snapshots record MANUSCRIPT when explicitly configured. Their prints include a professional signature line and paper-signing instructions. Certified provider is disabled in this mode                                                                      | The PDF does not prove someone physically signed the paper; the app does not mark it cryptographically signed. Prior snapshots/printed originals are preserved                                                        |

Invitation diagnostics distinguish missing configuration, invalid origin/key, unverified sender domain, test-recipient restrictions, forbidden access, throttling, provider outages, invalid responses, timeout and network failure. Provider messages, addresses, invitation secrets and API keys are not logged. Provider acceptance is not inbox delivery. The manual link remains usable after ambiguous delivery; the email may still arrive.

## Official access and infrastructure — read-only observations

| Item                      | Verified state                                                                                                         | Planned action                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel                    | Project `prj_DohoyOilRKl4kE0agAlL52kEcvb1`, team `team_NNwZrikjeKvWksjhWKK6iaRV`                                       | Keep Preview and Production scoped separately                                                                                                                                               |
| Official deployment       | `dpl_Dks1dBbZWMSeGjitvxWY5QjugWr2`, commit `4368887e819f181cccc600fa1c367fe7cd4b1aa4`, READY                           | Preserve until staged official acceptance and deliberate promotion                                                                                                                          |
| Official domains          | Deployment aliases `oi-companion-beta.vercel.app`, `allik-one-atp-mkt.vercel.app`                                      | Choose canonical official origin and reconfirm aliases at rollout; never derive recovery/invitation origin from request headers                                                             |
| Official database         | Non-secret Production NEON_PROJECT_ID confirmed `odd-grass-84765733`, branch `br-red-moon-b6p65ync`, database `neondb` | Explicit maintenance target; do not reuse the Preview maintenance URL                                                                                                                       |
| Migration checkpoint      | 13 applied through 0012; 48 pending through 0060                                                                       | Recheck history and hash integrity immediately before explicit maintenance                                                                                                                  |
| Official runtime identity | `allik_runtime` does not exist                                                                                         | Create a separate non-elevated SQL role during controlled maintenance, provision/check grants, authenticate as runtime                                                                      |
| Recovery                  | Provider history retention is 21600 seconds (six hours); no new official backup/restore was performed                  | Create and verify a fresh preserved official checkpoint before writes/migration; define write-stop, recovery and observation window. A code rollback does not restore data                  |
| Owner application account | Existing account active, password already set, active SUPER_ADMIN membership, zero per-unit links                      | Preserve account/role and global SUPER_ADMIN scope. Do not reset password or copy credentials. Complete/confirm clinical professional details only through the appropriate official process |
| Other official users      | Not requested in this step                                                                                             | Add only named holders, confirmed roles and units; no automatic synthetic data/user import                                                                                                  |

The owner account's Preview membership is PARTNER_ADMIN with two units; its stored registry state is OK and prescriber contact fields are present. These are application metadata checks, not external council/license verification. Preview profile details must not be copied automatically into official Production.

## Ready-to-review official configuration plan

These are planned names/settings, not applied Production changes:

- `INVENTORY_ENVIRONMENT=production`, `INVENTORY_RUNTIME_ROLE=allik_runtime`, `INVENTORY_PREPARE_PREVIEW=false`, `INVENTORY_ALLOW_SEED=false`.
- Runtime-only `DATABASE_URL` and reviewed database/user/password aliases. No `DATABASE_ADMIN_URL` or owner password in the deployment.
- `CLINICAL_SIGNATURE_MODE=MANUSCRIPT`; certified provider remains disabled. Paper signatures are applied by the responsible professional, not a pasted signature image.
- Official verified email sender, a separately scoped sending key, `AUTH_PUBLIC_ORIGIN` fixed to the chosen official HTTPS domain, explicit recovery/invitation enable flags only after actual delivery acceptance. Do not automatically copy the Preview key into Production.
- Preserve existing individual SUPER_ADMIN access; restrict other holders by organization/unit and retain the reviewed PARTNER_ADMIN boundaries.

## Controlled next steps

1. Deploy the tested new candidate to Preview only; verify pages and runtime metadata. Use synthetic records for clinical acceptance.
2. Reproduce a real invitation with an explicitly designated, still-unactivated test holder; read the safe provider result and confirm the inbox separately. If a sender/domain/permission change is required, use the provider account and reverify.
3. Complete the individual clinical browser acceptance on that deployed Preview and review a printed new document for handwritten signing. No real patient data should be introduced into the synthetic Preview.
4. Review the official target/configuration/access matrix above, maintenance timing and recovery procedure. Prepare a fresh official checkpoint, apply migrations and provision/check runtime only as explicit maintenance, not a build side effect.
5. Stage the official build without moving domains; verify the actual official environment and preserved account, then deliberately promote after operational acceptance. This preparation did not execute those production steps.

## New-candidate local validation

The manuscript-mode and safe-email-diagnostic changes passed 177 unit/UI tests, 230 PostgreSQL integration tests, three runtime/tooling checks, typecheck and lint (six preexisting Fast Refresh warnings). The updated production-bundle beta runner explicitly enables MANUSCRIPT and asserts paper-signature instructions in the rendered final, while retaining snapshot/PDF preservation, clinical isolation, migration and local restore checks. No new schema migration or new table grant is needed. Real provider delivery and a complete deployed individual browser flow are not established by these local results.

## Published Preview checkpoint

Code `df9b767400183de86769bf1abe7a6defc1acff87` deployed READY as `dpl_7MKDRriGyNxjupdVdw8dM77cJ4kS` at `https://allik-o2clgd91l-atp-mkt.vercel.app`. The branch-only MANUSCRIPT flag was configured before deployment. Access, Users, Patients and Agenda pages returned HTTP 200. This does not claim an authenticated clinical write/finalization browser flow on the deployed system. Production was reconfirmed unchanged at `dpl_Dks1dBbZWMSeGjitvxWY5QjugWr2` after publication. No real email, official migration, runtime-role creation or production environment/domain change was performed.
