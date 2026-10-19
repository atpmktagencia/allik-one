# Patient Workspace — Phase 4: preconsultation questionnaires (in progress)

The repository already has configurable TEXT/CHOICE questions, draft/published model versions, invitation expiry/revocation, hashed bearer tokens, fragment links cleared before requests, one-time transactional submission, access-scoped professional review and document-center indexing. These services and tables are reused rather than creating a second questionnaire library.

This increment improves the patient-facing form: five optional questions per step, explicit step/answered counts, back/next navigation preserving answers only in memory, and an optional review showing unanswered questions before final submission. Earlier steps never submit partial answers; only the final send invokes the existing SUBMIT operation. Returning to questions preserves the draft. A new fragment clears previous answers/step/review; completion clears the token and answer state. No token or answer is placed in browser storage. Reload/close loses the unsent draft, which the interface explains. No automatic diagnosis, generated pre-anamnesis, patient portal or AI call is introduced.

No schema, backend permission, token lifetime or production change. Form versions already sent retain their original questions. All questions remain optional.

Acceptance checks: forward/back preserves answers, no partial network write, review displays omitted responses, optional blanks are accepted, submit remains one-time, professional can review, credentials are cleared from URLs and previous-link responses cannot overwrite the current form. Tests use only synthetic identities/documents and send no real messages.

Remaining within this milestone: conditional question configuration and matching backend validation, plus operator homologation of the published patient/professional flow. This increment alone does not close Phase 4.

The remaining main milestones are: (1) finish questionnaires; (2) operational homologation of the integrated Patient flow, including laboratory history; (3) official-release preparation with access restrictions, recovery/migrations/configuration and removal of shared Preview operator access before any production promotion. The presentation monitor and full patient portal remain separate future work.

Verification: all six public questionnaire UI tests passed, including URL/StrictMode/link-change protections and multi-step state. The disposable PostgreSQL/restricted-role browser scenario passed template publication → seven-question mobile form → back/next/review → single submission → replay denied → clinician reads one answer and six explicit blanks. Typecheck/build passed; lint retains six baseline Fast Refresh warnings with no errors. Mobile screenshot was visually inspected. No live invitation or message was sent.
