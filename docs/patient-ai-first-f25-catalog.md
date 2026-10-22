# F2.5 — Catálogo clínico e observações laboratoriais

## Escopo e diagnóstico

Implementação exclusivamente na projeção de leitura do Preview. A tabela compacta, as modalidades, as referências por coleta, as cores e o editor de Ideal foram preservados. Não há migrations, mudança do pipeline, nova inferência, F3 ou publicação clínica.

| Problema                                                           | Causa comprovada                                                         | Tratamento                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Hemácias, Blastos, Células atípicas e outros em grupos inadequados | Agrupamento anterior por regex incompleto                                | Catálogo canônico antes do fallback conservador                                       |
| Potássio em Outros; coagulação sem grupo próprio                   | Ausência das identidades/categorias correspondentes                      | Eletrólitos e minerais; Coagulação / Coagulograma                                     |
| `Obs` como biomarcador                                             | Todas as linhas confirmadas eram encaminhadas ao agrupador numérico      | Projeção separada de narrativas, sem excluir nem alterar linhas confirmadas           |
| `PROTEINA C REATIVA 1`                                             | O título do próprio PDF contém o sufixo, no mesmo item de texto          | Não remover um número cuja natureza espúria não foi demonstrada                       |
| Hemácias `4,630` frente a referência em milhões                    | O original escreve `4,630 /mm3`; separador/escala não estão demonstrados | Original neutro, aviso de conferência, nenhuma conversão ou gráfico numérico inferido |

A investigação da PCR e das hemácias foi feita por leitura nativa independente dos originais já existentes, sem IA. [Trechos e coordenadas](benchmarks/patient-f25-catalog-source-review.json). O número `1` não é erro de extração comprovado; continua uma limitação documental. Não se afirma se é código interno, numeração ou parte clínica legítima.

## Catálogo

`src/lib/laboratory-catalog.ts`, versão `f25-catalog-1`: IDs estáveis, nomes de apresentação, sinônimos/siglas explícitos, grupo clínico, modalidades, unidades documentadas e contrato de comparabilidade por unidade/método/material/laboratório exatos. As unidades listadas não autorizam conversões. Não há fuzzy matching nem remoção geral de números.

Alias adicional confirmado no conjunto existente: `TAP Tempo protrombina` → Tempo de protrombina (TP); atividade protrombínica mantém identidade separada.

Cobertura inicial: hemograma e seus componentes, TP, atividade de protrombina, INR/RNI, TTPa, fibrinogênio; sódio, potássio, cloro, cálcio total e ionizado separados, magnésio e fósforo; PCR convencional e ultrassensível separadas, VHS, HbA1c, B12, T3/T4 livres e totais. Reutiliza os demais grupos anteriores como fallback para nomes não catalogados. O catálogo é extensível, não uma terminologia clínica exaustiva.

Aliases compartilham identidade visual, mas unidade, modalidade, método, material e laboratório continuam particionando as séries. Nenhum resultado numérico é convertido. Metas anteriores não são alteradas; a persistência de Ideal continua pendente de autorização separada, como já documentado na entrega anterior.

## Observações e evidências

`Obs`, `Observação` e `Observações` deixam de criar linhas numéricas. Os textos literais ficam no final do grupo, com a data correspondente e ação “Ver origem · p. N”. Documento, página e coleta precisam coincidir para utilizar o contexto de outros parâmetros. Vocabulário hematológico explícito só sustenta Hematologia se o mesmo contexto contiver exames desse grupo. Páginas mistas sem contexto suficiente, páginas ausentes ou documentos sem pares seguros ficam em “Observações documentais não classificadas”. Não se extrai diagnóstico da narrativa.

Observações de datas distintas continuam em entradas distintas. O detalhe mostra os campos originais. O acesso ao PDF usa a página de origem quando disponível, sem novo download ao alternar apenas a página do visualizador privado. A posição inicial depende do suporte do leitor PDF ao fragmento `#page=N`.

## Segurança e preservação

Nenhuma alteração em autorização ou endpoints de escrita. Reutiliza o histórico autorizado por organização, paciente e unidade, já filtrado no backend. React apresenta narrativas como texto, sem HTML executável. O catálogo não modifica payloads, versões ou documentos. Não houve upload, extração ou classificação durante a validação visual.

Preview: Neon `little-dust-61663559`, branch `br-winter-hill-b69uz195`, compute `ep-hidden-cloud-b6hskjjt`, `neondb`, leituras com `allik_runtime`. Produção não recebe conexões SQL nesta entrega.

## Validação

