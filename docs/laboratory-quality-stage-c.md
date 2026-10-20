# Etapa C — benchmark real de extração OpenAI

## Resultado e escopo

Em 20/10/2026 foram executadas **seis inferências reais**, uma por documento sintético versionado, pelo pipeline implantado do commit `4e9f9c034e9465e87cd0d96394ae3814ca2511f9`. Os oito resultados legíveis foram recuperados com valores, unidades e associação corretos. Houve **três datas omitidas em uma observação**, explicitamente encaminhadas para revisão. Não foram observadas invenções de resultados, trocas de unidades, trocas atual/anterior, aceitações indevidas ou falsos alertas nesta amostra. Isso não demonstra erro zero nem acurácia clínica.

O ensaio usa saídas reais do modelo, não `fixture.predictions`. A referência sintética e o PDF foram conferidos independentemente da decisão do verificador. Três agentes auxiliaram na cobertura do corpus, avaliação independente e custo/telemetria; apenas o executor principal realizou as chamadas, evitando duplicação de custo.

Dados brutos estruturados, verificações por campo, hashes, tempos e uso: [laboratory-openai-live-c-20261020.json](benchmarks/laboratory-openai-live-c-20261020.json). O relatório do avaliador offline é gerado separadamente; não substitui estas inferências.

A análise pode ser reproduzida **sem nova chamada de IA**, na raiz do repositório:

```sh
npx tsx scripts/report-laboratory-live-c.ts > work/laboratory-openai-live-c-evaluation.json
```

O script confere hashes dos PDFs, origem no corpus sintético, estado de revisão e ausência de confirmação clínica; usa somente `records[].import.draft.rows` capturadas ao vivo, nunca as previsões controladas. O resultado desta execução está em [laboratory-openai-live-c-20261020-evaluation.json](benchmarks/laboratory-openai-live-c-20261020-evaluation.json). Os candidatos a falso alerta produzidos pelo script foram adjudicados na revisão independente; não representam uma classificação clínica automática.

## 1. Ambiente, modelo e versões

| Item                            | Configuração observada                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Branch/código                   | `feature/allik-patients`, `4e9f9c0`; Entrega A `f6ef4a3`                                        |
| Deployment Preview              | `dpl_4kEKMi4z4YA1utvhwAbvQQJMoUTj`                                                              |
| Banco sintético isolado         | Neon `little-dust-61663559`, branch `br-winter-hill-b69uz195`, `preview/feature/allik-patients` |
| Modelo configurado              | `openai/gpt-6-luna`, chamada Responses direta para `gpt-6-luna`                                 |
| Revisão resolvida do modelo     | Não registrada pelo pipeline; não atribuir uma revisão imutável ao alias                        |
| Pipeline / prompt / verificador | `lab-pipeline-2` / `lab-transcription-2` / `2`                                                  |
| SDKs no lockfile                | `ai@7.0.143`, `@ai-sdk/openai@4.0.96`, `unpdf@1.9.0`                                            |
| Opções existentes               | `store:false`, reasoning `low`, `maxRetries:0`                                                  |

A presença/configuração da credencial autorizada foi verificada sem revelar seu valor. A chave OpenAI é sensível e disponível apenas no runtime do Preview; não foi copiada nem exportada. Reutilizou-se o endpoint autenticado existente, a identidade técnica restrita ao Preview sintético e o paciente de teste já existente. Não foram criados usuários, organizações, provedores ou rotas especiais.

O limite existente é de seis importações/hora e vinte/dia por organização. Havia seis vagas na hora corrente; foram utilizadas exatamente seis, sem alterar contadores ou limites. Limites preservados: PDF até 4 MiB, parser até 100 páginas/200 mil caracteres/8 s cooperativos; extração até 150 s; batch textual até 60 s; máximo de duas páginas/12 mil caracteres por batch e duas chamadas simultâneas; até doze batches e duzentas linhas agregadas. Este ensaio pequeno não exercita os limites máximos.

