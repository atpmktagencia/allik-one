# Etapa D.1 — homologação complementar do pipeline v3

**Cinco novas inferências reais v3 concluídas:** oito de oito resultados legíveis e
43 de 43 campos positivos corretos, sem omissão legível, invenção numérica, troca de
unidade, erro de data ou associação atual/anterior observados. As três datas realmente
ambíguas ficaram nulas e sinalizadas. A Ferritina mascarada ficou como `coberto`, com
pendência explícita, sem número inventado.

**A homologação permanece limitada.** Há somente uma execução por documento; oito das
nove linhas emitidas exigem atenção individual. O caso dedicado a nomes semelhantes
com unidades diferentes não recebeu inferência v3 por esgotamento da cota diária.
Nenhum resultado foi publicado, e produção e histórico validado foram preservados.
O estudo humano está preparado, não executado. Esta entrega não autoriza publicação
automática nem demonstra acurácia clínica geral.

## Candidato, isolamento e limites

- Código: `2b16b12c7f6417ae3e9df6042a4e01f793379b07`.
- Deployment imutável: `dpl_9FxbUKdHHaKS1YLsiN7Rg5dGgfyt`, READY e Preview.
- URL usada: <https://allik-dkwdbf14o-atp-mkt.vercel.app>.
- Branch: `feature/allik-patients`; HEAD documental inicial `87cdd5e`.
- Pipeline/prompt/verificador: `lab-pipeline-3`, `lab-transcription-3`, `3`.
- Provedor/modelo: OpenAI direto, alias configurado `openai/gpt-6-luna`, sem revisão
  resolvida persistida. Não foi configurado outro fornecedor.
- Neon: projeto `little-dust-61663559`, branch `br-winter-hill-b69uz195`, somente
  organização/unidade/paciente sintéticos já existentes. A leitura autenticada de um
  import conhecido na URL imutável confirmou o escopo; não foi feita chamada paga no preflight.
- `INVENTORY_ENVIRONMENT=preview`, classificação `synthetic`, preparação automática
  desabilitada. Credencial existente da OpenAI permaneceu apenas no runtime.

[Preflight](benchmarks/laboratory-stage-d1-preflight.json). Os arquivos de código clínico,
manifesto e referências mantêm os hashes da Etapa D. Nenhuma mudança de arquitetura,
interface clínica, banco, migrations ou deployment foi necessária.

O limite existente é seis importações/hora e vinte/dia, por organização. No início:
6/6 na hora e 15/20 no dia. A rodada foi limitada a cinco novas importações, sem reset,
aumento de cota ou uso de outra organização para contorná-la. A prioridade é datas
explícitas, ambiguidade, tabela geométrica, scan degradado/rotacionado e scan mascarado.
O PDF longo v3 da Etapa D foi reaproveitado como evidência histórica, sem nova cobrança.
O caso dedicado a nomes semelhantes/unidades distintas permanece como lacuna. Não
confundir cobertura de unidades diferentes numa tabela com esse teste específico.

## Cobertura real e resultados por documento

Inferências executadas de 05:00 a 05:01 UTC, após a renovação da cota às 02:00 de
Fortaleza. Todos os cinco novos imports terminaram `READY_REVIEW`; paciente e linhas
continuam não confirmados. [Capturas reais](benchmarks/laboratory-stage-d1-live-20261020.json)
e [avaliação reproduzível](benchmarks/laboratory-stage-d1-evaluation.json).

