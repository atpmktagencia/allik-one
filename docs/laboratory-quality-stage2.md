# Etapa 2 — benchmark e evidências laboratoriais

## Entrega A: referência antes da correção

Base: `7d350a6`, branch `feature/allik-patients`. O corpus possui 21 PDFs exclusivamente sintéticos, 28 observações de referência, um original rasterizado sem texto e um documento multipágina. A fonte textual, o conjunto de referência e as previsões controladas ficam em `src/test/fixtures/laboratory-benchmark.ts`; os PDFs e SHA-256 ficam em `src/test/fixtures/laboratory-pdfs/`.

Os casos incluem pontilhados, colunas atual/anterior/referência, nomes semelhantes, valores iguais, unidades diferentes, datas distintas/conflitantes, vírgula/ponto, comparadores, qualitativos, informação ausente, leitura incompleta, omissão e invenção deliberadas. Os PDFs digitais são processados pelo parser de produção; o escaneado deve permanecer sem texto independente. Não existe OCR simulado apresentado como leitura real.

`npm run benchmark:labs` avalia o corpus e escreve `work/laboratory-benchmark.json`. `LAB_BENCHMARK_REPORT` escolhe o destino; `LAB_BENCHMARK_CANDIDATES` pode apontar para um JSON com chaves dos casos e arrays de linhas no contrato atual, para avaliar saídas capturadas sem inferir novamente. Nenhum comando deste benchmark chama IA ou usa credenciais. `npm run benchmark:labs:generate` regenera os PDFs a partir das fontes e do raster sintético versionado.

**Limite de interpretação:** as previsões iniciais são construídas e rotuladas, não extraídas ao vivo pelo modelo. O benchmark mede o avaliador, a integração com o parser e a discriminação do verificador. Não mede acurácia clínica, generalização, latência de inferência ou custo do provedor. Para avaliar um extrator real, importar suas saídas e revisar a referência antes de comparar. A condição de confiança esperada é independente da simples correção do resultado: o documento escaneado ou uma tabela textual ambígua continuam exigindo revisão, mesmo quando a previsão coincide com a referência.

A correspondência para métricas do extrator é um-para-um por nome literal normalizado e página. Duplicatas extras contam como excedentes; erros de transcrição do nome podem produzir simultaneamente uma omissão e uma previsão sem correspondência. Associação correta significa o valor atual correspondente ao parâmetro de referência, não interpretação clínica. Campos ausentes dos dois lados não inflam a acurácia. O relatório apresenta contagens e denominadores por campo.

Linha de base em `docs/benchmarks/laboratory-baseline.json`: 19 linhas integralmente corretas nas previsões controladas, 1 omissão, 1 previsão inventada, 23 associações corretas. O verificador anterior considerou 19 linhas elegíveis, com **6 aceitações indevidas e 3 falsos alertas**. O total de referência e de previsões é 28; uma omissão pode ser compensada em contagem por uma invenção, portanto comparar apenas tamanhos não prova completude.

Relatório separa métricas do extrator e do verificador, versão do pipeline, prompt, verificador, commit-base, hash do original e tempo local. Custo, tokens e tempo de inferência desconhecidos são `null`, nunca zero presumido. Nenhum conteúdo de paciente real participa dos arquivos.
