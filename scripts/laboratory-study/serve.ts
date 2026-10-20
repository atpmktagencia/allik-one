/** Loopback static server only. Never loads .env, application handlers or credentials. */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function createStudyServer(directory: string) {
  const files = new Map(
    [1, 2].map((group) => {
      const name = `participante-lote-${group}.html`;
      return ["/" + name, readFileSync(resolve(directory, name))] as const;
    }),
  );
  const counts = { documents: 0, denied: 0 };
  const server = createServer((request, response) => {
    const host = request.headers.host ?? "";
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const file = files.get(url.pathname);
    if (!/^127\.0\.0\.1:\d+$/.test(host) || request.method !== "GET" || !file) {
      counts.denied++;
      response.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "STUDY_STATIC_ONLY" }));
      return;
    }
    counts.documents++;
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(file);
  });
  return { server, counts };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createStudyServer(resolve(process.argv[2] ?? "work/laboratory-study"));
  server.listen(4319, "127.0.0.1", () =>
    console.log(
      "Estudo sintético local: http://127.0.0.1:4319/participante-lote-1.html (P01–P04) ou /participante-lote-2.html (P05–P08). Ctrl+C encerra.",
    ),
  );
}
