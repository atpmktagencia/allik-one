# Etapa D.2 — encerramento técnico com ressalvas

**As seis inferências pendentes foram executadas e a rodada técnica está encerrada.**
A cobertura real v3 passou de seis para **12 PDFs sintéticos distintos** do corpus D.
Isso não representa homologação clínica completa, prova de generalização ou autorização
para publicação automática. Permanecem um erro de escopo do extrator, um falso alerta
do verificador e limitações de evidência e avaliação humana, descritos abaixo.

**Não houve estudo humano nesta fase, por decisão do responsável.** Tempo de
conferência, ações, erros percebidos/não percebidos e economia de tempo são **não
medidos**. Nenhum resultado foi simulado. O pacote preparado anteriormente permanece
histórico e não foi usado como substituto de participantes.

## 1. Candidato e preparação confirmados antes das chamadas

- Commit executado: **`3f007de429cecf87f5255adb35e4608233b2dcdb`**, branch
  `feature/allik-patients`, já sem as cotas antigas de 6/h e 20/dia.
- Deployment READY e Preview: **`dpl_9wpUPeCGKMn1iqgXUmt8yLmji6Ay`**.
- URL imutável usada: <https://allik-bmdfgi7vj-atp-mkt.vercel.app>.
- Pipeline `lab-pipeline-3`, prompt `lab-transcription-3`, verificador 3.
- Configuração de Preview/branch conferida: provedor `openai`, modelo
  `openai/gpt-6-luna`, ambiente `preview`, classificação `synthetic`, preparo de banco
  durante build desabilitado. Nenhum segredo foi exibido ou exportado.
- Sessão HTTP 200: operador sintético `preview-operator@allik.invalid`, SUPER_ADMIN.
  Leitura do import sintético esperado confirmou o banco e verificador v3; extração
  configurada/disponível antes do primeiro pedido pago. As seis respostas completas
  confirmaram depois a autenticação efetiva com o provedor.
- Neon consultado explicitamente: projeto `little-dust-61663559`, branch isolada
  `br-winter-hill-b69uz195`, paciente/unidade sintéticos existentes. A presença do mesmo
  import na sessão do Preview e na branch conferida liga o runtime ao escopo esperado.
- PDFs e referências independentes versionados foram reutilizados e seus hashes
  conferidos. Nenhuma duplicata desses seis hashes existia nesse paciente antes da rodada.

[Preflight, configuração e preservação](benchmarks/laboratory-stage-d2-final-preservation.json).
Os snapshots de bloqueio anteriores continuam preservados como história operacional;
não são o estado atual. A remoção autorizada das cotas está documentada em
[correção do extrator](laboratory-extraction-quota-removal.md).

## 2. Execução limitada e proteção operacional

Fluxo real: **PDF sintético → upload privado → OPEN → EXTRACT → OpenAI → esquema
estruturado → verificador → rascunho para revisão**. Sem saídas controladas como
substituto das seis inferências.

Uma execução por PDF, uma importação por vez, **seis requests de modelo no total**,
sem falhas de provedor, respostas perdidas, novas tentativas ou requests adicionais.
`operationId` e versão estáveis, registro local de tentativa antes do envio, recusa
de reiniciar um lote já capturado e parada diante de HTTP inesperado, status ambíguo,
falha ou versão/escopo divergente. Não houve execução de `SAVE`, `VALIDATE` ou `REOPEN`.

Mantidos no runtime: idempotência, controle concorrente por import, proteção contra
substituição de revisão editada, integridade do original, autorização, auditoria,
timeouts e limites de documento/saída. Concorrência do modelo por import continua 2;
a concorrência entre imports deste benchmark foi **1**. Isso não cria nem comprova
um limitador global de todas as organizações. As cotas antigas não foram restauradas.

