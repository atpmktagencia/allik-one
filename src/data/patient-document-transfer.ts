/** One upload attempt. No retries: the caller retains the operation ID on ambiguity. */
export class DocumentTransferError extends Error {
  constructor(
    message: string,
    public duplicateId?: string | null,
    public code?: string,
  ) {
    super(message);
  }
}
export function transferPatientDocument(
  url: string,
  body: FormData,
  signal: AbortSignal,
  progress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const done = () => signal.removeEventListener("abort", abort);
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.timeout = 120_000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      done();
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(
          new DocumentTransferError(
            "Resposta inválida. Tente novamente para confirmar o recebimento.",
          ),
        );
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && typeof data?.data?.id === "string")
        resolve(data.data.id);
      else
        reject(
          new DocumentTransferError(
            data?.error ?? "Não foi possível receber o arquivo.",
            data?.duplicateId,
            data?.code,
          ),
        );
    };
    xhr.onerror = xhr.ontimeout = () => {
      done();
      reject(
        new DocumentTransferError(
          "Falha de rede. O recebimento pode ter sido concluído; tente novamente para confirmar.",
        ),
      );
    };
    xhr.onabort = () => {
      done();
      reject(
        new DOMException(
          "Envio interrompido. Tente novamente para confirmar o recebimento.",
          "AbortError",
        ),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      done();
      reject(new DOMException("Interrompido", "AbortError"));
      return;
    }
    xhr.send(body);
  });
}
