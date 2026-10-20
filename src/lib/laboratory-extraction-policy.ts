/** A bounded attempt. Retrying requires an explicit, versioned user action. */
export const LABORATORY_EXTRACTION_POLICY = {
  totalMilliseconds: 150_000,
  batchMilliseconds: 60_000,
  requestMilliseconds: 200_000,
  staleMilliseconds: 240_000,
  concurrency: 2,
  pagesPerBatch: 2,
  charactersPerBatch: 12_000,
  maxBatches: 12,
} as const;
