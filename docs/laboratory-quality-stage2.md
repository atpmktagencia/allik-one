# Etapa 2 — benchmark e evidências laboratoriais

## Entrega A: referência antes da correção

Base: `7d350a6`, branch `feature/allik-patients`. O corpus possui 21 PDFs exclusivamente sintéticos, 28 observações de referência, um original rasterizado sem texto e um documento multipágina. A fonte textual, o conjunto de referência e as previsões controladas ficam em `src/test/fixtures/laboratory-benchmark.ts`; os PDFs e SHA-256 ficam em `src/test/fixtures/laboratory-pdfs/`.

Os casos incluem pontilhados, colunas atual/anterior/referência, nomes semelhantes, valores iguais, unidades diferentes, datas distintas/conflitantes, vírgula/ponto, comparadores, qualitativos, informação ausente, leitura incompleta, omissão e invenção deliberadas. Os PDFs digitais são processados pelo parser de produção; o escaneado deve permanecer sem texto independente. Não existe OCR simulado apresentado como leitura real.

`npm run benchmark:labs` avalia o corpus e escreve `work/laboratory-benchmark.json`. `LAB_BENCHMARK_REPORT` escolhe o destino; `LAB_BENCHMARK_CANDIDATES` pode apontar para um JSON com chaves dos casos e arrays de linhas no contrato atual, para avaliar saídas capturadas sem inferir novamente. Nenhum comando deste benchmark chama IA ou usa credenciais. `npm run benchmark:labs:generate` regenera os PDFs a partir das fontes e do raster sintético versionado.

**Limite de interpretação:** as previsões iniciais são construídas e rotuladas, não extraídas ao vivo pelo modelo. O benchmark mede o avaliador, a integração com o parser e a discriminação do verificador. Não mede acurácia clínica, generalização, latência de inferência ou custo do provedor. Para avaliar um extrator real, importar suas saídas e revisar a referência antes de comparar. A condição de confiança esperada é independente da simples correção do resultado: o documento escaneado ou uma tabela textual ambígua continuam exigindo revisão, mesmo quando a previsão coincide com a referência.

A correspondência para métricas do extrator é um-para-um por nome literal normalizado e página. Duplicatas extras contam como excedentes; erros de transcrição do nome podem produzir simultaneamente uma omissão e uma previsão sem correspondência. Associação correta significa o valor atual correspondente ao parâmetro de referência, não interpretação clínica. Campos ausentes dos dois lados não inflam a acurácia. O relatório apresenta contagens e denominadores por campo.

Linha de base em `docs/benchmarks/laboratory-baseline.json`: 18 linhas integralmente corretas nas previsões controladas, 1 omissão, 1 previsão inventada, 22 associações corretas. O verificador anterior considerou 19 linhas elegíveis, com **6 aceitações indevidas e 3 falsos alertas**. O total de referência e de previsões é 28; uma omissão pode ser compensada em contagem por uma invenção, portanto comparar apenas tamanhos não prova completude.

Relatório separa métricas do extrator e do verificador, versão do pipeline, prompt, verificador, commit-base, hash do original e tempo local. Custo, tokens e tempo de inferência desconhecidos são `null`, nunca zero presumido. Nenhum conteúdo de paciente real participa dos arquivos.

## Entrega B: verificação de campos e associação

Versões: `lab-pipeline-2`, `lab-transcription-2`, verificador 2. O rascunho e o original continuam separados do histórico confirmado. Não há migration, reprocessamento remoto, republicação, novo provedor, classificação automática ou revisão multiagente.

O verificador lê a página extraída independentemente pelo parser existente, identifica uma associação textual inequívoca e produz estados por campo: `supported`, `absent`, `insufficient` ou `contradictory`. Os registros de evidência contêm apenas estado, página e linha, sem copiar trechos clínicos para a telemetria. A evidência produzida pelo modelo permanece acessória: um campo pode ser sustentado diretamente pela fonte mesmo sem trecho da IA. Um trecho não concede confiança quando o texto independente não existe.

