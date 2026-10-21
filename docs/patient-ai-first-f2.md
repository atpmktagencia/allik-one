# F2 — classificação documental no Preview

Homologação de 21/10/2026. Código de runtime: `3af80f97a4b337ad3714299fc71e79d7c5cb99c5` (backend `fe6689c`). Migration 0077 preservada, sem alteração de schema nesta entrega.

## Ambiente e acesso

- Branch de código: `feature/allik-patients`; candidato publicado pela tag `f2-classifier-candidate` e deployment explícito de Preview.
- URL imutável: https://allik-1pp89wxtx-atp-mkt.vercel.app
- URL fixa de testes: https://allik-one-git-feature-allik-patients-atp-mkt.vercel.app
- Deployment: `dpl_CSS6RXmJh3BGJfNLaNur1u9vUAAC`, READY, SHA acima confirmado antes das inferências.
- Neon: projeto `little-dust-61663559`, branch `br-winter-hill-b69uz195` (`preview/feature/allik-patients`), compute `ep-hidden-cloud-b6hskjjt`, banco `neondb`.
- Runtime restrito `allik_runtime`: SELECT/INSERT nos eventos; sem UPDATE/DELETE/TRUNCATE. As verificações de organização, paciente, ambas as unidades e papel permanecem no backend.
- `DOCUMENT_CLASSIFICATION_ENABLED=true` exclusivamente no target Preview da branch. A configuração inicial foi homologada com false; somente então foi criado o deployment habilitado. O endpoint confirmou ambiente sintético, modelo configurado e prontidão sem expor a chave.
- Produção conservada em `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`, SHA `091612549723e484d41bd3c984e877ddd19365e6`. Nenhuma conexão SQL de produção foi aberta.

## Fluxo entregue

O recebimento F1 conserva o original privado e seu SHA-256. Na mesma transação de um novo upload, registra RECEIVED. Depois do commit e da liberação da conexão, o worker é registrado em `waitUntil` da Vercel. A resposta de upload pode terminar antes da inferência; isso foi exercitado no primeiro documento do benchmark. O cabeçalho opcional `Prefer: wait=classification`, usado na homologação, permite aguardar o mesmo worker, sem um pipeline diferente.

O worker adquire uma das duas vagas globais por advisory lock, reivindica o documento por revisão sequencial e grava STARTED antes de chamar o provedor. Lê os bytes privados, verifica tamanho/hash e utiliza o OpenAI existente. PDFs com texto independente são enviados com numeração original de páginas; PDFs sem texto usam entrada visual. Não foi adicionado OCR.

Saída estruturada: sete categorias, páginas, citações literais e abstenção. O prompt não recebe o nome do arquivo e trata as instruções do documento como dados não confiáveis. A verificação separada exige evidência literal da página, verifica identidade quando há identificação textual e distingue pedido de resultado. Confiança autodeclarada não autoriza uma sugestão sustentada. Scans sem evidência textual independente ficam para revisão.

A Central mostra estado e categorias sem mudar os metadados originais. O painel compacto permite abrir o original, aceitar sugestão sustentada, corrigir ou classificar manualmente, com autoria e motivo. Confirmação exige a declaração de conferência do original/identidade. Histórico diferencia SYSTEM de HUMAN. F2 não abre nem dispara a extração laboratorial automaticamente.

## Confiabilidade e limites operacionais

- GET, navegação e reload apenas consultam; replay do upload não dispara classificação.
- Lock global de duas chamadas simultâneas; lock/revisão por documento; máximo de duas tentativas persistidas e somente nova tentativa explícita após falha.
- SDK sem retries automáticos; timeout de provedor 60 s; janela de aquisição de vaga 90 s; orçamento de execução do worker 180 s; até 12 trabalhos por invocação.
- Respostas posteriores a uma decisão humana são descartadas sem sobrescrever a decisão.
- Falha conserva o arquivo. RECEIVED pendente permite retomada explícita; STARTED órfão permite recuperação após 180 s e nova tentativa separada. Abrir o painel nunca é uma tentativa paga.
- Esta implementação usa o ciclo de vida suportado por `waitUntil`, não promete entrega exatamente uma vez nem substitui uma fila gerenciada. Interrupções da plataforma podem exigir retomada humana.
- Telemetria estruturada registra modelo, versão de prompt, tokens, duração, custo estimado e códigos de verificação, sem conteúdo clínico nos logs. Eventos append-only preservam o contrato estrito da 0077.
- Não foram restauradas cotas por hora/dia. O worker interrompe diante de falha, custo não mensurável ou custo estimado superior a US$ 0,04 por documento. O benchmark reserva no máximo US$ 0,50 e não repete tentativas ambíguas.
- Limites atuais: 4 MiB, 20 páginas, 60 mil caracteres de texto. Identidade textual conservadora depende de rótulo reconhecível e pode exigir revisão legítima. Custos são estimativas com tarifas documentadas na D.2, referência 20/10/2026; não são fatura nem limite financeiro do provedor.