## 2. Método de ponta a ponta

1. Conferir SHA-256 do PDF contra `src/test/fixtures/laboratory-pdfs/sha256.json`.
2. Enviar um **novo** documento identificado como `BENCHMARK SINTÉTICO C` à central privada existente, com categoria `LAB_RESULT` e intenção `EXAM`.
3. Abrir um rascunho pelo comando `OPEN`; executar `EXTRACT` uma única vez com versão atual e UUID de operação.
4. O backend relê o original privado, valida sua integridade, obtém texto nativo quando disponível, chama OpenAI, valida o esquema e executa o verificador da Etapa B.
5. Capturar a saída estruturada entregue pelo extrator, os estados de revisão e o tempo HTTP. Ler a telemetria já persistida dos seis novos eventos `EXTRACTION_READY` usando consulta somente leitura no banco Preview explicitamente selecionado.
6. Comparar cada observação/campo ao conjunto de referência e ao PDF, sem utilizar o selo do verificador como verdade de referência.

Não foram chamados `SAVE`, `VALIDATE` ou `REOPEN`; nenhuma publicação clínica foi realizada. As saídas são as aceitas pelo contrato estruturado da aplicação, não uma captura do envelope HTTP bruto da OpenAI. O pipeline não persiste response ID, revisão resolvida ou service tier; esses dados permanecem desconhecidos.

Janela de execução: `2026-10-20T03:40:41.159Z` a `2026-10-20T03:41:53.395Z`, equivalente a 00:40–00:41 em Fortaleza. Inclui upload/abertura entre os seis testes. Todas as seis extrações retornaram HTTP 200 e `READY_REVIEW`.

## 3. Corpus, referência e modalidades

O corpus da Etapa B contém 21 PDFs, mas apenas **12 conteúdos distintos**. Variantes como `wrong-unit`, `deliberate-omission` e `unsupported-date` alteram principalmente previsões controladas, não o problema apresentado ao modelo. Não se deve contar essas variantes como 21 amostras independentes.

| PDF executado                | Modalidade efetiva                                      | Valores legíveis de referência | Resultado real                                                     |
| ---------------------------- | ------------------------------------------------------- | -----------------------------: | ------------------------------------------------------------------ |
| `multiple-pages`             | Digital, 2 páginas; PDF integral                        |                              2 | TSH `<0,1` e Anti-HCV `Não reagente`, páginas corretas             |
| `scanned`                    | Raster limpo, sem texto; PDF integral                   |                              1 | TSH `<0,1`, unidade e referência corretas; revisão obrigatória     |
| `multi-column`               | Digital, texto nativo em um batch                       |                              2 | Glicose 90 e Ureia 30; anteriores 100/28 não tratados como atuais  |
| `similar-names-equal-values` | Digital; PDF integral                                   |                              2 | T4 livre 1,2 ng/dL e T4 total 1,2 µg/dL, sem fusão                 |
| `dates-and-metadata`         | Digital, texto nativo em um batch                       |                              1 | Ferritina 45.5 ng/mL e metadados corretos; três datas nulas        |
| `partially-legible`          | Digital com marcador literal `[ilegível]`; PDF integral |                              0 | Uma menção a TSH preservada com incerteza; nenhum número fabricado |

Há **oito valores legíveis e uma menção deliberadamente ilegível**. O marcador não entra no denominador de recuperação de valores clínicos. O modelo preservou essa menção como nona linha de revisão.

As páginas curtas do caso multipágina têm apenas 38/22 caracteres; pelo limiar existente de 80 caracteres, seguem pelo PDF completo. Assim, este teste não mede divisão em vários batches textuais, concorrência ou recomposição de lotes.

Adjudicações da referência, restritas à avaliação:

