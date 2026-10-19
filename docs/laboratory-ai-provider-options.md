# Laboratory PDF extraction: provider costs and verification strategy

Comparison checked on 2026-10-19. This is a proposed selection/evaluation plan, not an accuracy benchmark or an activated autonomous clinical workflow.

## Recommendation

Start a measured Preview evaluation with direct OpenAI GPT-6 Luna using the owner's existing API credits. Keep direct Gemini 3.8 Flash as a second candidate. OpenRouter is useful for a single account across models and provider routing; it does not itself make a model more accurate. Do not introduce automatic cross-provider fallback or two paid calls per PDF by default.

Current Standard text-token list prices (USD per million; no caching, regional premium or Batch):

| Path                                       | Input | Output | Purchase/platform considerations                                                              |
| ------------------------------------------ | ----: | -----: | --------------------------------------------------------------------------------------------- |
| Direct OpenAI / GPT-6 Luna                 | $0.10 |  $0.50 | Existing OpenAI API credits apply                                                             |
| Direct Google / Gemini 3.8 Flash           | $0.75 |  $3.75 | Introductory rates through 2026-12-31; Google lists $1.50/$7.50 from 2027-01-01               |
| OpenRouter / Gemini 3.8 Flash              | $0.75 |  $3.75 | Catalog inference rates; Standard credit purchases add 5.5%, subject to current payment terms |
| Existing Vercel Gateway / Gemini 3.8 Flash | $0.75 |  $3.75 | Verified live catalog; separate Vercel credit/authentication requirement                      |

Sources: [OpenAI model/pricing](https://developers.openai.com/api/docs/models/gpt-6-luna), [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [Google introductory rates](https://ai.google.dev/gemini-api/docs/latest-model), [OpenRouter model](https://openrouter.ai/google/gemini-3.8-flash), [OpenRouter plans](https://openrouter.ai/pricing).

Illustration only: 8,000 billed input tokens plus 2,000 billed output tokens per document gives $0.0018 for Luna or $0.0135 for Gemini; 1,000 documents cost $1.80 or $13.50 respectively. Buying $13.50 of Standard OpenRouter credits adds approximately $0.74 at 5.5%. Actual PDF image tokens, reasoning, larger verification prompts, retries, OCR, storage, payment minimums and taxes can change these figures. These are not per-page quotes. Two full identical-budget passes double model inference cost; they do not guarantee correctness. A 10% Gemini escalation on top of Luna would be about $3.15/1,000 documents under the same artificial token assumptions.

## Less manual work: staged extraction rather than blanket reprocessing

1. Preserve original PDF and SHA-256. Reuse completed extraction for that source instead of paying again on every view.
2. For digital PDFs, evaluate a local text/layout parser with per-page provenance. Text extraction has infrastructure cost but no model-token fee. Detect empty, broken or column-scrambled text; do not silently treat it as reliable.
3. Send usable text/layout to the economical structured extractor. For scanned/mixed/ambiguous pages, use PDF vision or OCR; preserve page and original snippets.
4. Deterministic checks compare literal numbers, inequality signs, units, references and dates to source evidence, detect duplicate rows and omissions where coverage can be established. Never infer a missing result or convert incompatible units automatically.
5. Escalate flagged pages/rows to an independent extraction using the original, preferably with a different model. A verifier must see source evidence, not only the first model's answer. Agreement is evidence, not proof; repeated same-model calls can reproduce correlated errors.
6. Present a compact exception list and retain bulk confirmation for checked rows. Keep source links and a final patient/result confirmation. Do not use model-reported confidence alone to publish clinical results.

Before reducing human review, evaluate de-identified/synthetic representative PDFs against a clinician-reviewed reference set: digital/scanned/multi-page/multi-column, qualitative results, inequality signs, decimal commas, multiple dates, units and methods. Measure per-field error and omission rates, unsupported rows, unresolved exceptions, correction time, p50/p95 latency and billed cost per document. Zero observed critical errors in a small set is not proof of zero risk. Automatic promotion to confirmed clinical data is outside this increment.

## Implemented provider boundary

The existing AI SDK adapter now accepts explicit `LAB_EXTRACTION_PROVIDER=gateway` (default) or `openai`. Direct OpenAI uses server-only `OPENAI_API_KEY`, `LAB_EXTRACTION_MODEL=openai/<verified model ID>`, Responses API and `store:false`. There is no automatic provider fallback, public credential or new integration table. Human confirmations, source hash, permissions, rate limits and immutable history remain unchanged. `store:false` does not promise zero provider retention; contractual/data-handling review remains part of release with real patients.

Only a SUPER_ADMIN in Preview may request the read-only `?providerStatus=true` probe. Gateway probes credits/authentication; direct OpenAI probes model access with GET. Neither performs inference or reads/sends a patient file. Responses expose fixed failure codes rather than provider bodies, tokens or PDFs. A successful probe does not certify generation, quota or extraction accuracy.

To activate direct OpenAI, add `OPENAI_API_KEY` as a sensitive server environment variable in the Vercel project, Preview only, branch `feature/allik-patients`; never paste it in chat. Then explicitly set provider/model and redeploy. A live synthetic PDF extraction must pass before claiming homologation. Do not alter Production.