## Benchmark real

Modelo retornado: `gpt-6-luna`; configuração `openai/gpt-6-luna`; prompt `document-classification-prompt-1`; provider OpenAI Responses, store=false. Corpus independente definido antes das chamadas: 12 PDFs sintéticos distintos, 15 páginas, nomes neutros, incluindo documento misto de quatro páginas. Uma inferência por documento, sem retries. Os dois primeiros entraram pela seleção múltipla real da interface; os demais pelo mesmo endpoint autenticado de recebimento.

| Documento                          | Categorias esperadas e recuperadas      | Estado                          | Latência do provedor |
| ---------------------------------- | --------------------------------------- | ------------------------------- | -------------------: |
| Laboratorial numérico              | Resultado laboratorial                  | Sugestão sustentada             |              3,606 s |
| Laboratorial qualitativo           | Resultado laboratorial                  | Sugestão sustentada             |              3,240 s |
| Pedido simples                     | Pedido de exames                        | Sugestão sustentada             |              1,733 s |
| Pedido de painel                   | Pedido de exames                        | Sugestão sustentada             |              2,315 s |
| Receita anterior                   | Prescrição                              | Sugestão sustentada             |              1,357 s |
| Laudo de imagem                    | Laudo de imagem                         | Sugestão sustentada             |              2,339 s |
| Relatório                          | Relatório médico                        | Sugestão sustentada             |              2,336 s |
| Atestado                           | Atestado                                | Sugestão sustentada             |              1,514 s |
| Misto, quatro páginas              | Laboratório, imagem, prescrição, outros | Sugestão sustentada             |              3,138 s |
| Scan legível                       | Laudo de imagem                         | Revisão: sem texto independente |              3,302 s |
| Ilegível                           | Nenhuma; ILLEGIBLE                      | Revisão                         |              4,004 s |
| Adversarial, identidade divergente | Pedido de exames                        | Revisão: identidade divergente  |              1,863 s |

Precisão e recall de categorias: **14/14 associações**, zero falsos positivos/omissões, incluindo todos os sete tipos. LAB_RESULT 3/3, EXAM_REQUEST 3/3, IMAGE_REPORT 3/3, MEDICAL_PRESCRIPTION 2/2, MEDICAL_REPORT 1/1, MEDICAL_CERTIFICATE 1/1, OTHER 1/1. Pares categoria/página: 14 corretos, zero incorretos/ausentes. Não confundir 14 associações ou 15 páginas com 14/15 documentos independentes.

Verificador: nove sugestões sustentadas, três revisões legítimas, uma abstenção explícita por ilegibilidade; nenhuma sugestão insegura ou falso alerta observado contra o gabarito. Os trechos visuais foram comparados às fixtures independentes; a transcrição do modelo não foi usada como evidência independente no runtime. Zero confusões pedido/resultado, falhas de provedor ou chamadas duplicadas observadas.

Consumo: **9.783 tokens de entrada + 1.213 de saída**, custo estimado **US$ 0,0015848**. Latência de inferência: mediana **2,338 s**, mínimo 1,357 s, máximo 4,004 s. A latência não inclui toda a interação humana/upload.

São resultados de uma amostra pequena, sintética e simples; não demonstram acurácia clínica ou robustez universal. Não houve estudo humano nem estimativa de economia de tempo.

## Testes e preservação