| Documento                    | Resultados legíveis | Campos positivos | Linhas emitidas / atenção | Verificação da fonte                                             |
| ---------------------------- | ------------------: | ---------------: | ------------------------: | ---------------------------------------------------------------- |
| `dates-explicit-ddmm`        |                 1/1 |            10/10 |                     1 / 0 | três datas corretas, formato e papéis explícitos                 |
| `dates-ambiguous-no-format`  |                 1/1 |              4/4 |                     1 / 1 | três datas nulas com `DATE_AMBIGUOUS` e incerteza                |
| `geometric-current-previous` |                 3/3 |            15/15 |                     3 / 3 | atuais 91, 32 e 1,3; anteriores não viraram resultados atuais    |
| `scan-rotated`               |                 2/2 |              9/9 |                     2 / 2 | degradado + 90°; TSH e Anti-HCV corretos, sem texto independente |
| `scan-partially-masked`      |                 1/1 |              5/5 |                     2 / 2 | TSH correto; Ferritina sem valor legível, marcada `coberto`      |
| **Novos nesta rodada**       |             **8/8** |        **43/43** |                 **9 / 8** | **cinco PDFs, não nove documentos independentes**                |

Precisão e recall positivos foram 43/43 **nos campos das oito observações legíveis**.
O placeholder ilegível é avaliado separadamente, não amplia esse denominador.
Por campo: nome 8/8, resultado
8/8, página 8/8, unidade 7/7, referência 6/6; coleta, resultado em, emissão,
laboratório, método e material 1/1 cada. Campos ausentes não entram como acertos
positivos. As três datas ambíguas são **não resolvidas preservadas**, não omissões de
informação recuperável. A menção mascarada é avaliada separadamente: `coberto` não é
um resultado laboratorial confirmado nem uma nona observação legível.

| Prioridade D.1                            | Evidência real v3 disponível                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Datas explicitamente declaradas           | nova inferência DD/MM; ISO também presente no PDF longo histórico                                                    |
| Datas ambíguas                            | nova inferência, abstenção correta nos três campos                                                                   |
| Tabelas geométricas                       | nova inferência; extração correta, associação ainda não comprovável pelo verificador                                 |
| Scans degradados                          | nova inferência na variante também rotacionada; scan degradado sem rotação não testado isoladamente no v3            |
| Scans rotacionados                        | nova inferência, rotação de 90°                                                                                      |
| Scans parcialmente mascarados             | nova inferência, abstenção no valor oculto                                                                           |
| Múltiplas páginas                         | evidência v3 da Etapa D, mesmo SHA de código: oito páginas, 24/24 resultados e 160/160 campos                        |
| Atuais e históricos                       | coluna anterior na tabela nova e TSH anterior no PDF longo; caso dedicado a datas históricas ainda sem inferência v3 |
| Nomes semelhantes com unidades diferentes | **pendente**, sem inferência real v3 do PDF dedicado                                                                 |

São **seis PDFs distintos com evidência real v3** ao reunir D e D.1, 32 resultados
legíveis e 203 campos positivos. O documento longo responde por 24 desses resultados;
eles não são 24 réplicas independentes. Os PDFs e referências não foram regenerados.
O JSON registra separadamente os seis casos do corpus D ainda sem inferência v3
individual: `scan-degraded`, `dates-unambiguous-ddmm`, `dates-iso`,
`historical-dates-current-result`, `reference-formats-qualitative` e
`similar-names-distinct-units`. Parte dos formatos aparece em outros casos, mas isso
não equivale a executar os PDFs dedicados nem cobre combinações arbitrárias.

## Extração, verificador e erros residuais

Conferência das saídas contra os originais e a referência manual, sem tomar o selo como
gabarito: zero linhas legíveis omitidas, zero linhas clínicas inventadas, zero erros
observados de unidade/data/associação atual e zero aceitações indevidas. Não houve
recuperação determinística de datas nesta rodada; os três campos explícitos já vieram
corretos do modelo. Não atribuir ao recuperador uma melhora medida inexistente.

As oito pendências são legítimas **segundo a política de sustentação independente**:
uma linha com datas ambíguas, três de tabela sem associação textual comprovada, três
resultados legíveis de scans sem texto independente e uma menção realmente mascarada.
Nenhum falso alerta foi adjudicado sob essa definição. Há, porém, **sete de oito
linhas legíveis corretas ainda exigindo inspeção individual**; zero falso alerta não
significa trabalho manual eliminado. Incluindo a menção ilegível, são 8/9 linhas
(88,9%) com atenção e somente uma elegível à conferência explícita em lote.

