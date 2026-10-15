import { useState, type FormEvent } from "react";
import { readInventoryResponse } from "@/data/inventory-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Verification = {
  documentId: string;
  title: string;
  patientName: string;
  patientCode: string;
  unitName: string;
  authorName: string;
  professionalCouncil: string;
  councilNumber: string;
  councilRegion: string;
  finalizedAt: string;
  contentSha256: string;
  notice: string;
  amendments: Array<{ kind: string; documentId: string }>;
};
export function ClinicalDocumentVerification({ initialCode = "" }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Verification | null>(null);
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(
        `/api/v1/inventory/encounter-documents?verify=${encodeURIComponent(code.trim())}`,
        { credentials: "same-origin" },
      );
      const body = await readInventoryResponse<Verification>(
        response,
        "Não foi possível verificar o documento.",
      );
      if (!body.data) throw new Error("Resposta de verificação inválida.");
      setResult(body.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={verify} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Confira o código impresso em um documento. A consulta respeita suas permissões e fica
        registrada na auditoria.
      </p>
      <label className="block space-y-1 text-sm">
        Código de verificação
        <Input
          required
          maxLength={50}
          value={code}
          placeholder="A1-…"
          disabled={pending}
          onChange={(event) => {
            setCode(event.target.value);
            setResult(null);
            setError("");
          }}
        />
      </label>
      <Button disabled={pending || !code.trim()}>
        {pending ? "Verificando…" : "Conferir documento"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="space-y-2 rounded-xl border p-4 text-sm">
          <p className="font-semibold">Integridade do registro confirmada</p>
          <p>{result.title}</p>
          <Button asChild variant="outline" size="sm">
            <a
              href={`/api/v1/inventory/encounter-documents?documentId=${encodeURIComponent(result.documentId)}&print=true`}
              target="_blank"
              rel="noreferrer"
            >
              Abrir original preservado
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">
            Compare a via apresentada com o original. A conferência do código não compara
            automaticamente o texto impresso.
          </p>
          <p>
            {result.patientName} · {result.patientCode}
          </p>
          <p>
            {result.unitName} · {result.authorName} · {result.professionalCouncil}{" "}
            {result.councilNumber}/{result.councilRegion}
          </p>
          <p>
            Finalizado em{" "}
            {new Date(result.finalizedAt).toLocaleString("pt-BR", {
              timeZone: "America/Fortaleza",
            })}
          </p>
          {result.amendments.length > 0 && (
            <p className="font-medium">
              Atenção: há adendo ou retificação finalizados. Consulte o atendimento antes de
              utilizar esta via.
            </p>
          )}
          <details>
            <summary className="cursor-pointer">SHA-256 do conteúdo preservado</summary>
            <p className="break-all text-xs">{result.contentSha256}</p>
          </details>
          <p className="text-xs text-muted-foreground">{result.notice}</p>
        </div>
      )}
    </form>
  );
}