- 520 testes de integração, 41 arquivos, PostgreSQL descartável; 600 testes unitários/interface, 83 arquivos; provisionamento restrito 3/3.
- Casos: upload/classificação, mistos, identidade divergente, correção, confirmação, falha/retentativa explícita, resposta tardia, isolamento e autorização, payload, imutabilidade e duas vagas globais compartilhadas entre organizações. Um defeito de fixture do teste de concorrência foi corrigido: cada arquivo simulado agora conserva seus próprios bytes/hash; a suíte completa passou depois da correção.
- Typecheck passou. ESLint em `src`, `scripts` e runners versionados: zero erros, seis avisos de Fast Refresh preexistentes. `npm run lint` abrangente também varre scripts locais ignorados em `work/` e acusa formatação desses artefatos; isso não foi escondido nem corrigido alterando arquivos fora da entrega.
- E2E `laboratory-review.spec.ts`: 1/1, PostgreSQL descartável, preservando conferência, questionário e prescrição do mesmo paciente.
- No Preview: seleção múltipla, execução pós-resposta, documento misto, correção CORRECTED e aceitação CONFIRMED pela interface, download com SHA-256 idêntico e duas recargas sem nova chamada. Zero POST automático de resultados laboratoriais.
- Contagens finais: 42 originais (30 anteriores + 12 novos), exatamente 12 STARTED, nove SUGGESTED, três NEEDS_REVIEW, uma CORRECTED e uma CONFIRMED. Todos os eventos automáticos SYSTEM, decisões HUMAN.
- Digests completos, agregados por ID com separador vírgula, iguais à linha de base: 30 originais anteriores `eab17a1685885aa625b638958041b3a5`; 88 resultados `713f44bd5c8fa62783847475c61a3525`; duas versões `3787eba7f8d71a12604c9a5c2a283708`.

## Evidências reproduzíveis e arquivos

- [Saídas reais](benchmarks/patient-f2-live-results.json), [métricas](benchmarks/patient-f2-metrics.json), [preservação](benchmarks/patient-f2-preservation.json).
- [Corpus e gabarito independente](benchmarks/patient-f2-corpus/manifest.json); gerador `scripts/generate-patient-f2-corpus.mjs`.
- Runner `docs/benchmarks/runners/patient-f2-live.cjs`; avaliador `evaluate-patient-f2.mjs`. Executar o avaliador sobre manifest e saídas não chama IA. O runner pago mantém ledger e não deve ser repetido sobre tentativas ambíguas.
- Runtime: `document-classifier.ts`, `document-classification-worker.ts`, `document-classification-store.ts`, `patient-document-center.ts`, `clinical-access-audit.ts` e rota catch-all da API.
- Interface: `patient-document-center.tsx`, `document-classification.tsx`, `document-classification-view.ts` e hook `useInventory`.

### Capturas do Preview

- [Central com categorias sugeridas](screenshots/patient-f2/02-central-classificada.jpg).
- [Documento misto: evidências por página e eventos](screenshots/patient-f2/06-misto-evidencias.jpg).
- [Correção confirmada e histórico auditável](screenshots/patient-f2/07-historico-correcao.jpg).

As capturas foram feitas no Preview em Chromium headless, viewport 1440 × 1000; os dois últimos arquivos são capturas do próprio painel contextual. A renderização nativa de PDF do navegador headless não é evidência de leitura visual do original: o acesso/download foi verificado separadamente por SHA-256. Nenhuma economia de tempo humano foi medida.

## Desativação e recuperação

Definir o flag de classificação como false somente no Preview da branch e criar novo deployment do mesmo candidato; alternativamente apontar o alias de Preview ao deployment desabilitado `dpl_ALousf5kbUptvwEjMCDpTtVrihhJ`. Não executar rollback SQL destrutivo. Tabela, eventos, originais e journal permanecem. Antes de reativar, inspecionar eventos pendentes e tentativas em voo; retomada/recuperação continuam explícitas. Produção não participa desse procedimento.

## Próxima fase — proposta F3, não implementada

F3 deverá consumir somente classificações laboratoriais sustentadas/confirmadas com escopo de páginas definido. Propor primeiro um contrato de solicitação de extração idempotente vinculado ao mesmo original e à revisão de classificação, reutilizando importações e verificador v3. Documentos mistos precisam preservar a numeração original; escopo ambíguo ou identidade divergente deve bloquear o encaminhamento automático.

A entrega incremental sugerida é: (1) contrato e matriz de elegibilidade; (2) encaminhamento auditado com flag próprio, cancelamento por correção humana e limites de concorrência/custo; (3) apresentação das pendências por exceção, mantendo acesso direto à página original; (4) benchmark sintético de completude, valores, unidades, datas e evidências; (5) homologação visual e operacional. Qualquer alteração de persistência será proposta antes da migration. Resultados continuam fora do histórico validado até confirmação autorizada. F3 depende de aprovação separada.
