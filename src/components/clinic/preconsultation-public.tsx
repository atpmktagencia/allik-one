import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readInventoryResponse } from "@/data/inventory-api";

import {
  visibleQuestions as getVisibleQuestions,
  type PreconsultationQuestion,
} from "@/lib/preconsultation-questions";
export type { PreconsultationQuestion } from "@/lib/preconsultation-questions";
type Questionnaire = {
  title: string;
  description: string;
  questions: PreconsultationQuestion[];
  expiresAt: string;
};
// Keep the fixed same-origin endpoint: platform protection cookies may be needed in Preview.
// The public server handler authorizes only the bearer token, never an application session.
const endpoint = "/api/v1/inventory/preconsultation-public";

export function PreconsultationPublic() {
  const token = useRef("");
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(true);
  const [done, setDone] = useState(false);
  const [step, setStep] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    function load(reuseInMemoryToken = false) {
      const url = new URL(window.location.href);
      const incoming = new URLSearchParams(url.hash.slice(1)).get("token") ?? "";
      // A StrictMode effect replay can reuse the credential already removed from the URL.
      token.current = incoming || (reuseInMemoryToken ? token.current : "");
      url.hash = "";
      url.searchParams.delete("token");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
      const current = ++generation.current;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setQuestionnaire(null);
      setAnswers({});
      setStep(0);
      setReviewing(false);
      setDone(false);
      setError("");
      setPending(true);
      if (!token.current) {
        setError(
          "Abra o link completo enviado pela clínica. Se necessário, solicite um novo link.",
        );
        setPending(false);
        return;
      }
      void fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "READ", token: token.current }),
      })
        .then((r) => readInventoryResponse<Questionnaire>(r))
        .then((r) => {
          if (generation.current !== current || controller.signal.aborted) return;
          if (!r.data) throw new Error("Não foi possível abrir o questionário.");
          setQuestionnaire(r.data);
        })
        .catch((e: unknown) => {
          if (generation.current === current && !controller.signal.aborted)
            setError(e instanceof Error ? e.message : "Não foi possível abrir o questionário.");
        })
        .finally(() => {
          if (generation.current === current && !controller.signal.aborted) setPending(false);
        });
    }
    const changed = () => load();
    window.addEventListener("hashchange", changed);
    load(true);
    return () => {
      window.removeEventListener("hashchange", changed);
      request.current?.abort();
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token.current || !questionnaire || pending) return;
    const current = generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError("");
    try {
      await readInventoryResponse(
        await fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "SUBMIT",
            token: token.current,
            answers: visibleAnswers(questionnaire.questions, answers),
          }),
        }),
      );
      if (generation.current !== current || controller.signal.aborted) return;
      token.current = "";
      setAnswers({});
      setQuestionnaire(null);
      setDone(true);
    } catch (e) {
      if (generation.current === current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Não foi possível enviar. Tente novamente.");
    } finally {
      if (generation.current === current && !controller.signal.aborted) setPending(false);
    }
  }
  function visibleAnswers(questions: PreconsultationQuestion[], values: Record<string, string>) {
    const ids = new Set(getVisibleQuestions(questions, values).map((q) => q.id));
    return Object.fromEntries(Object.entries(values).filter(([id]) => ids.has(id)));
  }
  function answer(id: string, value: string) {
    setAnswers((previous) =>
      visibleAnswers(questionnaire?.questions ?? [], { ...previous, [id]: value }),
    );
  }
  const activeQuestions = getVisibleQuestions(questionnaire?.questions ?? [], answers);
  const pageSize = 5;
  const steps = Math.max(1, Math.ceil(activeQuestions.length / pageSize));
  const currentStep = Math.min(step, steps - 1);
  const answered = activeQuestions.filter(
    (question) => Object.hasOwn(answers, question.id) && !!answers[question.id]?.trim(),
  ).length;
  const visibleQuestions = reviewing
    ? []
    : activeQuestions.slice(currentStep * pageSize, (currentStep + 1) * pageSize);
  function navigate(next: number) {
    setStep(next);
    setReviewing(false);
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-6 rounded-xl border bg-card p-6 sm:p-8">
        <p className="text-sm font-medium text-muted-foreground">Allik One · Pré-consulta</p>
        {done ? (
          <>
            <h1 className="text-2xl font-semibold">Respostas enviadas</h1>
            <p>A equipe poderá consultar suas respostas. Você pode fechar esta página.</p>
          </>
        ) : (
          <>
            <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold focus:outline-none">
              {questionnaire?.title ?? "Questionário de pré-consulta"}
            </h1>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {pending && !questionnaire && <p role="status">Abrindo questionário…</p>}
            {questionnaire && (
              <form
                onSubmit={(event) => {
                  if (!reviewing && currentStep < steps - 1) {
                    event.preventDefault();
                    if (!pending) navigate(currentStep + 1);
                  } else void submit(event);
                }}
                className="space-y-6"
              >
                <p className="whitespace-pre-wrap text-sm">{questionnaire.description}</p>
                <p className="rounded-md bg-muted p-3 text-sm">
                  Todas as respostas são opcionais. Deixe em branco o que preferir não responder.
                  Este formulário não substitui uma consulta e não é um canal de urgência. As
                  respostas são enviadas apenas ao finalizar; fechar ou recarregar esta página
                  descarta o preenchimento ainda não enviado.
                </p>
                <div className="space-y-2" aria-label="Progresso do questionário">
                  <p role="status" className="text-sm text-muted-foreground">
                    {reviewing ? "Revisão das respostas" : `Etapa ${currentStep + 1} de ${steps}`} ·{" "}
                    {answered} de {activeQuestions.length} respostas preenchidas
                  </p>
                  <progress
                    className="h-2 w-full accent-teal-600"
                    max={steps}
                    value={reviewing ? steps : currentStep + 1}
                    aria-label="Etapas do questionário"
                  />
                </div>
                {reviewing && (
                  <dl className="space-y-4" aria-label="Revisão das respostas">
                    {activeQuestions.map((question) => (
                      <div key={question.id} className="border-b pb-3">
                        <dt className="text-sm font-medium">{question.label}</dt>
                        <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                          {Object.hasOwn(answers, question.id) && answers[question.id]?.trim()
                            ? answers[question.id]
                            : "Não respondida"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {visibleQuestions.map((question, index) => (
                  <label key={question.id} className="block space-y-2 text-sm font-medium">
                    <span>
                      {currentStep * pageSize + index + 1}. {question.label}{" "}
                      <span className="font-normal text-muted-foreground">(opcional)</span>
                    </span>
                    {question.type === "CHOICE" ? (
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3"
                        disabled={pending}
                        value={
                          Object.hasOwn(answers, question.id) ? (answers[question.id] ?? "") : ""
                        }
                        onChange={(e) => answer(question.id, e.target.value)}
                      >
                        <option value="">Prefiro não responder / não informado</option>
                        {question.options?.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Textarea
                        disabled={pending}
                        maxLength={4000}
                        value={
                          Object.hasOwn(answers, question.id) ? (answers[question.id] ?? "") : ""
                        }
                        onChange={(e) => answer(question.id, e.target.value)}
                        rows={3}
                      />
                    )}
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">
                  Ao enviar, as respostas ficam disponíveis para a equipe autorizada da clínica.
                  Confira antes de enviar: este link pode ser usado uma única vez.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(currentStep > 0 || reviewing) && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        reviewing
                          ? (setReviewing(false), heading.current?.focus())
                          : navigate(currentStep - 1)
                      }
                    >
                      {reviewing ? "Voltar às perguntas" : "Etapa anterior"}
                    </Button>
                  )}
                  {!reviewing && currentStep === steps - 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setReviewing(true);
                        heading.current?.focus();
                      }}
                    >
                      Revisar respostas
                    </Button>
                  )}
                  <Button type="submit" disabled={pending}>
                    {pending
                      ? "Enviando…"
                      : !reviewing && currentStep < steps - 1
                        ? "Próxima etapa"
                        : "Enviar respostas"}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