O custo foi contido pelo lote finito de seis PDFs pequenos de uma página, ausência de
retries e limites por tentativa. Não foi configurado um teto monetário novo na conta
do fornecedor nem prometida garantia de fatura. As medições abaixo permitem conferir
que não houve chamadas inesperadas nesta rodada. O sandbox descartável foi encerrado
após recuperar as capturas; nenhuma tarefa futura ficou agendada.

## 3. Resultados reais por documento

| PDF                               | Resultados atuais corretos / esperados | Linhas emitidas | Campos corretos / esperados | Verificação                                  |         HTTP EXTRACT | Custo estimado US$ |
| --------------------------------- | -------------------------------------: | --------------: | --------------------------: | -------------------------------------------- | -------------------: | -----------------: |
| `similar-names-distinct-units`    |                                    4/4 |               4 |                       16/16 | 4 elegíveis; unidades distintas preservadas  |              8,357 s |          0,0002508 |
| `scan-degraded` sem rotação       |                                    2/2 |               2 |                         9/9 | 2 atenções legítimas: sem texto independente |              8,626 s |          0,0003309 |
| `historical-dates-current-result` |                                    1/1 |           **2** |                         8/8 | Atual correto; histórico extra sinalizado    |              6,396 s |          0,0002024 |
| `reference-formats-qualitative`   |                                    3/3 |               3 |                       14/14 | 2 elegíveis; 1 falso alerta de referência    |              6,493 s |          0,0002402 |
| `dates-unambiguous-ddmm`          |                                    1/1 |               1 |                         7/7 | Datas de coleta/resultado/emissão corretas   |              6,101 s |          0,0001550 |
| `dates-iso`                       |                                    1/1 |               1 |                         7/7 | Três papéis de data corretos                 |              5,334 s |          0,0001421 |
| **Total D.2**                     |                              **12/12** |          **13** |                   **61/61** | **9 elegíveis; 4 em atenção**                | Mediana **6,4445 s** |      **0,0013214** |

Os 61/61 medem recuperação dos campos positivos **esperados**, não precisão perfeita
da saída. A linha histórica adicional gera quatro campos extras no avaliador
(nome/resultado/unidade/página). Assim, há **61 acertos em 65 campos positivos emitidos
(93,85%)**, recall dos campos esperados 61/61 e precisão de linhas atuais **12/13**.
Ausências corretas e campos nulos não inflam os acertos.

Por campo esperado: nomes 12/12, resultados 12/12, unidades 10/10, referências 6/6,
coleta 3/3, resultado 3/3, emissão 3/3 e páginas 12/12. Laboratório, método e material
não têm positivos esperados neste recorte; não estimar precisão desses campos.

- Omissões de resultados atuais legíveis: **0**.
- Trocas de unidade e erros nos campos das datas atuais: **0 observados**.
- Resultado atual substituído pelo anterior: **0**; linha histórica adicional: **1**.
- Valores numéricos sem origem no PDF: **0 observados**, após inspeção independente.
- Elegibilidades indevidas observadas: **0**; falso alerta confirmado: **1**.
- Atenção: **4/13 linhas (30,77%)** — dois scans, um histórico extra e uma referência.
  Isso não mede trabalho humano nem significa 30,77% de erro do extrator.

[Capturas completas e telemetria](benchmarks/laboratory-stage-d2-live-20261020.json),
[avaliação bruta reproduzível](benchmarks/laboratory-stage-d2-evaluation.json) e
[adjudicação contra os originais](benchmarks/laboratory-stage-d2-adjudication.json).

## 4. Erros, causas e verificação

**E-1 — linha histórica fora do escopo atual.** O PDF distingue coleta 22/03/2026,
resultado 23/03 e emissão 24/03. A Glicose atual é **90 mg/dL**. Há seção histórica
separada, datada de 12/12/2024, com **120 mg/dL**. O extrator recuperou corretamente
90 e suas datas, mas acrescentou uma segunda linha de 120, sem datas estruturadas,
com incerteza explícita de resultado histórico. Portanto é erro de escopo da extração,
não substituição do atual nem número inventado.