Limitações comprovadas nesta rodada:

- **Geometria:** o extrator separou corretamente a coluna atual, mas o verificador
  devolveu `ASSOCIATION_UNPROVEN` nas três linhas. O inventário offline reconheceu
  zero observações nessa tabela e retornou zero possíveis omissões, além de texto não
  reconhecido e três previsões sem fonte reconhecível. Isso ilustra por que ausência
  de divergências não prova completude. O inventário permanece fora do fluxo clínico.
- **Scans:** os valores vieram corretos, mas `evidence` do scan rotacionado trocou
  pontuação e juntou linhas. Fidelidade do trecho continua imperfeita, fora dos 43
  campos positivos avaliados. A transcrição visual não se tornou evidência independente.
- **Ilegibilidade:** o placeholder de Ferritina tem incerteza e atenção. Não é número
  recuperado e não pode ser apresentado como exame validado.
- **Sensibilidade a erro:** não surgiu erro numérico/de unidade real para desafiar o
  verificador. Zero aceitação indevida observada não estima sensibilidade; essa métrica
  permanece não estimável. Controles determinísticos da Etapa D continuam separados.

## Comparações equivalentes v2/v3

Mesmos PDFs/hashes, referências e modelo configurado. Agora há dois novos pares reais
com a linha de base v2 da Etapa D, além do par longo já conhecido:

| PDF                        | Resultados v2 → v3 |    Campos v2 → v3 |       Atenção v2 → v3 | Origem do par                           |
| -------------------------- | -----------------: | ----------------: | --------------------: | --------------------------------------- |
| Datas explícitas           |          1/1 → 1/1 |     10/10 → 10/10 |                 0 → 0 | v2 histórico D / v3 novo D.1            |
| Scan degradado/rotacionado |          2/2 → 2/2 |         9/9 → 9/9 |                 2 → 2 | v2 histórico D / v3 novo D.1            |
| Oito páginas               |      24/24 → 24/24 | 160/160 → 160/160 | 24 falsos alertas → 0 | ambos históricos D, sem nova inferência |

Datas e scan preservaram os acertos, sem ganho de recall ou de redução de pendências
demonstrado. O ganho de falsos alertas continua restrito ao único PDF longo da Etapa D.
Os outros três PDFs novos não têm linha de base v2 equivalente; não inventar comparação
nem executar versão antiga para preencher a cota. Alias de modelo sem revisão fixa,
uma execução por versão e documentos selecionados impedem conclusões causais amplas.

## Custo e latência das novas inferências

| PDF                   |        HTTP EXTRACT |     Extrator/modelo |   Entrada / saída | Estimativa US$ |
| --------------------- | ------------------: | ------------------: | ----------------: | -------------: |
| Datas explícitas      |             9,485 s |             5,017 s |         816 / 165 |      0,0001641 |
| Datas ambíguas        |             8,291 s |             4,898 s |         791 / 209 |      0,0001836 |
| Tabela geométrica     |             8,819 s |             5,188 s |         828 / 286 |      0,0002258 |
| Scan rotacionado      |            10,100 s |             6,360 s |       3.076 / 257 |      0,0004361 |
| Scan mascarado        |            13,413 s |             9,688 s |       1.954 / 428 |      0,0004094 |
| **Cinco importações** | **mediana 9,485 s** | **mediana 5,188 s** | **7.465 / 1.345** |  **0,0014190** |

Cinco requests OpenAI concluídos, nenhuma falha, timeout, interrupção ou retry; uma
request por PDF novo. O PDF longo histórico e as tentativas D não integram o custo
atual. HTTP mede somente a chamada `EXTRACT`, incluindo obtenção do original,
processamento e persistência, sem somar upload; os timestamps do fluxo também estão
nas capturas. Não há p95 representativo com cinco documentos.

