import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { readInventoryResponse, useInventory } from "@/data/inventory-api";
import { withSelectedUnit } from "@/data/unit-context";

type SignatureState = {
  configured: boolean;
  configurationReason?: string;
  canSign: boolean;
  canManageIdentity: boolean;
  identityReady: boolean;
  signerName: string;
  identityMaskedCpf?: string;
  attempt: null | {
    id: string;
    status: "PREPARING" | "AWAITING_SIGNATURE" | "SIGNED" | "FAILED" | "CANCELED" | "EXPIRED";
    expiresAt: string;
    signedAt?: string;
    certificateSubject?: string;
    canResume?: boolean;
    redirectUrl?: string;
  };
};
const statusLabels = {
  PREPARING: "Preparando assinatura",
  AWAITING_SIGNATURE: "Aguardando autorização do certificado",
  SIGNED: "PDF assinado digitalmente",
  FAILED: "A assinatura não foi concluída",
  CANCELED: "Tentativa cancelada",
  EXPIRED: "Tentativa expirada",
};

export function DocumentSignatureActions({ documentId }: { documentId: string }) {
  const resource = `document-signatures?documentId=${encodeURIComponent(documentId)}`;
  const query = useInventory<SignatureState>(resource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [identityOpen, setIdentityOpen] = useState(false);
  const [cpf, setCpf] = useState("");
  const callbackHandled = useRef(false);
  const submitting = useRef(false);

  async function submit(action: string, fields: Record<string, string> = {}) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(withSelectedUnit("/api/v1/inventory/document-signatures"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, documentId, ...fields }),
      });
      const result = await readInventoryResponse<{ redirectUrl?: string }>(response);
      await query.refetch();
      if (action === "REGISTER_IDENTITY") {
        setCpf("");
        setIdentityOpen(false);
      }
      if (action === "START" && result.data?.redirectUrl) {
        window.location.assign(result.data.redirectUrl);
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Não foi possível concluir a assinatura.",
      );
      // A lost response can still leave a prepared session on the server; recover its state.
      await query.refetch();
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  useEffect(() => {
    if (callbackHandled.current) return;
    const url = new URL(window.location.href);
    const attemptId = url.searchParams.get("signatureAttempt");
    if (!attemptId || url.searchParams.get("signatureDocumentId") !== documentId) return;
    callbackHandled.current = true;
    const signatureSessionId = url.searchParams.get("signatureSessionId") ?? "";
    const state = url.searchParams.get("state") ?? "";
    for (const key of ["signatureAttempt", "signatureDocumentId", "signatureSessionId", "state"])
      url.searchParams.delete(key);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    void submit("COMPLETE", { attemptId, signatureSessionId, state });
    // Callback is consumed once per mounted document; explicit retry uses the server-stored session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  if (query.isLoading)
    return <span className="text-xs text-[#636366]">Consultando assinatura…</span>;
  if (!query.data)
    return (
      <div className="text-xs text-[#636366]" role="status">
        Não foi possível consultar a assinatura.{" "}
        <button className="underline" onClick={() => void query.refetch()}>
          Tentar novamente
        </button>
      </div>
    );
  const data = query.data;
  const attempt = data.attempt;
  const active = attempt?.status === "PREPARING" || attempt?.status === "AWAITING_SIGNATURE";
  const download = withSelectedUnit(`/api/v1/inventory/${resource}&download=true`);
  const source = withSelectedUnit(`/api/v1/inventory/${resource}&source=true`);
  return (
    <div className="flex max-w-full flex-wrap items-center justify-end gap-2 text-xs text-[#636366]">
      <span aria-live="polite">
        {busy
          ? "Processando assinatura…"
          : attempt
            ? statusLabels[attempt.status]
            : "Documento sem assinatura digital"}
      </span>
      {attempt?.status === "SIGNED" ? (
        <Button asChild variant="outline" className="rounded-xl">
          <a href={download}>Baixar PDF assinado</a>
        </Button>
      ) : (
        <>
          {data.configured && (
            <a href={source} target="_blank" rel="noopener noreferrer" className="underline">
              Revisar PDF a assinar
            </a>
          )}
          {data.canManageIdentity && (
            <Button
              variant="outline"
              className="rounded-xl"
              disabled={busy || active}
              onClick={() => setIdentityOpen(true)}
            >
              Identidade de assinatura
            </Button>
          )}
          {active && data.canSign ? (
            <>
              {attempt?.canResume && attempt.redirectUrl && (
                <Button asChild variant="outline" className="rounded-xl">
                  <a href={attempt.redirectUrl}>Continuar autorização</a>
                </Button>
              )}
              <Button
                variant="outline"
                className="rounded-xl"
                disabled={busy}
                onClick={() => void submit("COMPLETE", { attemptId: attempt!.id })}
              >
                Verificar assinatura
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Cancelar esta tentativa no Allik One? Isso não revoga autorizações já concedidas ao provedor.",
                    )
                  )
                    void submit("CANCEL", { attemptId: attempt!.id });
                }}
              >
                Cancelar tentativa
              </Button>
            </>
          ) : (
            data.canSign && (
              <Button
                className="rounded-xl bg-[#007aff] text-white hover:bg-[#0067d6]"
                disabled={busy || !data.configured || !data.identityReady}
                onClick={() => void submit("START", { operationId: crypto.randomUUID() })}
              >
                Assinar digitalmente
              </Button>
            )
          )}
          {!data.configured && (
            <span>
              {data.configurationReason ||
                "Assinatura indisponível: integração Lacuna ainda não configurada."}
            </span>
          )}
          {data.configured && data.canSign && !data.identityReady && (
            <span>É necessário cadastrar a identidade do signatário.</span>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="basis-full text-right text-red-700">
          {error}
        </p>
      )}
      <Dialog
        open={identityOpen}
        onOpenChange={(open) => {
          if (!busy) {
            setIdentityOpen(open);
            if (!open) setCpf("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar identidade de assinatura</DialogTitle>
            <DialogDescription>
              Vincule o CPF do profissional ao titular esperado do certificado. O servidor verifica
              essa identidade ao concluir a assinatura.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Profissional: {data.signerName}
            {data.identityMaskedCpf ? ` · CPF ${data.identityMaskedCpf}` : ""}
          </p>
          <label className="text-sm" htmlFor={`signature-cpf-${documentId}`}>
            CPF do profissional
          </label>
          <Input
            id={`signature-cpf-${documentId}`}
            value={cpf}
            onChange={(event) => setCpf(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
          />
          <p className="text-xs text-muted-foreground">
            Confirme os dados com o profissional. Consulte também seu cadastro em Usuários antes de
            alterar a identidade.
          </p>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <Button
            disabled={busy || cpf.replace(/\D/g, "").length !== 11}
            onClick={() => void submit("REGISTER_IDENTITY", { cpf })}
          >
            Confirmar identidade
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