- A referência antiga de Ferritina omite `issuedOn`, apesar de `Emissão: 05/01/2026` estar impressa. A avaliação inclui `2026-01-05`, sem alterar o corpus ou o contrato da aplicação.
- A referência de Glicose aceita o sufixo redundante `mg/dL`, também impresso, quando a unidade corresponde exatamente à do parâmetro. Não há conversão de escala.
- São admitidas equivalências tipográficas explícitas, como µ/μ e espaçamento; comparadores são preservados.
- As datas de referência assumem DD/MM/AAAA. O PDF tem rótulos em português, mas não declara formalmente o formato, e seus dias/meses são numericamente ambíguos. A omissão conservadora do modelo deve ser registrada como perda de completude frente ao golden, não como data incorreta inventada.

## 4. Qualidade do extrator

Os denominadores abaixo consideram os oito resultados legíveis. Campos ausentes na fonte não inflam precisão. Precisão é corretos/emitidos nos campos positivos avaliados; completude é corretos/positivos esperados. Um campo sem nenhuma emissão tem precisão **não estimável**, não 100%.

| Campo                   | Corretos / emitidos | Corretos / esperados | Omitidos |
| ----------------------- | ------------------: | -------------------: | -------: |
| Nome                    |                 8/8 |                  8/8 |        0 |
| Resultado e comparador  |                 8/8 |                  8/8 |        0 |
| Unidade                 |                 7/7 |                  7/7 |        0 |
| Referência laboratorial |                 4/4 |                  4/4 |        0 |
| Página de origem        |                 8/8 |                  8/8 |        0 |
| Data da coleta          | 0/0 — não estimável |                  0/1 |        1 |
| Data do resultado       | 0/0 — não estimável |                  0/1 |        1 |
| Data da emissão         | 0/0 — não estimável |                  0/1 |        1 |
| Laboratório             |                 1/1 |                  1/1 |        0 |
| Método                  |                 1/1 |                  1/1 |        0 |
| Material                |                 1/1 |                  1/1 |        0 |

Total descritivo: **38/41 campos positivos recuperados corretamente (92,7%)**, com **38/38 emitidos corretos**. Não usar essa média para ocultar a completude de datas de 0/3. Observações recuperadas: 8/8; observações com todos esses campos corretos: 7/8. Informações ausentes na fonte foram mantidas nulas em 47/47 posições avaliadas, contabilizadas separadamente.

Não se observaram resultados inventados, duplicatas extras, erro de unidade, data preenchida incorretamente ou associação errada entre parâmetro e resultado atual. A ausência desses erros nesta amostra não mede sensibilidade do verificador para detectá-los.

**Problema medido:** em Ferritina, o modelo transcreveu as três datas no texto de incerteza, mas deixou `collectedOn`, `reportedOn` e `issuedOn` nulos. Isso comprova perda de estruturação, não falha de leitura dos dígitos. A causa declarada pelo próprio modelo é a ambiguidade dia/mês; a ausência de uma política explícita de formato no prompt é uma explicação plausível, ainda não um efeito causal demonstrado por teste A/B.

## 5. Verificação, erros não detectados e conferência

| Resultado do verificador                           | Linhas | Interpretação independente                                      |
| -------------------------------------------------- | -----: | --------------------------------------------------------------- |
| `literal_match`                                    |    6/9 | Duas multipágina, duas tabela e duas T4; corretas nesta amostra |
| `attention`: fonte independente ausente            |    1/9 | Scan correto, mas sem OCR independente; alerta legítimo         |
| `attention`: `MODEL_UNCERTAINTY` / `FIELD_OMITTED` |    1/9 | Ferritina; as três datas estão individualmente `insufficient`   |
| `attention`: incerteza / associação não comprovada |    1/9 | TSH com marcador `[ilegível]`; abstinência legítima             |

Aceitações indevidas observadas: **0/6 elegíveis**. Falsos alertas observados: **0**. Não havia linhas com valor/unidade incorretos nesta execução; portanto não é possível estimar sensibilidade de detecção desses erros. Não há erro objetivo de campo identificado pela avaliação independente que tenha passado despercebido; isso é uma observação desta amostra, não prova de cobertura.