O verificador marcou a linha extra com `MODEL_UNCERTAINTY`, `RESULT_NOT_FOUND` e
`FIELD_OMITTED`; não a tornou elegível. O inventário offline reconheceu um resultado
atual e apontou a previsão histórica sem fonte atual correspondente. O campo
`inventedPositive` do avaliador significa valor excedente ao gabarito atual; os quatro
campos adicionais não são quatro alucinações factuais. A necessidade de corrigir o
contrato atual/histórico está comprovada por esta execução; a frequência desse erro
em outros PDFs permanece desconhecida.

**V-1 — falso alerta de referência multilinha.** A Ferritina é 42 ng/mL. A referência
na linha seguinte contém as duas faixas: adultos 20–250 e crianças 7–140 ng/mL. A IA
preservou ambas, conforme PDF e gabarito. O verificador sustentou nome/valor/unidade,
mas não associou a referência da linha de continuação e emitiu `REFERENCE_NOT_FOUND`.
É falha de cobertura do verificador; não se deve selecionar uma população ou enfraquecer
as regras para apagar o alerta. A associação à linha seguinte exige correção posterior
com regressão específica, ainda não implementada nesta homologação.

**Scans — limitação, não falso alerta.** O raster degradado original foi inspecionado:
TSH 0,55 mUI/L, referência 0,4–4,0; Anti-HCV não reagente. A saída acertou ambos. Sem
camada textual independente, as duas atenções são legítimas. A transcrição da própria
IA e a contagem de páginas não constituem evidência independente de conteúdo.

Nenhum erro real foi ocultado por um “passou no verificador”. Os controles adversariais
anteriores continuam separados das seis novas respostas do modelo.

## 5. Completude e consolidação D/D.1/D.2

A matriz agora cobre os **12 PDFs do corpus D**, com uma inferência v3 por PDF:
**44/44 resultados atuais legíveis recuperados e 264/264 campos esperados corretos**,
com a linha histórica extra D.2 e os demais avisos preservados. O documento de oito
páginas contém 24 observações, mas continua sendo **um documento**, não 24 réplicas.
Não foram feitas repetições adicionais; robustez entre execuções não foi quantificada.

[Consolidação e cobertura](benchmarks/laboratory-stage-d2-coverage.json) distingue
custos atuais dos históricos e conserva resultados por formato. Nesta D.2 foram cinco
PDFs digitais (10 resultados atuais, 11 linhas emitidas) e um scan (dois resultados).
Não houve execução nova do documento longo, scan rotacionado ou mascarado: suas
inferências reais anteriores são reutilizadas, não cobradas novamente.

O inventário permanece **experimental e offline**, sempre com
`completenessProven:false`. Nos cinco PDFs digitais novos reconheceu os resultados
atuais sem indicar omissões; no scan a cobertura textual é indisponível. Isso não
prova completude universal. A tabela geométrica da D.1 demonstra que o reconhecedor
pode não identificar exames e ainda retornar zero omissões. Fonte e referência
independentes continuam necessárias para avaliar cada caso.

Não existe par v2/v3 equivalente para estes seis PDFs, portanto não se declara melhora
causal do extrator sobre C/D. O ganho pareado anterior no PDF longo permanece 24 falsos
alertas eliminados, com o mesmo recall. As três datas ambíguas da C não podem ser
“recuperadas” por comparação com PDFs diferentes e inequívocos.

## 6. Tokens, custo e latência

**5.929 tokens de entrada, 1.457 de saída, seis requests iniciados e seis concluídos**,
uso completo, cache lido zero. Nenhuma falha de provedor/timeout/retry. Tokens de
raciocínio já fazem parte da saída e não foram cobrados duas vezes pelo cálculo.

