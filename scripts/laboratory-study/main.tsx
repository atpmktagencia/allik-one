import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LaboratoryReview } from "../../src/components/clinic/laboratory-review";
import { installStudyTransport, study, type StudyData } from "./runtime";
import "./study.css";

declare global {
  interface Window {
    __STUDY_DATA__: StudyData;
  }
}
study.data = window.__STUDY_DATA__;
installStudyTransport();
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const automaticSmoke = new URLSearchParams(location.search).get("smoke") === "1";
const schedule = (participant: string) => {
  const n = Number(participant.slice(1)) - 1;
  const sequence = n % 4;
  const order = ["D1", "D2", "D3", "D4", "D5", "D6"];
  if (sequence % 2) order.reverse();
  return order.map((taskId, i) => ({
    taskId,
    condition: (i % 2 === (sequence >= 2 ? 1 : 0) ? "A" : "B") as "A" | "B",
    variant: n < 4 ? ("real" as const) : ("controlled" as const),
  }));
};

export function App() {
  const [participant, setParticipant] = useState(study.data!.battery === "real" ? "P01" : "P05");
  const [authorized, setAuthorized] = useState(false);
  const [phase, setPhase] = useState<"setup" | "task" | "rating" | "done">("setup");
  const [index, setIndex] = useState(-1);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [difficulty, setDifficulty] = useState("");
  const [confidence, setConfidence] = useState("");
  const [problemRow, setProblemRow] = useState("1");
  const [problemType, setProblemType] = useState("result");
  const [ready, setReady] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [technicalError, setTechnicalError] = useState("");
  const results = useRef<Record<string, unknown>[]>([]);
  const outcome = useRef<Record<string, unknown> | null>(null);
  const plan = schedule(participant);

  function begin(next: number) {
    const task = next < 0 ? study.data!.training : study.data!.tasks[plan[next]!.taskId]!;
    const condition = next < 0 ? "A" : plan[next]!.condition;
    study.begin(task, condition);
    setReady(false);
    setPortal(null);
    setIndex(next);
    setDifficulty("");
    setConfidence("");
    setTechnicalError("");
    setPhase("task");
  }

  useEffect(() => {
    if (phase !== "task") return;
    const observe = new MutationObserver(() => {
      const dialog = document.querySelector<HTMLElement>("[role=dialog]");
      if (dialog && !dialog.querySelector("[data-study-toolbar]")) {
        const host = document.createElement("div");
        host.dataset["studyToolbar"] = "true";
        dialog.append(host);
        setPortal(host);
      }
      if (study.imageReady && document.querySelector('[aria-label="Exame da linha 1"]'))
        study.startClock();
    });
    observe.observe(document.body, { childList: true, subtree: true });
    const imageReady = () => {
      if (document.querySelector('[aria-label="Exame da linha 1"]')) study.startClock();
    };
    const clock = () => setReady(true);
    window.addEventListener("study-image-ready", imageReady);
    window.addEventListener("study-ready", clock);
    return () => {
      observe.disconnect();
      window.removeEventListener("study-image-ready", imageReady);
      window.removeEventListener("study-ready", clock);
    };
  }, [phase, index]);

  useEffect(() => {
    if (phase !== "task") return;
    const edited = new WeakMap<Element, string>();
    const click = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("[data-study-toolbar]")) return;
      const anchor = target.closest("a");
      if (anchor) {
        event.preventDefault();
        event.stopPropagation();
        study.log("original_open", { control: "native_viewer_unavailable_use_instrumented_panel" });
        return;
      }
      if (target.closest('[aria-label="PDF original do exame"]')) return;
      const button = target.closest("button");
      const text = button?.textContent?.trim() ?? "";
      if (
        text === "Confirmar resultados" ||
        text === "Extrair resultados com IA" ||
        text === "Corrigir resultados"
      ) {
        event.preventDefault();
        event.stopPropagation();
        study.log("blocked_clinical_action", { control: text });
        setTechnicalError("A publicação clínica está bloqueada no estudo. Use Terminar tarefa.");
        return;
      }
      if (study.condition === "A" && text.startsWith("Conferi as")) {
        event.preventDefault();
        event.stopPropagation();
        study.log("individual_condition_bulk_blocked");
        setTechnicalError("Nesta condição, confira e marque cada linha individualmente.");
        return;
      }
      const label = target.getAttribute("aria-label") ?? "";
      if (button)
        study.log(
          ["Todos", "Atenção individual", "Não conferidos"].includes(text)
            ? "filter_change"
            : text.startsWith("Conferi as")
              ? "bulk_confirm"
              : text === "Adicionar resultado"
                ? "line_add"
                : text === "Excluir"
                  ? "line_remove"
                  : "control_click",
          { control: text.slice(0, 80) },
        );
      if (label.startsWith("Conferir linha"))
        study.log("individual_confirm", { row: Number(label.split(" ").at(-1)) });
      else if (target instanceof HTMLInputElement && target.type === "checkbox")
        study.log("identity_confirm");
      if (target.closest("summary")) study.log("details_open");
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        edited.set(event.target, event.target.value);
    };
    const blur = (event: FocusEvent) => {
      const el = event.target;
      if (
        !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ||
        el.closest("[data-study-toolbar]")
      )
        return;
      if (el.type === "checkbox" || edited.get(el) === el.value) return;
      const label = el.getAttribute("aria-label") ?? "notes";
      study.log("field_edit", {
        field: label.replace(/ da linha \d+$/, ""),
        ...(label.match(/linha (\d+)/)?.[1] ? { row: Number(label.match(/linha (\d+)/)![1]) } : {}),
      });
    };
    const visibility = () =>
      study.log(document.hidden ? "visibility_hidden" : "visibility_visible");
    let lastScroll = 0;
    const scroll = () => {
      if (performance.now() - lastScroll > 500) {
        study.log("scroll_session");
        lastScroll = performance.now();
      }
    };
    document.addEventListener("click", click, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", blur, true);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("click", click, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", blur, true);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [phase]);

  async function finish(censored = false) {
    if (finishing || study.started === null) return;
    setFinishing(true);
    const end = performance.now();
    study.log("task_end", { control: censored ? "time_limit" : "participant_finished" });
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
    const save = buttons.find((b) => b.textContent?.trim() === "Salvar rascunho");
    if (save && !save.disabled) {
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            window.removeEventListener("study-saved", saved);
            reject(Error("MEMORY_SAVE_TIMEOUT"));
          }, 5000);
          function saved() {
            clearTimeout(timer);
            resolve();
          }
          window.addEventListener("study-saved", saved, { once: true });
          save.click();
        });
      } catch {
        study.log("technical_snapshot_failure", { origin: "technical" });
        setTechnicalError(
          "A captura local falhou. O trabalho continua em memória; tente terminar novamente ou peça ajuda ao moderador.",
        );
        setFinishing(false);
        return;
      }
    }
    outcome.current = {
      taskId: study.current!.taskId,
      caseId: study.current!.caseId,
      pdfSha256: study.current!.pdfSha256,
      captureSha256: study.current!.captureSha256,
      variantSha256: study.current!.variantSha256,
      condition: study.condition,
      outputOrigin:
        index < 0
          ? "training_legacy_capture"
          : study.data!.battery === "real"
            ? "historical_real_inference"
            : "controlled_usability_mutation",
      startedAt: study.startedAt,
      totalMs: end - study.started,
      censored,
      finalDraft: structuredClone(study.saved),
      events: structuredClone(study.events),
    };
    setFinishing(false);
    setPhase("rating");
  }

  useEffect(() => {
    if (phase !== "task" || !ready) return;
    const timer = setTimeout(() => void finish(true), 8 * 60 * 1000);
    return () => clearTimeout(timer);
    // finish snapshots current component DOM; timer must not restart on a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ready]);

  const exportData = () => {
    const data = {
      schemaVersion: 1,
      study: "D2",
      participantKind: automaticSmoke ? "automated_smoke" : "human_declared",
      participantId: participant,
      sequence: "S" + (((Number(participant.slice(1)) - 1) % 4) + 1),
      build: study.data!.build,
      syntheticOnly: true,
      clinicalRequestsSent: 0,
      blockedRequests: study.blocked,
      tasks: results.current,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `allik-estudo-${automaticSmoke ? "SMOKE-" : ""}${participant}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <QueryClientProvider client={client}>
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <p className="font-semibold text-teal-800">
          SINTÉTICO — ESTUDO LOCAL — NÃO SALVA NO PRONTUÁRIO
        </p>
        {automaticSmoke && <p role="status">TESTE AUTOMATIZADO — NÃO É PARTICIPANTE HUMANO</p>}
        <h1 className="text-2xl font-semibold">Allik One · Conferência de exames</h1>
        {phase === "setup" && (
          <>
            <p>
              Seis documentos, conferência individual ou por exceções. O material pode conter erros
              de teste. Confira o original, corrija o que puder e preserve pendências. Não informe
              dados pessoais.
            </p>
            <label>
              Código anônimo{" "}
              <select
                aria-label="Código anônimo"
                value={participant}
                onChange={(e) => setParticipant(e.target.value)}
              >
                {Array.from(
                  { length: 4 },
                  (_, i) =>
                    "P" + String(i + (study.data!.battery === "real" ? 1 : 5)).padStart(2, "0"),
                ).map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <input
                type="checkbox"
                checked={authorized}
                onChange={(e) => setAuthorized(e.target.checked)}
              />{" "}
              Entendi o estudo sintético e concordo em participar. Tenho autorização do moderador.
            </label>
            <button disabled={!authorized} onClick={() => begin(-1)}>
              Iniciar treino
            </button>
          </>
        )}
        {phase === "task" && (
          <div>
            <p>
              {index < 0
                ? "Treino (não medido)"
                : `Tarefa ${index + 1}/6 · ${study.condition === "A" ? "Conferência individual: Todos, linha por linha" : "Conferência por exceção: Atenção individual, depois Todos e original antes do lote"}`}
            </p>
            <LaboratoryReview
              key={index}
              patientId="study-patient"
              documentId="study-document"
              unitId="study-unit"
            />
            {portal &&
              createPortal(
                <div className="flex flex-wrap items-center gap-2 border-t bg-teal-50 py-1 text-xs">
                  <strong>
                    ESTUDO LOCAL · {index < 0 ? "treino" : `${index + 1}/6 · ${study.condition}`}
                  </strong>
                  {technicalError && <span role="alert">{technicalError}</span>}
                  <button
                    disabled={!ready}
                    onClick={() => study.log("evidence_located", { page: study.viewedPage })}
                  >
                    Localizei a evidência
                  </button>
                  <label>
                    Linha{" "}
                    <input
                      aria-label="Linha com problema"
                      type="number"
                      min="1"
                      max="200"
                      value={problemRow}
                      onChange={(e) => setProblemRow(e.target.value)}
                      style={{ width: 44 }}
                    />
                  </label>
                  <select
                    aria-label="Tipo de problema"
                    value={problemType}
                    onChange={(e) => setProblemType(e.target.value)}
                  >
                    {Object.entries({
                      result: "Resultado",
                      unit: "Unidade",
                      date: "Data",
                      association: "Associação",
                      omission: "Omissão",
                      other: "Outro",
                    }).map(([f, label]) => (
                      <option key={f} value={f}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!ready}
                    onClick={() =>
                      study.log("problem_perceived", {
                        row: Number(problemRow),
                        field: problemType,
                      })
                    }
                  >
                    Marcar problema
                  </button>
                  <button disabled={!ready} onClick={() => study.log("help_request")}>
                    Pedir ajuda
                  </button>
                  <button disabled={!ready || finishing} onClick={() => void finish()}>
                    Terminar tarefa
                  </button>
                </div>,
                portal,
              )}
          </div>
        )}
        {phase === "rating" && (
          <>
            <p>Tarefa encerrada. O resultado permanece somente em memória.</p>
            <label className="block">
              Dificuldade de localizar a evidência (1 fácil–7 difícil){" "}
              <select
                aria-label="Dificuldade"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
              >
                <option value="">Selecione</option>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="block">
              Confiança na conferência (1–7){" "}
              <select
                aria-label="Confiança"
                value={confidence}
                onChange={(e) => setConfidence(e.target.value)}
              >
                <option value="">Selecione</option>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <button
              disabled={!difficulty || !confidence}
              onClick={() => {
                if (index >= 0)
                  results.current.push({
                    ...outcome.current,
                    evidenceDifficulty: Number(difficulty),
                    confidence: Number(confidence),
                  });
                if (index === 5) setPhase("done");
                else begin(index + 1);
              }}
            >
              Continuar
            </button>
          </>
        )}
        {phase === "done" && (
          <>
            <p>
              Estudo concluído. Exporte o registro anônimo e entregue-o ao moderador. Fechar a
              página descarta a memória.
            </p>
            <button onClick={exportData}>Exportar registro anônimo</button>
          </>
        )}
      </main>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