Estimativa pelas mesmas tarifas públicas padrão da Etapa D, consultadas em 20/10/2026:
entrada US$0,10/milhão, cache US$0,01/milhão, saída US$0,50/milhão, na
[documentação do modelo](https://developers.openai.com/api/docs/models/gpt-6-luna).
Cache observado: zero. Raciocínio já integra tokens de saída. A telemetria original
mantém `estimatedCostUsd:null`; o cálculo é offline, não fatura observada. Infraestrutura,
armazenamento, sandbox, impostos e variações de tier/região não estão incluídos.
Não comparar medianas de corpora diferentes como melhora de desempenho do modelo.

## Experimento independente de OCR — medido offline

Tesseract **5.5.0**, rasterização por `pdftoppm` a 150 dpi, idioma `eng` (os únicos
recursos instalados são `eng` e `osd`). Foram usados exatamente os três PDFs sintéticos
versionados, conferidos por SHA-256, sem texto produzido pela OpenAI como entrada ou
gabarito. Não foi instalado nem integrado OCR à aplicação.

Dez execuções: PSM 3 (layout automático), PSM 1 (orientação automática) e PSM 6 (bloco
único) em cada PDF; adicionalmente, PSM 6 no rotacionado com correção de orientação
conhecida pelo gerador. Essa última condição é **oracle**, não detecção automática.
As referências independentes são o raster original e o manifesto manual da Etapa D.

| Fonte / condição                    | Número TSH                  | Unidade TSH    | Qualitativo acentuado | Observação                                            |
| ----------------------------------- | --------------------------- | -------------- | --------------------- | ----------------------------------------------------- |
| Degradado, três PSMs                | correto                     | correta        | `Nao`, sem acento     | não houve reconhecimento literal completo             |
| Rotacionado, PSM 3/6                | não localizado corretamente | não localizada | não localizado        | orientação não resolvida                              |
| Rotacionado, PSM 1                  | correto                     | `mUlI/L`       | `Nao`, sem acento     | erro real de unidade apesar de recuperar os números   |
| Rotacionado, rotação oracle + PSM 6 | correto                     | correta        | `Nao`, sem acento     | ganho condicionado à orientação conhecida             |
| Mascarado, três PSMs                | correto                     | correta        | não se aplica         | Ferritina reconhecida sem número; máscara lida como ` |     | `   |

Essas são verificações literais de evidência na mesma linha, **não métricas de extração
estruturada ou de segurança clínica**. Nenhuma conversão de unidade, correção do OCR ou
remoção de acentos foi usada para transformar erro em acerto. Confiança de palavra não
é probabilidade calibrada de correção clínica. Dez execuções sobre três PDFs não são
dez documentos independentes.

O [JSON experimental](benchmarks/laboratory-stage-d1-ocr.json) preserva palavras,
coordenadas, confiança, configuração, hashes dos PDFs e rasters, diagnóstico de cada
execução e duração. As coordenadas pertencem ao raster indicado, inclusive quando
transformado; não foi afirmado mapeamento clínico de regiões. A mediana observada de
OCR foi **359 ms**, sem incluir rasterização ou custeio de infraestrutura. Não há
chamadas pagas ou custo de fornecedor nesse experimento; infraestrutura não equivale
a custo zero.

Reprodução local, sem chamadas externas:

```sh
python scripts/benchmark-laboratory-ocr.py --output work/laboratory-ocr-d1
```

Recomendação: vale pesquisar OCR independente para localização auditável da evidência,
mas este motor/configuração ainda não sustenta confirmação automática. São necessários
benchmark específico com português, orientação, números, unidades, referências,
bounding boxes e degradações variadas, além de medição de conflitos OCR/modelo. Sem
essa validação, scans continuam exigindo revisão pelo original. Concordância de dois
motores também não prova correção ou completude.

## Estudo humano — preparado, não executado

[Protocolo completo](laboratory-stage-d1-usability.md), com oito participantes no piloto,
ordens A/B contrabalanceadas, seis tarefas documentais, bateria controlada separada,
gabarito independente, isolamento local e critérios de erro residual. As planilhas de
eventos e tarefas estão vazias por intenção.

Compara `Todos`/conferência individual com os filtros e confirmação explícita por
exceção já existentes. Inclui tempo, ações, evidência localizada, erros percebidos/não
percebidos, omissões e dificuldade. Não mede diagnóstico. A cópia local com bloqueio de
rede ainda precisa ser preparada e verificada antes de recrutar.

**Nenhum tempo humano economizado ou redução de erros humanos foi demonstrado.**

## Reprodução e preservação

O avaliador D foi reproduzido com os mesmos resultados semânticos. Seu hash histórico
corresponde à serialização `JSON.stringify(parsedCapture,null,2)` sem newline; os bytes
versionados foram formatados depois. A única diferença de conteúdo na reprodução é o
hash de serialização; as métricas, saídas e decisões são iguais. Os artefatos históricos
foram preservados; D.1 registra os hashes dos arquivos que efetivamente consome.

O novo agregador offline reutiliza o avaliador D sem modificá-lo, mantém custos atuais
separados das saídas históricas e exige comprovação de v3 para saídas bem-sucedidas.
Falhas e resultados desconhecidos permanecem nos denominadores; custo desconhecido
não vira zero. A avaliação do campo e do resultado independe do selo do verificador.

```sh
npx tsx scripts/report-laboratory-stage-d1.ts docs/benchmarks/laboratory-stage-d1-live-20261020.json > work/laboratory-stage-d1-evaluation.json
```

Antes: **88 resultados**, **duas versões clínicas**, digest
`713f44bd5c8fa62783847475c61a3525` no paciente sintético. Depois: **os mesmos 88,
duas versões e mesmo digest**. Cinco novos imports não confirmados. Nenhum `SAVE`,
`VALIDATE` ou `REOPEN` foi executado. O fluxo experimental é upload de PDF sintético →
`OPEN` → `EXTRACT` idempotente → revisão não confirmada. O original é preservado.

Ao final, cota diária **20/20**, hora **5/6**, sem novas chamadas agendadas. Sandbox
temporário encerrado após salvar capturas e telemetria. Produção continuou em
`dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`.
[Evidência de preservação](benchmarks/laboratory-stage-d1-preservation.json).

Verificações desta entrega:

- **82 testes unitários/interface** focados em avaliação, evidências, datas e conferência.
- **26 testes offline de servidor**, corpus, parser e extrator com SDK controlado,
  separados das cinco inferências reais.
- Typecheck e lint do agregador aprovados; corpus e hashes do pipeline inalterados.
- Agregador testado com falha/resultado desconhecido: preserva denominadores e custo
  desconhecido, sem fabricar sucesso. Esse teste não entra nas métricas reais.
- Reprodução semântica da avaliação D; conferência de todos os campos novos e suas
  pendências contra PDFs/referências. Os dez resultados do OCR, inclusive falhas de
  reconhecimento, e suas caixas dentro do raster são preservados no JSON.

## Recomendação e limite de liberação

O v3 preservou os acertos nos dois novos pares equivalentes e se absteve corretamente
nos casos ambíguo e mascarado. Isso apoia continuar a homologação **com revisão clínica
explícita**. Não há evidência para reduzir controles, publicar automaticamente ou
declarar o conjunto de formatos integralmente homologado.

Prioridades propostas para uma rodada aprovada posterior:

1. Completar nomes semelhantes/unidades distintas e os PDFs dedicados restantes,
   acrescentando réplicas antes de estimar confiabilidade por formato.
2. Executar o estudo humano preparado, com cópia local bloqueada e erros controlados
   analisados separadamente. Medir o impacto dos 7/8 resultados corretos ainda sujeitos
   a inspeção, em vez de inferir economia de tempo pelo selo.
3. Se aprovado um benchmark próprio, comparar OCR local em português, orientação e
   geometria com referência independente, antes de integrá-lo à conferência.

Não há indicação medida nesta rodada de necessidade de um segundo fornecedor. A
lacuna principal observada é sustentação independente e conferência, apesar da boa
transcrição nesta pequena amostra. **A próxima fase aguarda revisão e aprovação.**