A omissão das três datas foi detectada por campo. O alerta do scanner não é falso positivo: texto produzido pela mesma IA não fornece uma segunda evidência independente. O ilegível não deve ser confirmado como valor clínico apenas porque o marcador foi transcrito corretamente.

Três das nove linhas exigem atenção específica; seis têm evidência textual suficiente para elegibilidade existente. Isso indica potencial de focalizar a revisão, mas **não mede economia de tempo humano**. Confirmação do paciente e das linhas permanece obrigatória; `literal_match` não publica resultados. Todos os nove `verified` e os seis `patientConfirmed` continuaram falsos.

## 6. Latência, tokens, falhas e custo

Tarifas padrão revalidadas em 20/10/2026 na [documentação oficial do GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna): entrada US$0,10/milhão, cache lido US$0,01/milhão e saída US$0,50/milhão.

| Documento                  | Extrator/modelo (s) | Processamento backend (s) | HTTP EXTRACT (s) |   Entrada |     Saída | Estimativa US$ |
| -------------------------- | ------------------: | ------------------------: | ---------------: | --------: | --------: | -------------: |
| Multipágina                |               5,440 |                     6,853 |            9,666 |       638 |       214 |      0,0001708 |
| Escaneado                  |               4,765 |                     6,093 |            8,203 |     1.339 |       137 |      0,0002024 |
| Tabela atual/anterior      |               4,234 |                     5,546 |            7,657 |       666 |       235 |      0,0001841 |
| Nomes semelhantes/unidades |               4,466 |                     6,022 |            8,140 |       618 |       170 |      0,0001468 |
| Datas/metadados            |               4,923 |                     6,220 |            8,314 |       675 |       316 |      0,0002255 |
| Marcador ilegível          |               2,854 |                     4,383 |            6,499 |       604 |       152 |      0,0001364 |
| **Total**                  |          **26,682** |                **35,117** |       **48,479** | **4.540** | **1.224** |  **0,0010660** |

Mediana HTTP: **8,172 s**; intervalo 6,499–9,666 s. Mediana do extrator: **4,616 s**. Uma execução por caso não sustenta p95 representativo, capacidade ou previsão de latência para laudos extensos. O tempo HTTP exclui upload e abertura; a janela total do ensaio, incluindo essas etapas, foi 72,236 s.

Houve seis requests OpenAI iniciados e concluídos, `usageComplete:true` em todos, zero falhas, zero timeouts e zero novas tentativas. Cada importação desta amostra gerou uma chamada; em documentos textuais maiores vários requests podem ser batches, não retries.

O cache lido foi zero. Os 241 tokens de raciocínio já integram os 1.224 de saída e não são somados novamente. Fórmula aplicada: `(4.540 × 0,10 + 1.224 × 0,50) / 1.000.000`.

**US$0,001066 é estimativa dos tokens observados às tarifas públicas padrão, não cobrança observada nem limite absoluto.** Não inclui infraestrutura, impostos, escrita de cache eventual ou adicionais de região/service tier. Esses atributos não são persistidos. Não extrapolar esse custo de PDFs minúsculos para documentos clínicos longos. A telemetria original manteve `estimatedCostUsd:null`, pois nenhuma tarifa foi configurada no runtime; a estimativa é exclusivamente deste relatório.

## 7. Completude e limitações

O inventário de possíveis omissões permanece offline. Ele reconhece linhas textuais explícitas e reaproveita o reconhecedor de associações do verificador; ambos podem compartilhar pontos cegos. Uma divergência do inventário pode significar parâmetro omitido, valor divergente ou página ausente. Ele não detecta genericamente unidade errada ou linha extra inventada. No scan e em texto achatado não reconhecido, zero candidatos não comprova completude. Seu retorno continua `completenessProven:false`.

Lacunas relevantes:

- Apenas um scan limpo; sem ruído, rotação, cortes ou baixa resolução.
- `multi-column` é uma tabela textual com `|`, não uma tabela geométrica complexa com células mescladas ou desalinhadas.
- O ilegível é uma palavra impressa em PDF digital, não degradação visual real.
- Papéis das datas são explícitos, mas formato numérico não é declarado. Faltam pares com datas inequivocamente DD/MM, ISO, formato explícito e datas ambíguas sem resolução segura.
- Sem PDF misto de laboratórios/imagem/receita, pacientes diferentes, referências por idade/sexo, resultados corrigidos, métodos divergentes, relatórios longos ou múltiplos batches textuais.
- Sem réplicas por documento/modelo. A amostra selecionada, pequena e sintética não comprova qualidade clínica, estabilidade do modelo, classificação documental geral ou generalização.

## 8. Próximos experimentos e segundo modelo

1. Ampliar o corpus sintético com os casos de layout, scans degradados, datas e relatórios longos descritos acima; manter referência por página, valor, unidade, papel temporal e origem.
2. Testar explicitamente a política de datas: formato declarado deve ser transcrito; ambiguidade real deve permanecer sinalizada. Comparar o prompt atual e uma mudança mínima sob o mesmo conjunto, com réplicas e orçamento limitado, antes de decidir qualquer alteração.
3. Medir inventário por página com cobertura conhecida. Avaliar região/layout/OCR quando o parser não representa a estrutura, sem assumir que segmentação por página resolve tabelas divididas ou cabeçalhos herdados.
4. Medir tempo humano e erros residuais numa tarefa sintética de conferência antes de afirmar redução de trabalho por exceção.
5. Acrescentar futuramente revisão resolvida do modelo, response ID seguro, service tier e cobertura de páginas à observabilidade, se necessário para novos ensaios; nada disso foi alterado nesta rodada.

**Não há evidência nesta amostra de necessidade imediata de um segundo fornecedor.** O principal déficit medido é a estruturação conservadora de datas, e o principal impedimento para confiança no scan é ausência de evidência independente. Um segundo modelo pode repetir os mesmos vieses; concordância entre modelos não é verdade de referência nem prova de completude. Se as lacunas ampliadas demonstrarem benefício, avaliar uma segunda leitura somente nos casos de exceção, com referência externa e custo adicional medido, após decisão específica. Nenhum outro fornecedor foi integrado ou recebeu dados.

## 9. Preservação e verificação

- Apenas seis novos documentos sintéticos e seis rascunhos não confirmados foram criados pelos endpoints existentes; originais preservados no armazenamento privado.
- Resultados clínicos existentes do paciente de teste: **88 antes e 88 depois**, mesmo digest `713f44bd5c8fa62783847475c61a3525` da representação ordenada das linhas; versões de revisão: **2 antes e 2 depois**.
- Todos os novos imports estão `READY_REVIEW`; nenhuma linha foi validada ou publicada.
- Deployment de produção permaneceu `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`; nenhum deploy, migration, rotação ou alteração de configuração foi executado.
- Nenhum código de aplicação, UI, verificador, prompt ou regra da Etapa B foi alterado. Os artefatos desta entrega são documentação, evidências sintéticas e análise offline.
- Sandbox temporário de execução encerrado após salvar as evidências. Os seis rascunhos sintéticos ficam identificados no Preview para rastreabilidade; não foram removidos nem confundidos com resultados confirmados.

Verificações locais desta entrega: execução reproduzível do avaliador offline; 35/35 testes de evidência, telemetria e inventário; 22/22 testes do benchmark controlado preservado; TypeScript e ESLint do script aprovados. Esses 57 testes são regressões locais distintas das seis inferências reais, não novas chamadas ao provedor. Nenhuma suíte com banco real ou dado clínico foi executada.

Conclusão de homologação quantitativa: linha de base real estabelecida para estes seis casos, com perda de completude de datas identificada e guardas de revisão preservadas. Publicação automática no histórico clínico continua fora do escopo e bloqueada.