- Pontilhados só contam como separadores em limites apropriados; prefixos, sufixos e exames semelhantes continuam distintos.
- Formatos aceitos: uma linha textual com parâmetro seguido de resultado inequívoco, ou tabela com separadores explícitos e cabeçalho que identifica a coluna atual. Referência e resultado anterior não alimentam o campo atual. Seções explicitamente históricas são recusadas.
- Tabelas achatadas, células parcialmente legíveis, cabeçalhos ambíguos e múltiplas ocorrências do mesmo parâmetro na página exigem revisão. Não são inventadas coordenadas nem relações espaciais.
- Coleta, resultado/liberação e emissão possuem papéis separados, com datas ISO ou dia/mês/ano explicitamente rotuladas. Ausência de evidência, conflito entre rótulos e ordem temporal contraditória são estados distintos. `issuedOn` é aditivo e opcional nos rascunhos históricos; é explicitamente nullable na nova saída do modelo.
- Laboratório, método e material devem ter sustentação em cabeçalho da página ou bloco textual imediatamente associado. O método de outro exame não é emprestado.
- Equivalências permitidas são tipográficas: NFC/espaços, capitalização de nomes/metadados, micro sign/Greek mu e L/l de litro nas unidades suportadas. Não há troca de escala, normalização arbitrária de unidades, equivalência de métodos diferentes ou mistura de vírgula/ponto decimal.
- Leituras antigas mantêm seus dados e selos. Verificações v1 não recebem automaticamente a elegibilidade v2 para confirmação em lote. A confirmação individual permanece disponível, com as mesmas regras clínicas de confirmação do paciente, de cada linha e de incertezas resolvidas.

### Comparação objetiva

Os dois verificadores foram executados sobre **os mesmos PDFs, referência e previsões**. O verificador anterior foi novamente executado num worktree isolado do commit da Entrega A. A referência do caso parcialmente ilegível foi corrigida para registrar `[ilegível]`, o conteúdo efetivamente visível, sem atribuir ao original um número oculto. Ambos os relatórios foram então regenerados e têm o mesmo `referenceSha256`. Isso corrige o conjunto de avaliação, não representa melhoria do extrator.

| Métrica nos casos controlados                  | Antes | Depois |
| ---------------------------------------------- | ----: | -----: |
| Observações de referência                      |    28 |     28 |
| Previsões avaliadas                            |    28 |     28 |
| Linhas integralmente corretas                  |    18 |     18 |
| Omissões deliberadas detectadas pelo avaliador |     1 |      1 |
| Previsões sem correspondência/inventadas       |     1 |      1 |
| Associação correta ao valor atual              |    22 |     22 |
| Elegibilidade textual total                    |    19 |     16 |
| Aceitações indevidas                           |     6 |      0 |
| Falsos alertas                                 |     3 |      0 |

A redução de elegibilidade total remove seis aceitações indevidas e recupera três elegibilidades válidas. Há 16 linhas rotuladas como sustentáveis por texto independente e 12 que devem exigir revisão. A avaliação não afirma erro zero em documentos reais. Valores, unidades, datas, referências, laboratório, método e material têm contagens `correct/compared` por caso; são acertos condicionais das previsões com correspondência à referência, separados das omissões e previsões excedentes.

Os JSONs registram versões, commit-base, presença de alterações locais e hash da implementação para evitar atribuir um resultado de código ainda não commitado ao SHA-base. O tempo local inclui parser e verificador, não uma chamada ao modelo. As saídas controladas são intencionalmente iguais nos dois ensaios; não se atribui ao novo prompt melhoria de acurácia sem inferência real.

### Completude: experimento fora do fluxo principal

`laboratory-completeness-experiment.ts` monta inventário de linhas textuais reconhecíveis e compara seus parâmetros/valores com a extração. No caso de omissão deliberada encontra duas linhas e indica uma possível omissão. No escaneado e na tabela achatada não inventa inventário. Retorna sempre `completenessProven:false`.

Não é importado pelos endpoints de extração, publicação ou histórico. A alternativa a avaliar antes de incorporá-lo é um inventário por página/região com cobertura explícita, incluindo avaliação de layout/OCR para o que o texto não representa. A proposta exige corpus mais amplo e resultados experimentais de sensibilidade por formato; ausência de candidatos faltantes não prova completude. Nenhuma mudança no parser PDF ou processamento visual foi incorporada nesta etapa.

### Telemetria e custo

