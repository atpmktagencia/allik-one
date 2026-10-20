/** Package previously built offline HTML; no inference, hosting or clinical access. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
const directory = resolve(process.argv[2] ?? "work/laboratory-study");
const compiled = ts.transpileModule(await readFile("scripts/laboratory-study/serve.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
await writeFile(
  resolve(directory, "iniciar-estudo.mjs"),
  'process.argv[2] ??= fileURLToPath(new URL(".", import.meta.url));\n' + compiled,
);
await writeFile(
  resolve(directory, "LEIA-ME.txt"),
  `ALLIK ONE — ESTUDO SINTÉTICO LOCAL

Use somente o código anônimo atribuído pelo moderador. Não informe nome, e-mail ou dados de pacientes.

1. Extraia o ZIP em uma pasta. P01–P04: abra participante-lote-1.html; P05–P08: participante-lote-2.html.
2. Se o navegador bloquear arquivos locais, instale/use Node.js 22 ou superior, abra o terminal nesta pasta e execute: node iniciar-estudo.mjs
   Acesse http://127.0.0.1:4319/participante-lote-1.html ou /participante-lote-2.html. Ctrl+C encerra. Não há servidor clínico ou conexão com banco.
3. Prefira Chrome/Chromium em desktop, com viewport de 1440 x 900 ou maior e zoom de página de 100%.
4. Leia a explicação e confirme sua participação. Faça o treino; ele não entra nas seis tarefas medidas.
5. Em cada tarefa, confira o original. A = Todos, linha por linha. B = Atenção individual, depois Todos e o original antes de confirmar linhas sem pendências. Os sinais automáticos não comprovam completude.
6. Use os controles de página, zoom e rotação do painel esquerdo. Ao localizar a evidência, clique em Localizei a evidência. Isso é uma declaração sua, não um detector de leitura.
7. Quando perceber um problema, informe linha/tipo e clique em Marcar problema. O moderador pode registrar ajuda. Não invente informação oculta ou ambígua.
8. Clique em Terminar tarefa e responda dificuldade/confiança de 1 a 7. Há limite de oito minutos por tarefa. Dados não resolvidos podem permanecer pendentes.
9. Ao terminar as seis tarefas, clique em Exportar registro anônimo e entregue o JSON ao moderador. Nada é enviado automaticamente. Fechar a página antes de exportar descarta a memória.
10. Não recarregue entre tarefas. Se houver falha/interrupção, informe ao moderador; não repita como se fosse uma primeira sessão independente.

O material é exclusivamente sintético. Não há publicação no prontuário, IA ou cobrança. As operações clínicas são bloqueadas. Os valores apresentados não são orientação médica.
`,
);
execFileSync("python", [
  "-c",
  `import pathlib,sys,zipfile
d=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(d/'allik-estudo-local.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in ['participante-lote-1.html','participante-lote-2.html','iniciar-estudo.mjs','LEIA-ME.txt']:
  info=zipfile.ZipInfo(name,date_time=(2026,10,20,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,(d/name).read_bytes())
`,
  directory,
]);
console.log("Offline participant ZIP created; moderator answers are deliberately excluded.");
