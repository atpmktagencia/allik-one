# Patient Workspace — source evidence and exception-focused laboratory review

This increment follows the successful real OpenAI extraction reported by the owner. It reduces review friction without silently publishing clinical results or adding a second paid model request. It does not implement longitudinal charts or a patient portal.

## Independent text boundary

After an explicit AI extraction, the server parses the already-authorized, SHA-256-verified PDF using unpdf 1.9.0 / serverless PDF.js. The parser does not invoke OCR or an external service. It adds about 2.1 MB uncompressed / 0.56 MB gzip to the server bundle; it is not imported into the client. This dependency enables independent source-text evidence and avoids native canvas/system executables in Vercel.

Limits: 4 MiB input, 100 pages, 200,000 text characters and an 8-second cooperative deadline. Pages are processed sequentially and parser resources destroyed. A timer shares the event loop and is not a CPU-isolation guarantee. Partial/invalid/oversized/no-text parsing returns unavailable, never false proof. Original bytes are copied before parser transfer and remain unchanged. A scan still goes to the existing PDF-capable AI extractor, but has no independent text match and stays outside batch review.

The literal checker compares the model's source excerpt to the stated page's independently extracted text. Within that excerpt it checks test name, literal result, unit and reference when present, preserving decimal separators, inequalities, signs, case-sensitive units and exponents. Name casing and whitespace/Unicode composition receive only typographic normalization. Missing evidence, disagreement and provider uncertainty require individual attention. Evidence supplied only by the same model is explicitly distinguished from independent source text.

**A literal match is not clinical validation.** It cannot establish patient identity, completeness, correct column association, dates, method compatibility or interpretation. The same number can occur in a reference column. The UI states these limits and requires the professional to compare the original before using batch confirmation. No model confidence score or universal clinical target is invented.

## Persistence and authorization

No migration, new table or production database change. Only bounded check statuses/issues, parser status and page count are added to metadata of the existing immutable EXTRACTION_READY event. No additional PDF text, evidence excerpt or result values are duplicated in metadata. The immutable provider draft remains unchanged.

The authorized read returns checks only when each current draft row still matches the immutable extracted row, excluding only the human verified flag. Local edits immediately invalidate eligibility; saved edits are checked again on the server. Filtering keeps original row indices. Existing organization/current-and-original-unit authorization, clinical read audit, version locks, idempotency and explicit patient/row confirmation remain required.

## Professional workflow

The review pane shows total results, confirmed rows and rows needing individual attention. Filters: Todos / Atenção individual / Não conferidos. Visible row labels show page and source issues without opening every expanded editor. Batch confirmation includes only complete, unambiguous rows whose evidence is independently located; it preserves existing individual confirmations and never confirms patient identity automatically. Manual rows and unmatched evidence remain individually reviewable. Changing a field clears its previous human confirmation. Historical versions remain read-only.

Existing extractions made before this release have no stored independent checks and remain manually reviewable; opening them does not trigger a new paid extraction. New checks are created on subsequent explicit extractions. This increment does not rebuild old immutable extraction snapshots.

## Cost and next evaluation

Exactly one existing AI request per extraction; parsing/checking adds local CPU/memory only. Automatic cross-provider retries, second-model escalation and text-only replacement of PDF vision are not enabled. Those need an evaluated reference set before claiming lower total cost or clinical error rates. See [provider costs and proposed evaluation](laboratory-ai-provider-options.md).

Acceptance: model output stays unconfirmed; only server-derived independent evidence qualifies for batch; ambiguous/manual rows stay out; editing invalidates evidence; filter indices remain stable; prior versions and permission isolation remain intact. Test fixtures use synthetic PDFs and mocked paid boundaries; live extraction success reported by the owner is separate evidence.

## Verification record

389 unit tests and 357 disposable PostgreSQL integration tests passed, plus runtime provisioning 3/3. The four review UI scenarios also passed after the final pending-filter correction. Typecheck and production bundle build passed; lint has no errors and the six existing Fast Refresh warnings. A separate read-only agent review found no new concrete authorization, history or batch-selection issue. These results do not claim accuracy on a representative laboratory corpus or replace clinical review.