Estimativa pelas mesmas tarifas públicas documentadas em D/D.1, data de referência
20/10/2026: entrada US$0,10/milhão, cache US$0,01/milhão, saída US$0,50/milhão,
[fonte do modelo](https://developers.openai.com/api/docs/models/gpt-6-luna).
**US$0,0013214** nesta rodada; o runtime manteve custo original nulo e o cálculo é
offline, não fatura observada. Histórico v3 US$0,0031469; cumulativo estimado
US$0,0044683, sem cobrar novamente nem misturar tentativas v2 anteriores.

HTTP `EXTRACT`: mediana **6,4445 s**, intervalo **5,334–8,626 s**, sem incluir upload.
Mediana do modelo: **3,210 s**; do processamento: **4,532 s**. Não calcular p95
representativo com seis documentos. Latências e custo de corpora distintos não medem
uma melhoria causal entre versões.

Infraestrutura não é custo zero: sandbox de duas vCPUs ativo por 227,656 s, CPU ativa
7,644 s, saída 397.601 bytes e entrada 11.032.892 bytes. Não há preço/fatura observada
para converter isso em custo nesta entrega. Estimativas de tokens excluem sandbox,
armazenamento, impostos e variações de tier/região.

## 7. Preservação e regressões

Antes: **88 resultados clínicos**, **duas versões**, digest
`713f44bd5c8fa62783847475c61a3525`. Depois, às **19:42:11 de Fortaleza em 20/10/2026**
(22:42:11 UTC): **os mesmos valores e digest**. Foram criados somente seis documentos
sintéticos e seus imports não confirmados. Nenhuma alteração no histórico validado.

Produção continua em `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`, SHA
`091612549723e484d41bd3c984e877ddd19365e6`, antes e depois. Nenhum acesso de escrita,
migration, alteração de variável ou promoção de produção. O código clínico não foi
alterado nesta rodada e a publicação continua exigindo confirmação profissional.

[Regressões, comandos e hashes](benchmarks/laboratory-stage-d2-final-tests.json).
As 463 integrações e três verificações do papel restrito já passaram no candidato
exato `3f007de` na remoção das cotas; não são rotuladas como nova execução deste
benchmark. Os testes focados desta rodada são separados das seis inferências reais.

Reproduzir a avaliação sem IA ou banco:

```sh
npx tsx scripts/report-laboratory-stage-d.ts docs/benchmarks/laboratory-stage-d2-live-20261020.json
npx tsx scripts/report-laboratory-stage-d2.ts
```

O [runner realmente utilizado](benchmarks/runners/laboratory-stage-d2.cjs) exige
sandbox/cwd isolado, dependência Playwright, `pdfs/` com os seis PDFs versionados e
manifesto, além do acesso temporário em variável não versionada. É evidência de
execução, não instrução para repetir chamadas pagas. A reprodução recomendada é o
avaliador offline. Nenhum token de acesso foi salvo nas capturas.

## 8. Conclusão e decisão para a próxima fase

**Encerrar a rodada técnica D.2 com ressalvas registradas.** A cobertura real dos
casos pendentes foi concluída; não há chamadas restantes nesta autorização. Não
confundir esse encerramento com homologação clínica completa, aceitação de todos os
layouts, estabilidade do modelo ou demonstração de economia humana.

Permanecem: escopo histórico extra, referência multilinha, scans sem evidência textual
independente, limites do inventário, ausência de réplicas e de estudo humano. Não houve
OCR adicional, novo fornecedor ou confirmação/publicação automática.

A [proposta da Central de Documentos AI-First](patient-ai-first-next-phase-proposal.md)
foi atualizada com esses achados. Recomenda-se começar pelo recebimento único F1,
classificação corrigível, rastreabilidade e preservação do fluxo v3; expansão da
extração e conferência exige aceitar critérios explícitos para os erros encontrados.
**Nenhuma implementação da próxima fase foi iniciada. Aguarda aprovação.**
