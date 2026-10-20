# Etapa D — completude e robustez laboratorial

## Resultado

Implementação no commit **`2b16b12c7f6417ae3e9df6042a4e01f793379b07`**, branch `feature/allik-patients`. Preview testado: [endereço fixo](https://allik-one-git-feature-allik-patients-atp-mkt.vercel.app), deployment imutável `dpl_9FxbUKdHHaKS1YLsiN7Rg5dGgfyt` ([URL do candidato](https://allik-dkwdbf14o-atp-mkt.vercel.app)). Produção não foi alterada.

**Ganho real medido:** no mesmo PDF sintético de oito páginas, os resultados continuaram **24/24 corretos**, com **160/160 campos positivos corretos**, e os falsos alertas de verificação caíram de **24 para zero**. Não houve aumento medido de recall ou de completude do extrator nesse par: ambos já estavam corretos. A revisão independente conferiu os PDFs, a referência e as saídas, sem tomar o selo do verificador como verdade.

**Controles adversariais separados:** nos mesmos oito casos determinísticos, as aceitações indevidas do verificador caíram de **6 para 0**, preservando dois positivos legítimos. Esses controles não são inferências reais nem comprovam acurácia clínica.

A comparação real pareada ficou limitada a **um documento**, por um desvio operacional e pela cota existente. Os resultados abaixo distinguem essa limitação, os demais testes reais de linha de base, controles locais e hipóteses futuras. A rodada não constitui homologação clínica ou autorização para publicação automática.

## 1. Causas encontradas

1. **Cabeçalho confundido com exame — comprovado ao vivo e reproduzido localmente.** O reconhecedor v2 considerava `Página 1 de 8 — ...` como primeira observação por conter texto e número. As datas ISO posteriores à paginação, mas anteriores aos exames, ficavam fora do cabeçalho reconhecido. O modelo transcrevia corretamente; o verificador emitia 24 alertas `DATE_UNSUPPORTED`, com 48 campos de data sem suporte.
2. **Datas numericamente ambíguas — observado na Etapa C, preservado nesta etapa.** O PDF da Etapa C tem 02/01, 04/01 e 05/01 sem formato declarado. O modelo leu esses dígitos, mas deixou os três campos estruturados nulos por dúvida DD/MM versus MM/DD. A referência antiga assumia DD/MM. Não existe justificativa para preencher automaticamente esses campos apenas pelo idioma. Permanecem sinalizados.
3. **Herança de metadados entre blocos — comprovada em reproduções sintéticas locais.** Cabeçalhos de laboratório/coleta de outro bloco podiam ser associados ao exame seguinte ou anterior. A primeira versão local da recuperação determinística expôs essa possibilidade; a revisão independente a bloqueou antes da implantação.
4. **Informação omitida sem alerta — comprovada localmente.** Descartar um bloco de escopo ambíguo como se os metadados estivessem ausentes podia deixar uma linha sem pendências. Agora o escopo incerto gera atenção, mesmo com todos os campos nulos.
5. **Identificadores administrativos como resultados — comprovado localmente.** Paginação, idade e outros rótulos administrativos exatos podiam ocultar datas ou parecer parâmetros laboratoriais.
6. **Scan sem fonte independente — limitação comprovada.** O modelo recuperou corretamente os dois resultados do raster degradado/rotacionado na linha de base v2, mas reescreveu pontuação e quebras no campo `evidence`. A própria transcrição não confirma independentemente o documento.

## 2. Melhorias implementadas

- **Pipeline, prompt e verificador v3:** `lab-pipeline-3`, `lab-transcription-3`, verificador `3`; mantém o mesmo provedor, modelo configurado, esquema clínico, limites, retries e guardas de confirmação.
- **Datas por evidência:** parser aceita ISO, notação numérica com interpretação única, ou formato DD/MM/AAAA ou MM/DD/AAAA explicitamente declarado. Valida calendário, horário e cronologia; não usa idioma ou ordem temporal para adivinhar formato.
- **Recuperação conservadora:** preenche apenas campos de data nulos quando nome, resultado, unidade, página, papel e escopo têm sustentação independente e única. Não sobrescreve valores, não remove incertezas e não procura datas no trecho produzido pelo modelo. Datas ausentes/ambíguas permanecem sem recuperação.
- **Auditoria da recuperação:** `dateRecoveries` guarda somente índice da linha, campo, página e linha textual; não registra valores clínicos ou trechos na telemetria. O avaliador distingue a saída entregue de uma reconstrução derivada dos campos originalmente nulos.
- **Escopo de metadados:** paginação e rótulos administrativos não são exames. Blocos intermediários potencialmente referentes a outro exame/amostra não fornecem datas automaticamente. `METADATA_SCOPE_AMBIGUOUS` e `DATE_AMBIGUOUS` impedem elegibilidade silenciosa.
- **Proveniência estrutural do PDF:** um scan sem texto mantém a contagem real de páginas quando disponível. Uma página de origem fora desse limite é rejeitada. Essa contagem não representa OCR nem confirmação de conteúdo.
- **Compatibilidade histórica:** os selos v1/v2 continuam legíveis e não são recalculados; a confirmação em lote exige verificador v3. A confirmação individual e todas as validações clínicas existentes continuam disponíveis. Documentos e versões já validados não são alterados.
- **Inventário experimental v2, somente offline:** cobertura por página/seção textual, páginas ausentes, texto não reconhecido e diagnósticos separados de omissão, divergência de valor/unidade, proveniência ausente/incorreta e previsão sem fonte reconhecível. Consome ocorrências uma a uma, sem deduplicar o mesmo parâmetro em páginas distintas. Retorna sempre `completenessProven:false`.

Não foi adicionada interface, fornecedor, dependência de produção, fila, OCR remoto, migration ou publicação automática.

## 3. Corpus ampliado

Os 21 PDFs anteriores permanecem intactos. Foram acrescentados **12 PDFs exclusivamente sintéticos**, com **19 páginas e 44 observações legíveis de referência**, além de campos deliberadamente não resolvidos. Há referências manuais, hashes e um manifesto separado das saídas dos modelos.

| Casos novos                                                    | Cobertura                                                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `geometric-current-previous`                                   | Tabela com células em coordenadas distintas, cinco colunas, atual/anterior/unidade/referência        |
| `many-pages-repeated-parameters`                               | Oito páginas; 24 observações com datas ISO; mesmos nomes em coletas diferentes; anteriores separados |
| `scan-degraded`, `scan-rotated`                                | Raster com degradação determinística e rotação de 90 graus                                           |
| `scan-partially-masked`                                        | Valor de Ferritina realmente ocultado no raster; não há valor numérico de referência para inventar   |
| `dates-explicit-ddmm`, `dates-unambiguous-ddmm`, `dates-iso`   | Formato declarado, dia maior que 12, ISO e papéis distintos                                          |
| `dates-ambiguous-no-format`, `historical-dates-current-result` | Ambiguidade real e separação entre datas históricas/atuais                                           |
| `reference-formats-qualitative`                                | Comparadores, referências variadas/multilinha e qualitativos                                         |
| `similar-names-distinct-units`                                 | Nomes semelhantes com unidades distintas                                                             |

Arquivos e reprodução: [manifesto e instruções](../src/test/fixtures/laboratory-robustness-pdfs/README.md), `src/test/fixtures/laboratory-robustness.ts`, `scripts/generate-laboratory-robustness.ts` e gerador raster determinístico em Python/Pillow. Pillow/fontes são ferramentas offline; não entram no runtime. Mudanças de versões/fontes devem ser conferidas pelos hashes, não aceitas silenciosamente.

Nem todos os 12 PDFs receberam inferência nesta rodada. Testes de geração/integridade não são testes de qualidade do modelo.

## 4. Benchmark real e desvio operacional

Somente o Preview sintético existente foi usado: projeto Neon `little-dust-61663559`, branch `br-winter-hill-b69uz195`. Credencial OpenAI autorizada reutilizada exclusivamente no runtime, sem exportação. Modelo configurado `openai/gpt-6-luna`, Responses, `store:false`, reasoning `low`, retries SDK `0`. A revisão resolvida do alias não é persistida; a comparação é nominalmente equivalente, não uma garantia de pesos imutáveis.

Procedimento: novo PDF sintético → upload privado com hash → `OPEN` → `EXTRACT` versionado/idempotente → extração estruturada → verificador → rascunho não confirmado. Nenhum `SAVE`, `VALIDATE` ou `REOPEN` foi usado. Repetições criaram novos documentos com justificativa de duplicação, preservando os originais anteriores.

Foram realizadas seis importações pagas, dentro da cota de seis/hora e vinte/dia:

1. Três documentos de linha de base no código `4e9f9c0`: datas explícitas, oito páginas e scan rotacionado.
2. Duas repetições inicialmente destinadas ao candidato ainda chegaram ao v2: o deployment novo estava pronto, mas o alias fixo permanecia apontado ao deployment anterior. A versão persistida na telemetria revelou o desvio. A execução foi interrompida; uma requisição HTTP ficou sem duração/status observados, mas seu backend concluiu e foi reconciliado por leitura. Ambas ficam separadas como `supplementalRecords`/`baseline_repeat`, nunca como resultados v3.
3. O alias foi corrigido e confirmado pelo SHA. A última vaga da hora foi usada no PDF longo, diretamente pela URL imutável do candidato. Telemetria, prompt e verificações confirmaram v3.

Não houve reset, aumento ou desvio de cota. O erro de apontamento restringiu a comparação pareada real a um PDF; datas explícitas e scan não tiveram execução v3 nesta rodada. Os dois custos adicionais estão incluídos no total financeiro. Próximas rodadas devem conferir deployment/SHA e usar URL imutável antes da primeira chamada paga.

Evidências: [capturas reais e tentativas suplementares](benchmarks/laboratory-stage-d-live-20261020.json), [avaliação reproduzível](benchmarks/laboratory-stage-d-evaluation.json).

## 5. Resultados antes/depois equivalentes

**Mesmo PDF, hash, referência, modelo configurado e estratégia de quatro batches textuais**, uma execução principal por versão:

| Métrica — oito páginas                          |     Antes v2 | Candidato v3 |
| ----------------------------------------------- | -----------: | -----------: |
| Resultados legíveis corretos com página correta |        24/24 |        24/24 |
| Campos positivos corretos / emitidos            |      160/160 |      160/160 |
| Unidades corretas                               |        16/16 |        16/16 |
| Referências corretas                            |        24/24 |        24/24 |
| Datas de coleta/resultado corretas              |        48/48 |        48/48 |
| Observações omitidas / inventadas               |        0 / 0 |        0 / 0 |
| Erros de unidade / data / associação atual      |    0 / 0 / 0 |    0 / 0 / 0 |
| Aceitações indevidas observadas                 |            0 |            0 |
| Falsos alertas adjudicados                      |           24 |            0 |
| Linhas com atenção adicional                    | 24/24 (100%) |    0/24 (0%) |
| Recuperações determinísticas de data            |            0 |            0 |

Os 24 alertas anteriores são falsos positivos comprovados: a fonte apresenta as datas ISO nas linhas 3/4 de cada página e os valores estruturados estavam corretos. No candidato, os mesmos campos têm suporte nessas linhas. Ausência de atenção adicional **não dispensa confirmação do paciente, conferência e ação explícita do profissional**. Nenhuma linha foi confirmada durante o benchmark.

Por campo, nome, resultado e página têm 24/24 acertos em cada versão; coleta e resultado têm 24/24 cada, unidades 16/16 e referências 24/24. Emissão, laboratório, método e material não possuem valores positivos esperados neste PDF: sua precisão não é estimável e nulos não inflam os 160 acertos. O JSON detalha esses denominadores por documento e formato.

Não houve ganho medido do extrator nesse pareamento. O mecanismo de recuperação de nulos está coberto por testes e proveniência, mas não precisou atuar nestas saídas reais; não atribuir a ele uma melhora ao vivo inexistente. A redução de falsos alertas também não mede tempo humano economizado.

Os oito controles adversariais usam exatamente os mesmos textos/linhas em v2 e v3:

| Controles locais, sem inferência | Antes | Depois |
| -------------------------------- | ----: | -----: |
| Aceitações indevidas             |     6 |      0 |
| Positivos legítimos elegíveis    |     2 |      2 |
| Falsos alertas                   |     0 |      0 |

Incluem datas ambíguas preenchidas, herança entre laboratórios, idade ocultando omissão, paginação como exame e metadados atribuídos ao exame anterior. [Resultados e hashes](benchmarks/laboratory-stage-d-verifier-controls.json). Não confundir esses seis erros provocados com erros produzidos pelo modelo no benchmark real.

## 6. Demais formatos e comparação com a Etapa C

| Documento / versão realmente executada    | Resultado                                                    | Revisão                                                      |
| ----------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Datas DD/MM explicitamente declaradas, v2 | 1/1 observação; 10/10 campos positivos, incluindo três datas | Sem pendências; já funcionava antes                          |
| Scan degradado e rotacionado, v2          | 2/2 observações; 9/9 campos positivos                        | Duas atenções legítimas por ausência de texto independente   |
| PDF longo, v2/v3                          | 24/24 observações e 160/160 campos em ambos                  | Melhoria medida do verificador: 24 falsos alertas eliminados |

No scan, `evidence` reescreve pontuação/quebras. Isso é defeito de fidelidade do trecho, separado da correção dos valores, e reforça a obrigação de conferência pelo original. **Scans v3, tabela geométrica e raster mascarado não foram homologados por inferência ao vivo nesta rodada.**

A linha de base C continua sendo seis PDFs pequenos, 8/8 resultados e 38/41 campos. O avaliador D reproduziu esses números a partir das saídas C congeladas. O corpus D tem documentos e denominadores diferentes; comparar diretamente 38/41 com 160/160 ou suas medianas não comprova melhora do extrator. O caso ambíguo original continua sem justificativa para recuperar automaticamente as três datas.

## 7. Custo, latência e falhas

Tarifas públicas padrão consultadas em 20/10/2026 na [documentação oficial do modelo](https://developers.openai.com/api/docs/models/gpt-6-luna): entrada US$0,10/milhão, cache lido US$0,01/milhão, saída US$0,50/milhão. Telemetria original de custo permaneceu nula; as estimativas seguintes são externas ao runtime.

| Execução                                            |                   HTTP EXTRACT | Extrator/modelo |    Entrada / saída | Estimativa US$ |
| --------------------------------------------------- | -----------------------------: | --------------: | -----------------: | -------------: |
| Datas explícitas v2                                 |                       15,110 s |        10,919 s |          703 / 151 |      0,0001458 |
| Oito páginas v2 — par principal                     |                       32,400 s |        27,750 s |      3.572 / 2.655 |      0,0016847 |
| Scan rotacionado v2                                 |                       18,789 s |        13,892 s |        2.963 / 261 |      0,0004268 |
| Datas v2 — repetição suplementar                    |                        9,623 s |         5,110 s |          703 / 166 |      0,0001533 |
| Oito páginas v2 — repetição interrompida no cliente |                     Não medido |        31,428 s |      3.572 / 2.624 |      0,0016692 |
| Oito páginas v3 — par principal                     |                       16,324 s |        12,299 s |      4.024 / 2.651 |      0,0017279 |
| **Total das seis importações**                      | Não somar duração desconhecida |               — | **15.537 / 8.508** |  **0,0058077** |

As seis importações geraram **15 requests OpenAI**, porque cada PDF longo exige quatro batches. Todos têm uso completo e nenhuma falha de provedor/timeout; não houve retry SDK. A interrupção intencional do cliente após detectar a versão antiga não é falha da OpenAI nem custo zero. Requests de batches não são novas tentativas.

O par principal observou 32,400 → 16,324 segundos HTTP, com custo US$0,0016847 → US$0,0017279. Uma execução por versão e um alias de modelo não fixado não demonstram redução causal/estável de latência. O prompt v3 é maior; não houve economia de tokens demonstrada. Não calcular p95 representativo com esse tamanho de amostra.

Estimativas de tokens não são fatura observada. Excluem infraestrutura, impostos, eventuais tarifas de região/service tier/escrita de cache. Tokens de raciocínio já integram a saída e não são somados novamente. Custo desconhecido deve permanecer desconhecido.

## 8. Evidência independente e limites ainda não resolvidos

- O inventário continua fora das rotas clínicas. Compartilha o reconhecedor textual do verificador; ambos podem omitir a mesma região. Zero divergências não prova completude.
- Cobertura significa páginas/linhas/seções nativas fornecidas, não percentual de exames encontrados. Não foram inventadas coordenadas de regiões.
- Um scan sem texto tem contagem de páginas conhecida, mas conteúdo não confirmado independentemente. A saída visual da IA, ou concordância consigo mesma, não resolve essa lacuna.
- Alternativa a investigar em experimento separado: rasterização local por página e OCR independente, preservando imagem, versão do OCR, palavras/coordenadas e recortes auditáveis. OCR também erra; só poderia reduzir exceções após benchmark próprio. Não foi instalado ou integrado ao runtime nesta entrega.
- Tabelas geométricas, referências multilinha, fontes mistas, scans degradados/mascarados e cabeçalhos atravessando páginas precisam de mais inferências/repetições. Parser nativo sem geometria não garante associação visual.
- Histórico seguido de tabela atual sem separador de seção explicitamente reconhecido permanece conservadoramente sem associação; exige revisão. Nomes administrativos não previstos e novos layouts continuam fora de uma garantia universal de reconhecimento.
- Os 24 resultados longos são observações distintas, mas do mesmo molde de um único PDF; não equivalem a 24 documentos independentes. Não há validação clínica, generalização, robustez universal ou sensibilidade estimável a todos os erros reais.

## 9. Testes, reprodução e preservação

Verificações locais finais:

- **581/581 unitários/interface**, 80 arquivos.
- **462/462 integração**, PostgreSQL 16 descartável; **3/3** verificações de papel restrito.
- **1/1 E2E Paciente360º** na execução final, 28,1 s de teste, com papel `allik_runtime`, revisão laboratorial, questionário e prescrição.
- **8/8** guardas de Preview/migrations.
- TypeScript, build e lint aprovados; seis avisos anteriores de Fast Refresh permanecem.
- Comparador de oito controles reproduzido exatamente; hashes dos PDFs e referência independentes das saídas; revisão cruzada das saídas reais por agentes separados.

Reproduzir as análises sem nova chamada paga:

```sh
npx tsx scripts/report-laboratory-stage-d.ts docs/benchmarks/laboratory-stage-d-live-20261020.json docs/benchmarks/laboratory-openai-live-c-20261020.json > work/laboratory-stage-d-evaluation.json
npx tsx scripts/compare-laboratory-verifiers.ts > work/laboratory-stage-d-verifier-controls.json
```

O inventário no avaliador é a implementação experimental D aplicada offline às duas saídas. Os `sourceChecks` capturados, usados para comparar verificadores, são os estados reais persistidos em cada execução, sem recálculo retroativo. Tentativas suplementares não integram o par de qualidade e têm custo explicitamente separado.

Segurança observada: seis novos imports sintéticos `READY_REVIEW`, todos com paciente e linhas não confirmados; **88 resultados clínicos e duas versões de revisão antes/depois**, mesmo digest `713f44bd5c8fa62783847475c61a3525` do histórico do paciente de teste. Nenhum documento clínico existente foi alterado. `INVENTORY_PREPARE_PREVIEW=false`; sem migrations/seed remotos. Produção permaneceu `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`. Não foram enviados dados a outro fornecedor ou criados acessos de usuário. Sandbox temporário encerrado após salvar evidências.

## 10. Recomendação

Manter OpenAI e revisão clínica explícita. Na próxima rodada, repetir o pareamento com URL imutável para datas explícitas, ambiguidade, tabela geométrica, scan degradado/rotacionado/mascarado e páginas mistas, respeitando cotas e orçamento. Usar réplicas e referência por observação/campo; medir também tempo humano e erro residual de conferência.

Avaliar OCR independente/local e cobertura por regiões apenas como experimentos comparáveis, sem publicar dados do inventário. A melhoria de falsos alertas demonstrada justifica continuar aperfeiçoando este pipeline; os dados não justificam avançar automaticamente para multi-IA ou anunciar acurácia clínica.
