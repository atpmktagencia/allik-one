import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useInventory, readInventoryResponse } from "@/data/inventory-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InventoryState } from "./inventory-state";
import {
  questions as preconsultationQuestions,
  visibleQuestions,
  type PreconsultationQuestion,
} from "@/lib/preconsultation-questions";

type Form = {
  id: string;
  unitId: string;
  title: string;
  description: string;
  questions: PreconsultationQuestion[];
  version: number;
  publishedVersionId: string | null;
  publishedVersion: number | null;
  publishedTitle: string | null;
};
type Invitation = {
  id: string;
  patientId: string;
  patientName: string;
  unitId: string;
  appointmentId: string | null;
  title: string;
  expiresAt: string;
  submittedAt: string | null;
  revokedAt: string | null;
  answers?: Record<string, string>;
  questions?: PreconsultationQuestion[];
};
type Payload = {
  forms: Form[];
  invitations: Invitation[];
  units: { id: string; name: string }[];
  canManage: boolean;
  canReadAnswers: boolean;
};
const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
const newQuestion = (): PreconsultationQuestion => ({
  id: crypto.randomUUID(),
  label: "",
  type: "TEXT",
});
const date = (value: string) => new Date(value).toLocaleString("pt-BR");
const newNonce = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

export function PreconsultationPanel({
  patientId,
  appointmentId,
  unitId,
}: {
  patientId?: string;
  appointmentId?: string;
  unitId?: string;
}) {
  const client = useQueryClient();
  const params = new URLSearchParams();
  if (unitId) params.set("unitId", unitId);
  if (patientId) params.set("patientId", patientId);
  if (appointmentId) params.set("appointmentId", appointmentId);
  const query = useInventory<Payload>(`preconsultation?${params}`);
  const patients = useInventory<{
    patients: { id: string; fullName: string; primaryUnitId: string; active: boolean }[];
  }>("patients", { enabled: !patientId });
  const [editor, setEditor] = useState<Form | null>(null);
  const [invitePatient, setInvitePatient] = useState(patientId ?? "");
  const [formId, setFormId] = useState("");
  const [days, setDays] = useState("7");
  const inviteOperation = useRef<{ key: string; id: string; requestNonce: string } | null>(null);
  const replacementOperation = useRef<{
    id: string;
    replacementId: string;
    requestNonce: string;
  } | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  async function mutate(body: unknown): Promise<boolean> {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const result = await readInventoryResponse<{ link?: string }>(
        await fetch("/api/v1/inventory/preconsultation", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      if (result.data?.link) setLink(result.data.link);
      setMessage("Operação registrada.");
      await client.invalidateQueries({
        predicate: ({ queryKey }) => {
          if (queryKey[0] !== "inventory" || typeof queryKey[1] !== "string") return false;
          const url = new URL(queryKey[1], "https://inventory.invalid");
          if (url.pathname !== "/api/v1/inventory/preconsultation") return false;
          const scopedPatient = url.searchParams.get("patientId");
          const action = body && typeof body === "object" && "action" in body ? body.action : "";
          return (
            action === "SAVE_FORM" ||
            action === "PUBLISH_FORM" ||
            !scopedPatient ||
            !patientId ||
            scopedPatient === patientId
          );
        },
      });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
      return false;
    } finally {
      setPending(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    const checked = preconsultationQuestions.safeParse(editor.questions);
    if (!checked.success) {
      setError(
        "Revise as perguntas e condições: cada condição deve usar uma escolha anterior e uma opção existente.",
      );
      return;
    }
    if (await mutate({ action: "SAVE_FORM", ...editor, questions: checked.data })) setEditor(null);
  }
  if (!query.data) return <InventoryState pending={query.isLoading} error={query.error} />;
  const data = query.data;
  const selectedUnit =
    unitId ?? patients.data?.patients.find((p) => p.id === invitePatient)?.primaryUnitId;
  const availableForms = data.forms.filter(
    (f) => f.publishedVersionId && (!selectedUnit || f.unitId === selectedUnit),
  );
  return (
    <section className="space-y-5 rounded-lg border bg-card p-4" aria-label="Pré-consulta">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Pré-consulta</h2>
          <p className="text-sm text-muted-foreground">
            Questionários opcionais respondidos antes do atendimento.
          </p>
        </div>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          Atualizar pré-consultas
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {!data.canManage && (
        <p className="text-sm text-muted-foreground">
          Use uma conta individual autorizada para gerenciar questionários e links.
        </p>
      )}
      {data.canManage && (
        <details className="rounded-md border p-4">
          <summary className="cursor-pointer font-medium">Modelos de questionário</summary>
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Edite um rascunho e publique antes de gerar links. Cada convite preserva as perguntas
              da versão enviada. São exibidos até 100 modelos recentes.
            </p>
            {data.forms.map((f) => (
              <div
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div>
                  <p className="font-medium">{f.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {data.units.find((u) => u.id === f.unitId)?.name} · Rascunho versão {f.version}
                    {f.publishedVersionId
                      ? ` · Publicada versão ${f.publishedVersion}: ${f.publishedTitle}`
                      : " · Ainda não publicado"}
                    {f.publishedVersion != null && f.version > f.publishedVersion
                      ? " · Alterações ainda não publicadas"
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      setEditor({ ...f, questions: f.questions.map((q) => ({ ...q })) })
                    }
                  >
                    Editar questionário
                  </Button>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      void mutate({ action: "PUBLISH_FORM", id: f.id, version: f.version })
                    }
                  >
                    Publicar versão
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                setEditor({
                  id: crypto.randomUUID(),
                  unitId: unitId ?? data.units[0]?.id ?? "",
                  title: "",
                  description: "",
                  questions: [newQuestion()],
                  version: 0,
                  publishedVersionId: null,
                  publishedVersion: null,
                  publishedTitle: null,
                })
              }
            >
              Novo questionário
            </Button>
            {editor && (
              <form onSubmit={save} className="space-y-3 rounded-md border p-4">
                <h3 className="font-medium">Editar modelo</h3>
                <label className="block text-sm">
                  Unidade
                  <select
                    className={selectClass}
                    disabled={editor.version > 0 || pending}
                    required
                    value={editor.unitId}
                    onChange={(e) => setEditor({ ...editor, unitId: e.target.value })}
                  >
                    <option value="">Selecione</option>
                    {data.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Título do questionário
                  <Input
                    required
                    minLength={3}
                    maxLength={160}
                    value={editor.title}
                    onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Orientações ao paciente
                  <Textarea
                    maxLength={2000}
                    value={editor.description}
                    onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                  />
                </label>
                {editor.questions.map((q, index) => (
                  <fieldset key={q.id} className="space-y-2 rounded-md border p-3">
                    <legend className="px-1 text-sm">Pergunta {index + 1} — opcional</legend>
                    <label className="block text-sm">
                      Texto da pergunta
                      <Input
                        required
                        minLength={3}
                        maxLength={300}
                        value={q.label}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            questions: editor.questions.map((item) =>
                              item.id === q.id ? { ...item, label: e.target.value } : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="block text-sm">
                      Tipo de resposta
                      <select
                        className={selectClass}
                        value={q.type}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            questions: editor.questions.map((item) =>
                              item.id === q.id
                                ? {
                                    ...item,
                                    type: e.target.value as "TEXT" | "CHOICE",
                                    options: [],
                                  }
                                : item,
                            ),
                          })
                        }
                      >
                        <option value="TEXT">Texto livre</option>
                        <option value="CHOICE">Escolha única</option>
                      </select>
                    </label>
                    {q.type === "CHOICE" && (
                      <label className="block text-sm">
                        Opções, uma por linha
                        <Textarea
                          required
                          value={q.options?.join("\n") ?? ""}
                          onChange={(e) =>
                            setEditor({
                              ...editor,
                              questions: editor.questions.map((item) =>
                                item.id === q.id
                                  ? { ...item, options: e.target.value.split("\n") }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                    )}
                    <div className="space-y-2 rounded-md bg-muted/40 p-3">
                      <label className="block text-sm">
                        Exibir esta pergunta
                        <select
                          aria-label={`Condição da pergunta ${index + 1}`}
                          className={selectClass}
                          value={q.visibleWhen?.questionId ?? ""}
                          onChange={(e) => {
                            const parent = editor.questions
                              .slice(0, index)
                              .find((item) => item.id === e.target.value);
                            setEditor({
                              ...editor,
                              questions: editor.questions.map((item) =>
                                item.id === q.id
                                  ? {
                                      ...item,
                                      visibleWhen: parent
                                        ? {
                                            questionId: parent.id,
                                            equals:
                                              parent.options?.find((option) => option.trim()) ?? "",
                                          }
                                        : undefined,
                                    }
                                  : item,
                              ),
                            });
                          }}
                        >
                          <option value="">Sempre (opcional)</option>
                          {editor.questions
                            .slice(0, index)
                            .filter((item) => item.type === "CHOICE")
                            .map((item) => (
                              <option value={item.id} key={item.id}>
                                Quando responder: {item.label || "Pergunta sem título"}
                              </option>
                            ))}
                          {q.visibleWhen &&
                            !editor.questions
                              .slice(0, index)
                              .some(
                                (item) =>
                                  item.id === q.visibleWhen?.questionId && item.type === "CHOICE",
                              ) && (
                              <option value={q.visibleWhen.questionId}>
                                Condição inválida — selecione outra pergunta
                              </option>
                            )}
                        </select>
                      </label>
                      {q.visibleWhen && (
                        <label className="block text-sm">
                          Resposta que exibe a pergunta
                          <select
                            aria-label={`Resposta condicional da pergunta ${index + 1}`}
                            className={selectClass}
                            value={q.visibleWhen.equals}
                            onChange={(e) =>
                              setEditor({
                                ...editor,
                                questions: editor.questions.map((item) =>
                                  item.id === q.id && item.visibleWhen
                                    ? {
                                        ...item,
                                        visibleWhen: {
                                          ...item.visibleWhen,
                                          equals: e.target.value,
                                        },
                                      }
                                    : item,
                                ),
                              })
                            }
                          >
                            <option value="">Selecione uma opção</option>
                            {editor.questions
                              .find((item) => item.id === q.visibleWhen?.questionId)
                              ?.options?.filter((option) => option.trim())
                              .map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Use apenas uma pergunta de escolha anterior. A pergunta e suas dependentes
                        ficam ocultas quando a condição não é atendida.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={editor.questions.length === 1}
                      onClick={() =>
                        setEditor({
                          ...editor,
                          questions: editor.questions.filter((item) => item.id !== q.id),
                        })
                      }
                    >
                      Remover pergunta {index + 1}
                    </Button>
                  </fieldset>
                ))}
                {!preconsultationQuestions.safeParse(editor.questions).success && (
                  <p className="text-sm text-amber-900">
                    Revise textos, opções e condições antes de salvar. Condições precisam de uma
                    escolha anterior e uma opção válida.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={editor.questions.length >= 30}
                    onClick={() =>
                      setEditor({ ...editor, questions: [...editor.questions, newQuestion()] })
                    }
                  >
                    Adicionar pergunta
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      pending || !preconsultationQuestions.safeParse(editor.questions).success
                    }
                  >
                    Salvar rascunho
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setEditor(null)}
                  >
                    Fechar editor
                  </Button>
                </div>
              </form>
            )}
          </div>
        </details>
      )}
      {data.canManage && (
        <form
          className="space-y-3 rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            setLink("");
            const key = JSON.stringify([invitePatient, appointmentId ?? null, formId, days]);
            if (inviteOperation.current?.key !== key)
              inviteOperation.current = { key, id: crypto.randomUUID(), requestNonce: newNonce() };
            void mutate({
              action: "INVITE",
              id: inviteOperation.current.id,
              requestNonce: inviteOperation.current.requestNonce,
              patientId: invitePatient,
              appointmentId: appointmentId ?? null,
              formId,
              expiresInDays: Number(days),
            }).then((success) => {
              if (success) inviteOperation.current = null;
            });
          }}
        >
          <h3 className="font-medium">Gerar link para o paciente</h3>
          {!patientId && (
            <label className="block text-sm">
              Paciente
              <select
                className={selectClass}
                required
                value={invitePatient}
                onChange={(e) => {
                  inviteOperation.current = null;
                  setInvitePatient(e.target.value);
                  setFormId("");
                  setLink("");
                }}
              >
                <option value="">Selecione</option>
                {patients.data?.patients
                  .filter((p) => p.active !== false)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="block text-sm">
            Questionário publicado
            <select
              className={selectClass}
              required
              value={formId}
              onChange={(e) => {
                inviteOperation.current = null;
                setFormId(e.target.value);
                setLink("");
              }}
            >
              <option value="">Selecione</option>
              {availableForms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.publishedTitle ?? f.title} · Versão {f.publishedVersion}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Validade do link (dias)
            <Input
              type="number"
              required
              min={1}
              max={14}
              value={days}
              onChange={(e) => {
                inviteOperation.current = null;
                setDays(e.target.value);
                setLink("");
              }}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Envio manual pelo canal combinado com o paciente. O link dá acesso ao formulário e não
            confirma a identidade de quem responde. Não o compartilhe em grupos.
          </p>
          <Button type="submit" disabled={pending || !invitePatient || !formId}>
            Gerar link de pré-consulta
          </Button>
        </form>
      )}
      {link && (
        <div className="space-y-3 rounded-md border bg-muted p-4">
          <p className="text-sm font-medium">
            Copie agora: o link não ficará disponível ao recarregar.
          </p>
          <p className="text-xs text-muted-foreground">
            Se perder o link, use “Substituir link” no convite pendente. Um novo link será gerado e
            o anterior deixará de funcionar; respostas já enviadas permanecem preservadas.
          </p>
          <label className="block text-sm">
            Link de pré-consulta
            <Input readOnly value={link} onFocus={(e) => e.target.select()} />
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(link)
                  .then(() => setMessage("Link copiado."))
                  .catch(() => setError("Selecione o link e copie manualmente."))
              }
            >
              Copiar link
            </Button>
            <Button type="button" variant="outline" onClick={() => setLink("")}>
              Ocultar link
            </Button>
          </div>
        </div>
      )}
      <div className="space-y-3">
        <h3 className="font-medium">Convites e respostas</h3>
        <p className="text-xs text-muted-foreground">
          Exibindo até 100 convites mais recentes. Abra a pré-consulta na página do paciente para
          filtrar.
        </p>
        {data.invitations.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma pré-consulta encontrada.</p>
        )}
        {data.invitations.map((invitation) => (
          <article key={invitation.id} className="space-y-3 rounded-md border p-4">
            <div>
              <h4 className="font-medium">{invitation.title}</h4>
              <p className="text-sm">{invitation.patientName}</p>
              <p className="text-sm text-muted-foreground">
                {invitation.submittedAt
                  ? `Respondido em ${date(invitation.submittedAt)}${invitation.revokedAt ? " · Link encerrado" : ""}`
                  : invitation.revokedAt
                    ? "Revogado"
                    : new Date(invitation.expiresAt) <= new Date()
                      ? "Expirado sem envio"
                      : "Aguardando resposta"}{" "}
                · Validade: {date(invitation.expiresAt)}
              </p>
            </div>
            {invitation.submittedAt && data.canReadAnswers && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  Ver respostas da pré-consulta
                </summary>
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Relato enviado pelo link, sem verificação de identidade. Respostas não foram
                    validadas clinicamente nem incorporadas automaticamente ao prontuário. Questões
                    em branco significam “não informado”.
                  </p>
                  {visibleQuestions(invitation.questions ?? [], invitation.answers ?? {}).map(
                    (q) => (
                      <div key={q.id}>
                        <p className="text-sm font-medium">{q.label}</p>
                        <p className="whitespace-pre-wrap break-words text-sm">
                          {invitation.answers && Object.hasOwn(invitation.answers, q.id)
                            ? invitation.answers[q.id] || "Não informado"
                            : "Não informado"}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              </details>
            )}
            {data.canManage && !invitation.submittedAt && !invitation.revokedAt && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => void mutate({ action: "REVOKE", id: invitation.id })}
                >
                  Revogar link
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Substituir este link? O anterior deixará de funcionar. As perguntas da versão enviada serão preservadas.",
                      )
                    )
                      return;
                    if (replacementOperation.current?.id !== invitation.id)
                      replacementOperation.current = {
                        id: invitation.id,
                        replacementId: crypto.randomUUID(),
                        requestNonce: newNonce(),
                      };
                    void mutate({
                      action: "REISSUE",
                      ...replacementOperation.current,
                      expiresInDays: Number(days),
                    }).then((success) => {
                      if (success) replacementOperation.current = null;
                    });
                  }}
                >
                  Substituir link
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
