# Official clinical beta — migration rehearsal

Status at rehearsal: database rehearsal passed; official rollout remained pending. The rehearsal did not change Production database, configuration or domains. For the subsequently authorized rollout, see [official deployment record](official-beta-deployment-2026-10-17.md).

Candidate: `36635a3b1e6e0084cbc06fbc91d2ff3c1ecca63f` (documentation after tested code `df9b767400183de86769bf1abe7a6defc1acff87`). Release-owner decisions and test limits remain in [beta readiness](beta-readiness-2026-10-16.md).

## Preserved checkpoint and isolated rehearsal

- Official source: Neon project `odd-grass-84765733`, branch `br-red-moon-b6p65ync`, database `neondb`.
- Recovery branch: `br-damp-dream-b623hmmh`, named `recovery/before-clinical-beta-36635a3`, created 2026-10-16 22:24:09 UTC, parent LSN `0/268C2D8`. Verified ready. Created without compute.
- Rehearsal branch: `br-quiet-band-b65j0gm8`, named `staging/clinical-beta-36635a3`, cloned from that checkpoint. Verified ready. This contains official data and must never be attached to synthetic Preview/demo access or published as a public test application.
- Data stayed inside Neon. Verification returned counts and digests only; no patient or inventory records were downloaded.

The checkpoint captures a point in time, not future writes. Before official maintenance, stop writers and create a fresh checkpoint. Existing provider history retention was six hours; do not rely on an indefinite PITR window. The preserved branch is not evidence of a completed official recovery drill.

## Rehearsal results

1. Confirmed all 13 original migration timestamps and hashes against the repository.
2. Applied the 48 pending migrations, 0013–0060, only to the rehearsal branch. Used one explicit Neon SQL transaction with repository statement breakpoints, the migration advisory lock, history locking, a five-second lock timeout and a fifteen-minute statement timeout. This was an MCP transaction equivalent, not execution of the local migration CLI.
3. Reached 61 applied migrations, latest timestamp `1794272400017`.
4. Compared all original columns of 34 legacy tables before/after using counts and deterministic digests: 34/34 unchanged, covering 1,222 original rows in aggregate.
5. Found zero invalid indexes, unvalidated constraints or inventory functions without a pinned execution path.
6. Created `allik_runtime` only on the rehearsal branch. Authenticated checks confirmed no elevated attributes, memberships, owned objects, schema/database creation, temporary-table creation permission, replication-setting permission, executable security-definer functions or migration-table write permission.
7. Checked grants on 80 inventory tables, including 43 append-only tables: zero incorrect table or sequence grants.

These checks establish migration and permission behavior on the isolated copy. They do not establish a complete deployed clinical workflow or actual email delivery.

## Remaining controlled rollout

1. Agree on the write-stop window; recheck source migration history, deployment and active writers. Preserve the existing owner account and password.
2. Create a fresh recovery checkpoint, then explicitly migrate the official database and provision/authenticate its separate runtime role. Do not reuse the Preview maintenance URL or rehearsal credentials.
3. Configure official runtime credentials, disable build-time migrations/seeds and demo login, set MANUSCRIPT signing and the canonical official origin. Keep email sending disabled until delivery is verified; manual invitation links remain the chosen workflow.
4. Prepare a production-configured deployment without reassigning official domains. The currently exposed deployment connector does not provide a verified skip-domain control. Do not assume that a Preview promotion or an unsupported API property preserves domain assignment or rebuilds with Production variables.
5. Validate individual login, units, clinical finalization, paper print, stock continuity and access boundaries; then deliberately move official traffic and monitor.
6. After acceptance and the agreed retention window, remove the real-data rehearsal branch. Retain the fresh recovery checkpoint according to the rollout recovery policy. A code rollback alone does not restore database contents or safely discard new clinical writes.

The A-1 manual-link identity risk remains accepted by the owner; it has not been technically corrected or independently approved. No additional users, signature provider or email trial is required to perform this preparation.
