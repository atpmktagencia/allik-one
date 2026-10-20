/** Moderator-only offline scoring. Human files require explicit authorization;
 * automated rehearsals are rejected, never turned into participant observations.
 * npx tsx scripts/laboratory-study/report.ts --human-authorized moderator.json P01.json [...]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { laboratoryRobustnessCases } from "../../src/test/fixtures/laboratory-robustness";
import { evaluateLaboratoryRobustness } from "../../src/lib/laboratory-robustness-evaluation";
import { laboratoryDraft } from "../../src/lib/laboratory-results";
import type { StudyEvent } from "./runtime";

const [authorization, moderatorPath, ...paths] = process.argv.slice(2);
assert.equal(
  authorization,
  "--human-authorized",
  "Human scoring needs the moderator's authorization.",
);
assert(
  moderatorPath && paths.length > 0,
  "Supply moderator manifest and actual participant exports.",
);
const manifest = JSON.parse(await readFile(moderatorPath, "utf8"));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const participantIds = new Set<string>();
const observations = [];
for (const path of paths) {
  const file = JSON.parse(await readFile(path, "utf8"));
  assert.equal(
    file.participantKind,
    "human_declared",
    "AUTOMATED_OR_UNVERIFIED_PARTICIPANT_REJECTED",
  );
  assert.equal(file.syntheticOnly, true);
  assert.equal(file.clinicalRequestsSent, 0);
  assert(/^P0[1-8]$/.test(file.participantId));
  assert(
    !participantIds.has(file.participantId),
    "Duplicate participant export; do not pool reruns.",
  );
  participantIds.add(file.participantId);
  assert.deepEqual(file.build, manifest.build, "Study build/reference mismatch.");
  assert(file.tasks.length > 0 && file.tasks.length <= 6);
  const tasks = new Set<string>();
  for (const task of file.tasks) {
    assert(!tasks.has(task.taskId));
    tasks.add(task.taskId);
    const specimen = laboratoryRobustnessCases.find((c) => c.id === task.caseId);
    assert(specimen);
    assert.deepEqual(
      { caseId: task.caseId, pdfSha256: task.pdfSha256, captureSha256: task.captureSha256 },
      manifest.taskSources[task.taskId],
    );
    const variant =
      task.outputOrigin === "historical_real_inference"
        ? "real"
        : task.outputOrigin === "controlled_usability_mutation"
          ? "controlled"
          : null;
    assert(variant);
    const original = laboratoryDraft.parse(manifest.initialDrafts[task.taskId]?.[variant]);
    assert.equal(hash(original), task.variantSha256, "Input variant provenance mismatch.");
    assert(Number.isFinite(task.totalMs) && task.totalMs >= 0 && task.totalMs <= 9 * 60 * 1000);
    assert(["A", "B"].includes(task.condition));
    assert(
      Number.isInteger(task.evidenceDifficulty) &&
        task.evidenceDifficulty >= 1 &&
        task.evidenceDifficulty <= 7,
    );
    assert(Number.isInteger(task.confidence) && task.confidence >= 1 && task.confidence <= 7);
    const final = laboratoryDraft.parse(task.finalDraft);
    const reference = {
      rows: specimen.reference.map((r) => r.row),
      unresolved: specimen.expectedUnresolved ?? [],
    };
    const before = evaluateLaboratoryRobustness(reference, original.rows);
    const after = evaluateLaboratoryRobustness(reference, final.rows);
    const events = task.events as StudyEvent[];
    const started = events.findIndex((e) => e.event === "task_start");
    assert(started >= 0);
    const during = events.slice(started).filter((e) => e.relativeMs <= task.totalMs);
    const actionEvents = new Set([
      "control_click",
      "filter_change",
      "bulk_confirm",
      "line_add",
      "line_remove",
      "individual_confirm",
      "identity_confirm",
      "details_open",
      "field_edit",
      "original_open",
      "original_page_change",
      "zoom",
      "rotate",
      "problem_perceived",
      "evidence_located",
      "help_request",
      "individual_condition_bulk_blocked",
    ]);
    observations.push({
      participantId: file.participantId,
      sequence: file.sequence,
      taskId: task.taskId,
      caseId: task.caseId,
      condition: task.condition,
      outputOrigin: task.outputOrigin,
      totalMilliseconds: task.totalMs,
      censored: task.censored,
      actions: during.filter((e) => actionEvents.has(e.event) && e.origin !== "technical").length,
      assignedModeAdherence:
        task.condition === "A"
          ? !during.some((e) => e.event === "bulk_confirm")
          : during.some((e) => e.event === "filter_change" && e.control === "Atenção individual"),
      firstEvidenceDeclaredMilliseconds:
        during.find((e) => e.event === "evidence_located")?.relativeMs ?? null,
      explicitProblemMarks: during.filter((e) => e.event === "problem_perceived"),
      evidenceDifficulty: task.evidenceDifficulty,
      confidence: task.confidence,
      initialEvaluation: before,
      finalEvaluation: after,
      moderatorConfirmedPerceivedErrors: null,
      moderatorConfirmedUnperceivedErrors: null,
      requiresModeratorAdjudication: true,
    });
  }
}
console.log(
  JSON.stringify(
    {
      purpose: "HUMAN_DECLARED_EXPORTS_OFFLINE_SCORING_REQUIRES_MODERATOR_ADJUDICATION",
      declaredParticipants: participantIds.size,
      observations,
      clinicalRequests: 0,
      providerCalls: 0,
      limitations: [
        "Exports do not independently prove human identity; moderator must attest participation.",
        "Explicit marks are not a confirmed count of correct error detection; adjudicate against reference.",
        "Automation, historical inference and controlled mutations remain separate.",
        "Do not announce causal time savings from incomplete/unbalanced sessions.",
      ],
    },
    null,
    2,
  ),
);
