import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readInventoryResponse } from "@/data/inventory-api";

export type PreconsultationQuestion = {
  id: string;
  label: string;
  type: "TEXT" | "CHOICE";
  options?: string[];
};
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
          body: JSON.stringify({ action: "SUBMIT", token: token.current, answers }),
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
            <h1 className="text-2xl font-semibold">
              {questionnaire?.title ?? "Questionário de pré-consulta"}
            </h1>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {pending && !questionnaire && <p role="status">Abrindo questionário…</p>}
            {questionnaire && (
              <form onSubmit={submit} className="space-y-6">
                <p className="whitespace-pre-wrap text-sm">{questionnaire.description}</p>
                <p className="rounded-md bg-muted p-3 text-sm">
                  Todas as respostas são opcionais. Deixe em branco o que preferir não responder.
                  Este formulário não substitui uma consulta e não é um canal de urgência.
                </p>
                {questionnaire.questions.map((question, index) => (
                  <label key={question.id} className="block space-y-2 text-sm font-medium">
                    <span>
                      {index + 1}. {question.label}{" "}
                      <span className="font-normal text-muted-foreground">(opcional)</span>
                    </span>
                    {question.type === "CHOICE" ? (
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3"
                        disabled={pending}
                        value={
                          Object.hasOwn(answers, question.id) ? (answers[question.id] ?? "") : ""
                        }
                        onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })}
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
                        onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })}
                        rows={3}
                      />
                    )}
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">
                  Ao enviar, as respostas ficam disponíveis para a equipe autorizada da clínica.
                  Confira antes de enviar: este link pode ser usado uma única vez.
                </p>
                <Button type="submit" disabled={pending}>
                  {pending ? "Enviando…" : "Enviar respostas"}
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
