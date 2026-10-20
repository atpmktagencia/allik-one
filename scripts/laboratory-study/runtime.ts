import { laboratoryDraft, type LaboratoryDraft } from "../../src/lib/laboratory-results";
import { laboratoryRowEvidenceIdentity } from "../../src/lib/laboratory-review-checks";

export type StudyCase = {
  taskId: string;
  caseId: string;
  pdfSha256: string;
  captureSha256: string;
  variantSha256: string;
  pages: string[];
  draft: LaboratoryDraft;
  checks: { version: number; parserStatus: string; totalPages: number | null; rows: unknown[] };
};
export type StudyData = {
  battery: "real" | "controlled";
  build: { candidate: string; componentSha256: string; referenceSha256: string };
  tasks: Record<string, StudyCase>;
  training: StudyCase;
};
export type StudyEvent = {
  event: string;
  relativeMs: number;
  row?: number;
  field?: string;
  control?: string;
  page?: number;
  origin?: "user" | "technical";
};
export const study = {
  data: null as StudyData | null,
  current: null as StudyCase | null,
  saved: null as LaboratoryDraft | null,
  events: [] as StudyEvent[],
  started: null as number | null,
  condition: "A" as "A" | "B",
  blocked: 0,
  imageReady: false,
  viewedPage: 1,
  startedAt: "",
  log(event: string, details: Omit<StudyEvent, "event" | "relativeMs"> = {}) {
    this.events.push({
      event,
      relativeMs: this.started === null ? 0 : performance.now() - this.started,
      ...details,
    });
  },
  begin(task: StudyCase, condition: "A" | "B") {
    this.current = structuredClone(task);
    this.saved = structuredClone(task.draft);
    this.events = [];
    this.started = null;
    this.startedAt = "";
    this.condition = condition;
    this.imageReady = false;
    this.viewedPage = 1;
  },
  startClock() {
    if (this.started !== null) return;
    this.started = performance.now();
    this.startedAt = new Date().toISOString();
    this.log("task_start", { origin: "technical" });
    window.dispatchEvent(new Event("study-ready"));
  },
  response() {
    if (!this.current || !this.saved) throw new Error("NO_STUDY_TASK");
    return {
      source: {
        id: "study-source",
        title: "Documento sintético " + this.current.taskId,
        sha256: this.current.pdfSha256,
        previewUrl: "/api/v1/inventory/patient-document-file?sourceId=study-source",
      },
      import: {
        id: "study-import",
        status: "READY_REVIEW",
        version: 1,
        draft: structuredClone(this.saved),
        processing_started_at: null,
        failure_code: null,
      },
      evidenceChecks: {
        ...this.current.checks,
        rows: this.saved.rows.map((row, i) => {
          const original = this.current?.draft.rows[i];
          return original &&
            laboratoryRowEvidenceIdentity(original) === laboratoryRowEvidenceIdentity(row)
            ? (this.current?.checks.rows[i] ?? null)
            : null;
        }),
      },
      versions: [],
      events: [],
      extractionAvailable: false,
      extractionMessage: null,
    };
  },
};

/** No native fetch reference is retained. All reads are in-memory fixtures and
 * only a versioned SAVE updates local memory. It has no database or network path. */
export function installStudyTransport() {
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    },
  });
  Object.defineProperty(window, "fetch", {
    configurable: false,
    writable: false,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw, "https://study.invalid");
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const deny = () => {
        study.blocked++;
        study.log("blocked_request", { origin: "technical" });
        return Response.json(
          { error: "ESTUDO LOCAL: operação bloqueada; nenhum dado foi enviado." },
          { status: 403 },
        );
      };
      if (
        url.origin !== "https://study.invalid" ||
        url.pathname !== "/api/v1/inventory/laboratory-results" ||
        url.searchParams.get("unitId") !== "study-unit"
      )
        return deny();
      if (method === "GET") {
        if (
          url.searchParams.get("patientId") !== "study-patient" ||
          url.searchParams.get("documentId") !== "study-document"
        )
          return deny();
        return Response.json({ data: study.response() });
      }
      if (method !== "POST" || !init?.body || typeof init.body !== "string") return deny();
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(init.body);
      } catch {
        return deny();
      }
      if (body["patientId"] !== "study-patient" || body["documentId"] !== "study-document")
        return deny();
      if (body["action"] === "OPEN") return Response.json({ data: study.response() });
      if (body["action"] !== "SAVE" || body["version"] !== 1) return deny();
      const draft = laboratoryDraft.safeParse(body["draft"]);
      if (!draft.success) return deny();
      study.saved = structuredClone(draft.data);
      study.log("memory_snapshot", { origin: "technical" });
      window.dispatchEvent(new Event("study-saved"));
      return Response.json({ data: study.response() });
    },
  });
}
