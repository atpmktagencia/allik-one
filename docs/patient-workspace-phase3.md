# Patient Workspace — Phase 3: longitudinal laboratory results

## Existing architecture and additive view

The previous phase already stores immutable result rows, review snapshots, original PDF provenance, latest published review pointers and access audits. This phase reuses those entities. There is no new schema, migration, provider call, inferred test catalog or production mutation.

The Patient Workspace's Exames section now switches between Pedidos e arquivos and Histórico de resultados. Each preserves the patient's context; only one large table is visible at a time. History is shown only to clinical/private-data identities, with authorization enforced again by the backend. It is a dedicated wide reading surface rather than a narrow side panel.

## Data and permissions

GET laboratory-history accepts patientId, contextual unitId and optional dateFrom/dateTo and offset, rejecting duplicates, unknown parameters, invalid dates and reversed intervals. Every query enforces organization plus current and original unit scopes. Results must join the import's latest_review_id, immutable review, original document and matching source hash. An open draft correction continues to show the latest published revision; publishing the correction replaces that import's active observations without duplicating old rows.

The database applies period/scope filters before fetching 501 rows; the response contains at most 500 plus hasMore/offset. Offsets are bounded to 10,000 and the UI offers older/newer result pages, explicitly limiting comparisons to the current page; the cap directs users to a smaller period. The UI discloses truncation and offers period filters and paging for older subsets. Disclosure must be audited before returning values; audit failure returns no data. Finance/integration/anonymous demonstration actors cannot read history. The explicitly authorized synthetic Preview operator remains supported.

The response includes literal payload, stable observation/review/document IDs and a private application URL for the original. No Blob credential, public file URL or unnecessary patient fields are exposed. Patient-scoped React Query keys avoid placeholder results from a previous patient and refetch on entry. Opening a PDF requires its existing authorization again.

## Comparison rules

Rows group only the normalized spelling/casing/whitespace of an exam name plus exact unit, analytical method, material and laboratory. No clinical synonym matching or unit conversion. Different known metadata stays separate; missing metadata is labeled limited. No clinical category is guessed from free-text names. Curated hematology/metabolic/etc. classification remains a subsequent catalog decision.

Each date uses explicit collection date, otherwise explicit report date, with its basis indicated. Undated values remain in a separate column; upload, review or creation timestamps never become exam dates. Duplicate results on one date all remain visible, without averaging or silently replacing a value.

Numeric plotting accepts only unambiguous simple literals with comma or dot decimals. Censored/qualitative/scientific/grouped or ambiguous values such as <0,1, Não reagente, 1e3, 1.234 and 1,234 retain their original text but do not become numeric points. 0,955 is an unambiguous decimal. Lines require known, identical unit/method/material/laboratory and break at duplicated dates or nonnumeric observations. Unknown metadata permits individual dated numeric points without connecting them. These conservative rules favor missing a line over inventing comparability.

Each observation keeps its own laboratory reference. Only an entire simple numeric lower–upper interval is automatically classified below/within/above that interval. Textual, demographic, qualitative, one-sided or ambiguous references remain neutral. Color never signals a problem merely because a value changed. No universal ideal value, clinical decision limit or personalized target is created. Graph legends and associated values expose each original/reference; no universal reference band is inferred across changing intervals.

## UX and performance

Sticky header and exam column, plus unit/reference columns on desktop; horizontal scrolling stays inside the table on mobile. Search by parameter, server-side period filters, 12-date windows and progressive groups (50 at a time) avoid rendering a 500-by-500 empty matrix. Clicking an exam reveals an accessible SVG trend with dates, literal values, references and source links. No new chart dependency is introduced.

Changing periods rejects invalid ranges without displaying stale results as though they matched. Blank states distinguish no confirmed results from a search without matches. Original files, source review/correction workflows and commercial/stock functions remain independent.

## Verification scope

Automated fixtures are synthetic. Unit tests cover metadata separation, date precedence, duplicates/gaps, conservative numeric parsing and laboratory references. Backend tests cover tenant/finance/current-and-original-unit isolation, latest published versions during correction, bounded results, date filters and fail-closed audit. UI tests cover search, charts, original links, period errors and progressive windows. Browser verification extends the review flow into history on desktop/mobile, keeping a censored value literal and showing only the genuinely numeric point. Live provider extraction success reported by the owner belongs to Phase 2; this view performs no new inference.

## Verification record — 2026-10-19

401 unit tests and 362 disposable PostgreSQL integration tests passed; the final pagination backend scenarios passed 5/5 plus runtime provisioning 3/3. Focused history helper/UI checks passed 12/12. Typecheck and build passed; lint has no errors and retains six existing Fast Refresh warnings. The full restricted-role browser suite passed 17/17, including review → correction → latest confirmed history, censored values and numeric graph points on desktop/mobile. Screenshots were visually inspected. The disposable production-bundle scenario passed migration preservation, authentication/scopes, immutable PDFs, session revocation and backup/restore; this does not certify remote production recovery. The owner's current Preview extraction was observed READY_REVIEW without a published revision, so it correctly will not appear until confirmation. No production database/configuration mutation was performed.
