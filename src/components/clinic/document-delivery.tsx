import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { readInventoryResponse } from "@/data/inventory-api";
type Context = {
  email: string;
  phone: string;
  emailAvailable: boolean;
  signed: boolean;
  hasAmendments: boolean;
};
export function DocumentDelivery({ documentId }: { documentId: string }) {
  const [context, setContext] = useState<Context | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [unsigned, setUnsigned] = useState(false),
    [amendments, setAmendments] = useState(false),
    [channel, setChannel] = useState<"SEND_EMAIL" | "PREPARE_WHATSAPP">("SEND_EMAIL"),
    [message, setMessage] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [downloaded, setDownloaded] = useState(false),
    [accepted, setAccepted] = useState(false),
    [operationId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/inventory/document-delivery?documentId=${encodeURIComponent(documentId)}`, {
      credentials: "same-origin",
    })
      .then((r) => readInventoryResponse<Context>(r))
      .then((body) => {
        if (!cancelled && body.data) setContext(body.data);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Não foi possível carregar os contatos para envio. Reabra esta janela para tentar novamente.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);
  const recipient = channel === "SEND_EMAIL" ? context?.email : context?.phone;
  async function prepare() {
    if (pending || accepted) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/inventory/document-delivery", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: channel,
          documentId,
          operationId,
          confirmedRecipient: recipient,
          allowUnsigned: unsigned,
          confirmAmendments: amendments,
        }),
      });
      if (channel === "PREPARE_WHATSAPP" && response.ok) {
        if (!response.headers.get("content-type")?.includes("application/pdf"))
          throw new Error("O servidor não devolveu um PDF válido.");
        setFile(
          new File([await response.blob()], `receita-${documentId}.pdf`, {
            type: "application/pdf",
          }),
        );
        setMessage(
          "PDF preparado. Escolha como compartilhar abaixo. A preparação não confirma envio ao paciente.",
        );
      } else {
        const result = await readInventoryResponse<{ status: string }>(
          response,
          "Não foi possível concluir o envio.",
        );
        if (result.data?.status !== "ACCEPTED")
          throw new Error("Não foi possível confirmar o envio.");
        setAccepted(true);
        setMessage("E-mail aceito para envio pelo serviço.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar o envio.");
    } finally {
      setPending(false);
    }
  }
  function download() {
    if (!file) return;
    const url = URL.createObjectURL(file),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(true);
  }
  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: "Documento do atendimento" });
      setMessage(
        "Compartilhamento concluído pelo dispositivo. Confira o destinatário e o envio no aplicativo escolhido.",
      );
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === "AbortError"))
        setError(
          "Não foi possível compartilhar pelo dispositivo. Baixe o PDF e anexe na conversa.",
        );
    }
  }
  const native = Boolean(file && navigator.canShare?.({ files: [file] }));
  return (
    <div className="space-y-4 text-sm">
      {!context && !error && <p role="status">Carregando contatos…</p>}
      {context && (
        <>
          <label className="block space-y-1">
            Canal de envio
            <select
              aria-label="Canal de envio"
              className="h-10 w-full rounded-xl border bg-white px-3"
              disabled={pending || accepted || Boolean(file)}
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value as typeof channel);
                setConfirmed(false);
                setError("");
              }}
            >
              <option value="SEND_EMAIL">E-mail com PDF anexado</option>
              <option value="PREPARE_WHATSAPP">WhatsApp</option>
            </select>
          </label>
          <p className="rounded-xl border p-3 break-all">
            Contato no cadastro: <strong>{recipient || "Não informado"}</strong>
          </p>
          <p className="text-xs text-muted-foreground">
            Se o contato estiver incorreto, corrija o cadastro do paciente antes de enviar. Não será
            criado um link público para a receita.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={pending || accepted || Boolean(file)}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Conferi que este é o contato do paciente.
          </label>
          {!context.signed && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={unsigned}
                disabled={pending || accepted || Boolean(file)}
                onChange={(e) => setUnsigned(e.target.checked)}
              />
              Estou ciente de que o PDF não possui assinatura digital e confirmo seu envio sem
              assinatura.
            </label>
          )}
          {context.hasAmendments && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={amendments}
                disabled={pending || accepted || Boolean(file)}
                onChange={(e) => setAmendments(e.target.checked)}
              />
              Conferi os adendos e retificações vinculados antes de enviar esta via.
            </label>
          )}
          {channel === "SEND_EMAIL" && !context.emailAvailable && (
            <p>O serviço de e-mail não está configurado neste ambiente.</p>
          )}
          {!file && (
            <Button
              disabled={
                pending ||
                accepted ||
                !confirmed ||
                !recipient ||
                (!context.signed && !unsigned) ||
                (context.hasAmendments && !amendments) ||
                (channel === "SEND_EMAIL" && !context.emailAvailable)
              }
              onClick={() => void prepare()}
            >
              {pending
                ? "Preparando…"
                : channel === "SEND_EMAIL"
                  ? "Enviar receita por e-mail"
                  : "Preparar PDF para WhatsApp"}
            </Button>
          )}
        </>
      )}
      {file && (
        <div className="space-y-3 rounded-xl border p-3">
          {native && (
            <Button onClick={() => void share()}>Compartilhar PDF pelo dispositivo</Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={download}>
              Baixar PDF
            </Button>
            <Button
              variant="outline"
              disabled={!downloaded}
              onClick={() =>
                window.open(
                  `https://wa.me/${context?.phone}?text=${encodeURIComponent("Olá! Segue o documento do seu atendimento em PDF.")}`,
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              Abrir WhatsApp
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Na conversa, anexe o PDF baixado e confirme o destinatário. Abrir o WhatsApp não envia
            automaticamente a receita.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