- Typecheck e ESLint dos arquivos alterados: passaram.
- Regressão unitária/interface: 662 testes em 86 arquivos passaram; teste adicional de página privada: 1/1 passou (663 testes executados no total).
- E2E integrado Paciente360º: 1/1, 28,2 s; banco PostgreSQL descartável e papel restrito, preservando revisão, questionário e prescrição.
- Após a inclusão do alias TAP, typecheck, lint e os 42 testes de catálogo/modalidades passaram novamente.
- Casos novos: identidades e siglas, categorias solicitadas, números legítimos, sufixo PCR não comprovadamente espúrio, modalidades, separação documental/data/página das observações, ambiguidade de escala, referências incompatíveis, imutabilidade dos payloads e navegação ao original.
- Revisão React: hooks incondicionais, projeções derivadas memoizadas, isolamento mantido no backend, nenhum armazenamento clínico novo no browser e liberação de object URLs preservada.

## Publicação e evidências visuais

Runtime: `6767dcf6030bd71d8eda90ba8415c7c5483fc7f4`, tag `f25-clinical-catalog-reviewed`. Deployment `dpl_APcVcGvwastfj7iBun8hti8Rxobi`, READY, target `staging` (Preview), branch de contexto `feature/allik-patients`, SHA conferido antes da captura.

- Preview fixo: https://allik-one-git-feature-allik-patients-atp-mkt.vercel.app
- Candidato imutável: https://allik-cd5sbj7w8-atp-mkt.vercel.app
- [Antes](screenshots/patient-f25-catalog/before-preview.jpg), [depois](screenshots/patient-f25-catalog/after-preview.jpg), [observações ao final do grupo](screenshots/patient-f25-catalog/observations-preview.jpg), [Coagulação](screenshots/patient-f25-catalog/coagulation-preview.jpg), [Eletrólitos](screenshots/patient-f25-catalog/electrolytes-preview.jpg).
- [Medições](benchmarks/patient-f25-catalog-visual.json): 38 → 37 linhas principais, todas com 44 px; remoção de `Obs` da tabela numérica. Cinco observações continuam acessíveis em Hematologia, cada uma datada e com origem. Os 8 pontos vermelhos se mantiveram; os 5 pontos neutros narrativos foram substituídos pelas observações, sem perda de dados.
- Capturas comparadas a 1440×1000: estrutura, colunas e densidade mantidas; nomenclatura canônica e grupos corrigidos. Captura de observações separada por ficar abaixo da primeira área visível. Nenhum POST de upload/classificação/resultados foi disparado pelo fluxo de inspeção. Filtros reais também confirmaram TP e atividade de protrombina em Coagulação e Potássio em Eletrólitos.
- [Preservação](benchmarks/patient-f25-catalog-preservation.json): 43 originais, 123 resultados confirmados e 3 versões clínicas com contagens e hashes integrais idênticos antes/depois. Hashes são evidência de comparação nesta rodada, não substituto de assinatura documental.
- Produção continua em `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`, SHA `091612549723e484d41bd3c984e877ddd19365e6`, conferida pelo domínio oficial. Nenhuma conexão SQL de produção.
- Branches remotas `main` e `feature/allik-patients` não foram movidas; publicação por tag e deployment explícito para evitar acionamentos fora do Preview.

## Limitações remanescentes

1. O significado do sufixo `1` na PCR permanece documentalmente não esclarecido. Removê-lo indiscriminadamente contrariaria o requisito de preservar números não comprovadamente espúrios.
2. Escala de hemácias não corrigida por plausibilidade clínica; depende de evidência/validação. Não há normalização em milhões inferida nem OCR adicional.
3. Catálogo inicial não é exaustivo; desconhecidos continuam no fallback. Observações sem associação segura permanecem documentais, sem perda de texto.
4. A comparação se limita à página de resultados carregada; esse aviso permanece na interface. Um contexto dividido pela paginação pode exigir conferência manual da observação.
5. Persistência de Ideal continua pendente da autorização específica anterior. Nenhuma migration ou meta aplicada nesta rodada.
6. O fragmento de página inicial depende do leitor PDF; a página também permanece escrita no detalhe para conferência manual.

Rollback operacional: apontar apenas o alias de Preview para o deployment anterior `dpl_7hHKfqzxAc4A7wuGne32YtmzzcN2`. Não há rollback de dados, porque a entrega não altera dados clínicos. Não remover observações persistidas nem versões históricas.

## Arquivos alterados

- Catálogo/projeções: `src/lib/laboratory-catalog.ts`, `laboratory-biomarkers.ts`, `laboratory-display-groups.ts`, `laboratory-observations.ts`, `laboratory-scale.ts`, `laboratory-longitudinal-view.ts`.
- Interface e PDF: `src/components/clinic/laboratory-history.tsx`, `encounter-exams-panel.tsx`, `private-document-preview.tsx`.
- Testes: `src/test/laboratory-catalog.test.ts`, `laboratory-history-ui.test.tsx`, `private-document-page.test.tsx`.
- Evidências: este relatório, JSONs de inspeção/preservação/medição, runner visual e cinco capturas em `docs/screenshots/patient-f25-catalog/`.

A inspeção visual utilizou sandbox temporário, encerrado após recolher as evidências. Nenhuma credencial, link temporário de acesso ou documento original foi incluído no repositório. Custo de inferências nesta entrega: nenhum, pois não houve chamadas de IA.
