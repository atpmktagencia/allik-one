import { useEffect, useState } from "react";
import { withSelectedUnit } from "@/data/unit-context";
function safeUrl(value: string | null) {
  if (!value || !value.startsWith("/api/v1/inventory/") || value.startsWith("//")) return null;
  return withSelectedUnit(value);
}
export function PrivateDocumentPreview({
  document,
}: {
  document: { title: string; contentType: string | null; previewUrl: string | null };
}) {
  const [preview, setPreview] = useState<{ url: string; type: string } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const url = safeUrl(document.previewUrl);
  useEffect(() => {
    setPreview(null);
    setError("");
    setPending(false);
    if (
      !url ||
      !document.contentType ||
      !["application/pdf", "image/jpeg", "image/png"].includes(document.contentType)
    )
      return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setPending(true);
    void fetch(url, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Não foi possível abrir a prévia privada. Verifique seu acesso e tente novamente.",
          );
        const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
        if (!["application/pdf", "image/jpeg", "image/png"].includes(type))
          throw new Error("Este formato deve ser consultado no registro de origem.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ url: objectUrl, type });
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Não foi possível abrir a prévia.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, document.contentType]);
  return (
    <div className="space-y-2">
      {pending && (
        <p role="status" className="text-sm">
          Abrindo prévia privada…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {url && document.contentType === "text/html" && (
        <iframe
          title={`Prévia privada: ${document.title}`}
          src={url}
          sandbox=""
          referrerPolicy="no-referrer"
          className="h-[60dvh] min-h-80 w-full rounded-md border bg-white"
        />
      )}
      {preview &&
        (preview.type.startsWith("image/") ? (
          <img
            src={preview.url}
            alt={`Original: ${document.title}`}
            className="max-h-[65dvh] w-full rounded-md object-contain"
          />
        ) : (
          <iframe
            title={`Prévia privada: ${document.title}`}
            src={preview.url}
            referrerPolicy="no-referrer"
            className="h-[60dvh] min-h-80 w-full rounded-md border bg-white"
          />
        ))}
      {!pending && !error && !preview && !(url && document.contentType === "text/html") && (
        <p className="text-sm text-muted-foreground">
          Consulte este documento no registro de origem ou baixe o original, conforme seu acesso.
        </p>
      )}
    </div>
  );
}
