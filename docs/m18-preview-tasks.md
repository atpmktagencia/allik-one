# M18A — Care team tasks in Preview

Scope: first incremental delivery of the team task center, exclusively in synthetic Preview. No official deployment promotion, Production migration, account creation or real message sending is part of this change.

## Holder workflow

- Open **Tarefas da equipe** in the navigation, or use the patient-page shortcut.
- In an encounter, the same panel fixes patient/appointment origin and suggests the entered return date when opening a new task. The holder confirms creation; clinical text is not copied and finalizing the note does not create a task automatically.
- Choose return scheduling, examinations follow-up, patient contact, document preparation or another operational task. Enter a deadline and optionally a responsible holder in the unit.
- Pending and in-progress tasks stay in the queue until an explicit completion/cancellation, with a recorded result. Reopen and edit with a reason; consult the history when needed.
- Filter by pending/state, assigned to me or overdue. Overdue is calculated from the São Paulo calendar. List and history pages contain at most 50 entries each.

No external reminders, email/WhatsApp notifications, recurrence, appointment-driven automatic completion or clinical content generation is included. These remain future increments. Team instructions must contain only operational information needed to perform the task.

## Access and integrity

GET/POST `/api/v1/inventory/care-tasks`: reads require `patients.read`; writes require an individual account with `patients.manage` and same-origin requests. Integrations are denied. The shared synthetic identity can read but cannot mutate tasks. Patient/organization/unit, source encounter and active assignee membership are checked server-side. No new application permission or role is granted.

Version checks and row locks prevent lost updates. The form retains its creation operation ID across retries; duplicate IDs cannot create another task. Task identity/origin is immutable and deletion is denied. Audit snapshots are inserted by a database trigger in the same transaction; history mutation/truncation is denied. Read disclosure is recorded before response. Audit payloads are not written into console logs.

After patient transfer, tasks retain the original unit. Reading, history and writing require authorization for both original and current patient units. A patient row lock protects mutation checks against concurrent transfers. Active pending work is not silently moved to another team.

## Preview maintenance

- Project `little-dust-61663559`, branch `br-winter-hill-b69uz195`, database `neondb`.
- Pre-change checkpoint: `br-mute-meadow-b64isy6a`, `recovery/preview-before-m18-tasks`, verified READY.
- Migration 0061 creates tasks/events, indexes, constraints and scope/audit triggers. It was explicitly applied with a verified 61-entry migration history; restricted role received CRUD on tasks and SELECT/INSERT only on history.
- Corrective migration 0062 preserves the already-applied 0061 hash and supports the reviewed patient-transfer behavior plus explicit truncation guards. No Production branch is a maintenance target.
- The retained official baseline is deployment `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp` and 61 migrations. Preview uses a separate endpoint and database role credential.

Testing and publication evidence are recorded after final checks. Disposable test identities and records are confined to local test databases; no holder registration is needed for acceptance in Preview.

## Completed checks

Final local verification: typecheck/build passed, lint has only the six existing Fast Refresh warnings, 177 unit/UI tests passed, 243 PostgreSQL integration tests passed (13 task scenarios), runtime tooling 3/3, and restricted-role browser E2E 9/9. The task browser scenario covers creation inside an encounter, persistence in the central queue, completion, reload, reopening and history. Cross-organization/unit access, assignee eligibility, duplicate submission, competing updates, transfer and immutable origin/history were exercised against disposable PostgreSQL.

Preview maintenance completed through 0062 (63 migrations). Authenticated SQL verification reports 82 inventory tables, two pinned new functions, both truncation guards and no history UPDATE/DELETE/TRUNCATE privilege. Production read-only recheck still reports 61 migrations and no care-task table. No Production role/configuration/domain changes were made.
