# M19A — Preconsultation questionnaires in Preview

Scope: questionnaire preparation and optional patient-reported intake, exclusively in synthetic Preview. Backend, frontend and test/security work were delegated to three agents and integrated/reviewed by the primary agent. This is implementation/testing evidence, not an independent external audit or a production release.

## Workflow

- **Pré-consultas** (`/pre-consultas`) lets an authorized individual prepare a unit-specific questionnaire, edit its draft and publish an immutable version. Questions support text or a single choice; all patient answers are optional. Reusable questionnaires must not contain patient-identifying information.
- A manual invitation is generated for a selected patient, optionally bound to an encounter, with validity from one to fourteen days. Staff can copy the link once and revoke an invitation. The draft and actually published title/version are distinguished when choosing what to send.
- The public page (`/preconsulta#token=...`) exposes only the published questionnaire. It does not disclose the patient's name, contact details, clinical record or prior answers. After one submission, the link cannot retrieve or change those answers.
- Questions left unanswered remain empty and display as **Não informado** to the clinician. Literal responses are preserved; no negative history, diagnosis, summary or clinical note is inferred.
- The patient and encounter pages link to/include the intake panel. An encounter shows its own invitations and general questionnaires for the same patient; questionnaires tied to a different encounter are excluded from that filtered view.
- Received answers are labeled as patient-reported through a link, without independent identity verification. They remain separate from clinical evolution and finalized documents.

No AI, audio recording, email delivery, automatic WhatsApp sending, automatic clinical import or new holder registration is included. The response viewer requires an individual with private-patient read permission; operational staff see invitation status without answer content.

## Access and preservation

GET/POST `/api/v1/inventory/preconsultation` are scoped to organization and unit. Management requires an individual with `patients.manage`; integration identities and the shared synthetic identity cannot manage invitations/forms. Answer disclosure additionally requires `patients.private.read` and persists read audit before returning data. Original invitation unit and current patient unit are both checked after transfer. Unused public links are unavailable while the patient no longer belongs to the invitation's unit.

Public POST `/api/v1/inventory/preconsultation-public` accepts READ/SUBMIT with the bearer token in its body; GET is not used to carry credentials. The backend validates the token independently of any application session, exact request origin, bounded request body and shared rate counters. It serializes submit/revoke operations using database locks. Unknown, expired, revoked and consumed tokens do not reveal questionnaire/answer content.

Only the token hash is persisted. The browser removes the fragment immediately, keeps the token and unsent answers only in component memory and clears them on submission or a new link. Changing invitations cancels old requests and prevents stale results from mixing questionnaires. Same-origin cookies may be sent for the hosting platform's access protection; they do not grant intake access in the public handler. No token/answer persistence in localStorage/sessionStorage, external referrer or telemetry was added.

Published versions and submitted responses are append-only with UPDATE/DELETE/TRUNCATE protections. Database triggers bind version, patient, organization, unit and encounter origins, preserve invitation expiry/origin and prevent undoing revocation/submission. A failed clinical read audit blocks disclosure. This first increment records form/invitation creators, version publisher and submission/revocation times; it does not yet provide a full actor/event history for every draft edit and revocation.

Staff lists show at most 100 recent models/invitations, with the limit disclosed in the UI and patient/unit filters available. New raw links are shown only after issuance; ambiguous retries preserve the creation operation ID to prevent duplicate invitation records.

## Preview boundary

Preview remains protected by Vercel Authentication. A patient without access to the protected deployment cannot use the Preview link as an unrestricted external service. Do not disable project protection or append a platform bypass secret to patient links. The local end-to-end test uses a separate unauthenticated browser context to verify application-level public submission; it is not evidence of external recipient access through Vercel protection.

The production deployment and database remain outside this release. No sensitive production data is copied into test fixtures. Production activation and external recipient acceptance require a later controlled release.

## Maintenance plan

Explicit target: Neon project `little-dust-61663559`, branch `br-winter-hill-b69uz195`, database `neondb`. Preserve/check its 63 existing migration hashes before applying `0063_preconsultation_intake`. The migration adds four tables and pinned scope/immutability triggers; the runtime role receives CRUD for draft forms/operational invitations and SELECT/INSERT only for published versions/responses. Never run maintenance during a build or reuse the official database as a test target.

## Verified implementation and Preview maintenance

Typecheck, production build and lint passed (only the six existing Fast Refresh warnings). Final local suites passed 182 unit/UI tests, 253 PostgreSQL integration tests, runtime checks 3/3 and browser E2E 10/10 using the restricted SQL identity. New coverage includes optional/prototype-name question IDs, literal/omitted answers, single-use concurrent submission, expired/revoked links, immutable snapshots, organization/unit/encounter isolation, general questionnaires appearing in the encounter, read auditing, secret clearing, new-link/stale-request races and StrictMode mounting. These checks were performed by the assistant/agents, not an external auditor.

The provider refused a fresh checkpoint branch with `branches limit exceeded`; snapshot creation was also unavailable for the child branch. No existing branch or backup was deleted to work around these limits. Existing recovery branches were retained; none is represented as a fresh M19 checkpoint. The additive migration was explicitly applied in one transaction after verifying all 63 existing hashes, without modifying existing application records.

Preview now has 64 migrations through 0063. Authenticated runtime checks confirmed operational grants for forms/invitations, append-only grants for versions/responses, denied history mutation/TEMP and a pinned validation function. No raw connection credential, patient report or invitation token was printed during maintenance.