O AI SDK fornece uso agregado da chamada. O adaptador coleta somente tokens de entrada/saída, cache/raciocínio quando disponíveis, provedor/modelo, versões, duração, quantidade de chamadas concluídas/iniciadas, quantidade extraída e falhas. A rota acrescenta duração do processamento e quantidade de linhas/campos divergentes ao evento de auditoria já existente. Não são guardados prompts, respostas brutas, cabeçalhos HTTP, identificadores pessoais ou `usage.raw` em logs de observabilidade.

Uso desconhecido permanece `null`; falha com chamadas parciais não apresenta custo final conhecido. Tokens de raciocínio já pertencem ao total de saída e não são cobrados duas vezes no cálculo. Não há consulta externa de preços ou inferência extra.

A configuração opcional server-only `LAB_EXTRACTION_PRICING_JSON` aceita `provider`, `model`, `inputUsdPerMillion`, `outputUsdPerMillion`, `cachedInputUsdPerMillion` opcional e `asOf`. A tarifa só é usada para aquele provedor/modelo; valores negativos/não finitos são recusados. Sem tarifa, custo é `null`. Sem decomposição/tarifa de cache, o cálculo é explicitamente um limite superior pela tarifa padrão dos tokens. É uma estimativa de tokens, sem câmbio, impostos, OCR ou infraestrutura. Nenhuma tarifa foi configurada remotamente por esta entrega.

### Arquivos e testes

- Benchmark: `src/lib/laboratory-benchmark.ts`, corpus em `src/test/fixtures/`, `src/server/laboratory-benchmark.test.ts`, comandos `scripts/benchmark-laboratory.mjs` e `scripts/generate-laboratory-benchmark.ts`, relatórios em `docs/benchmarks/`.
- Evidências: `src/lib/laboratory-source-association.ts`, `laboratory-evidence.ts`, `laboratory-review-checks.ts`, `laboratory-results.ts` e `laboratory-pipeline-version.ts`.
- Integração/telemetria: `src/lib/laboratory-telemetry.ts`, `src/server/laboratory-extraction.ts` e `laboratory-results.ts`.
- Interface existente: `laboratory-review.tsx`, sem novo layout; rótulos, elegibilidade v2 e campo de emissão no detalhe já existente.
- Regressões: evidências, telemetria, inventário experimental, interface, integração e adaptador de IA. Preservadas as verificações anteriores de autorização, integridade, concorrência, quotas e histórico selado.

### Impacto e limites

No conjunto controlado, os falsos alertas caíram de três para zero. Tempo real de conferência por profissionais não foi medido e não se pode extrapolar a redução para os 52 resultados do documento anteriormente usado no Preview. Nenhum resultado antigo foi recalculado ou alterado. Não houve nova chamada paga e não há custo observado do novo prompt.

Sem OCR independente ou layout confiável, a conferência individual continua necessária. As regras são conservadoras e podem ampliar a revisão de formatos não reconhecidos. A correspondência textual não verifica identidade do paciente nem interpretação médica. O próximo passo de qualidade depende de ampliar o corpus e medir o extrator real; esta entrega não constitui validação clínica.

### Verificação executada

- Benchmark antes e depois: 22/22 testes em cada execução, mesmos hashes de referência e PDFs.
- Suíte unitária/interface completa: 527/527 em 78 arquivos.
- Integração completa em PostgreSQL 16 descartável: 456/456 em 38 arquivos; provisionamento/papel restrito 3/3.
- Regressões de evidência após o último refinamento de escopo de metadados: 27/27.
- E2E Paciente360º com Chromium local, banco descartável e papel restrito: 1/1, 29,5 segundos; revisão, histórico e fluxos relacionados preservados. A primeira tentativa encontrou o navegador Playwright ausente; a execução final utilizou `/usr/bin/chromium` e passou.
- Typecheck, build e lint aprovados; lint conserva os seis avisos anteriores de Fast Refresh.
- Nenhuma inferência paga ou consulta/mutação em bancos remotos foi necessária. Preview e produção não foram usados como bancos de teste.

Entrega A registrada no commit `f6ef4a3` (benchmark inicial). A Entrega B acrescenta as correções, telemetria, referência refinada e relatórios comparáveis. O relatório não certifica acurácia clínica nem mede ganho de tempo real de conferência.
