# Etapa D.2 — fechamento de lacunas e validação operacional

**Estado: preparação operacional entregue; homologação ainda aberta.** A cota diária
estava em **20/20** em 20/10/2026, às 05:35 UTC; nenhuma nova inferência foi tentada.
O responsável informou participantes disponíveis e autorizou o estudo. O ambiente local
foi construído e passou no ensaio técnico; **não há registros humanos medidos recebidos**.

## 1. Candidato e preservação

Leitura integral dos relatórios D, D.1 e protocolo D.1, com reutilização dos PDFs,
referências e capturas versionados. Candidato confirmado READY e Preview:

- SHA clínico: `2b16b12c7f6417ae3e9df6042a4e01f793379b07`.
- Deployment: `dpl_9FxbUKdHHaKS1YLsiN7Rg5dGgfyt`.
- URL imutável: <https://allik-dkwdbf14o-atp-mkt.vercel.app>.
- Branch do trabalho: `feature/allik-patients`; HEAD inicial `82b6dca`.
- Pipeline/prompt/verificador continuam v3. Nenhum arquivo clínico, migration,
  configuração de modelo ou limite de extração foi alterado.
- Neon de Preview: projeto `little-dust-61663559`, branch `br-winter-hill-b69uz195`,
  somente paciente/organização/unidade sintéticos. Nenhuma credencial foi exportada.

[Preflight](benchmarks/laboratory-stage-d2-preflight.json). As leituras encontraram
88 resultados clínicos, duas versões e digest `713f44bd5c8fa62783847475c61a3525`.
As etapas locais não têm acesso a esses serviços, nem dependem de credenciais.

## 2. Matriz atualizada e resultados reais

**Novas inferências D.2: zero.** Os números abaixo são medições reais anteriores,
explicitamente atribuídas a D/D.1, não novas saídas nem repetições. Nenhum controle
determinístico preenche a coluna pendente.

| PDF do corpus D                   | Origem da inferência real v3 | Resultados / campos positivos            | D.2                           |
| --------------------------------- | ---------------------------- | ---------------------------------------- | ----------------------------- |
| `similar-names-distinct-units`    | nenhuma                      | não medidos; 4 observações de referência | pendente de cota              |
| `scan-degraded` sem rotação       | nenhuma                      | não medidos; 2 de referência             | pendente de cota              |
| `historical-dates-current-result` | nenhuma                      | não medidos; 1 de referência             | pendente de cota              |
| `reference-formats-qualitative`   | nenhuma                      | não medidos; 3 de referência             | pendente de cota              |
| `dates-unambiguous-ddmm`          | nenhuma                      | não medidos; 1 de referência             | pendente de cota              |
| `dates-iso`                       | nenhuma no PDF dedicado      | não medidos; 1 de referência             | pendente de cota              |
| `dates-explicit-ddmm`             | D.1, uma execução            | 1/1; 10/10                               | reutilizado, sem nova chamada |
| `dates-ambiguous-no-format`       | D.1, uma execução            | 1/1; 4/4; 3 datas ambíguas preservadas   | reutilizado                   |
| `geometric-current-previous`      | D.1, uma execução            | 3/3; 15/15                               | reutilizado                   |
| `scan-rotated` também degradado   | D.1, uma execução            | 2/2; 9/9                                 | reutilizado                   |
| `scan-partially-masked`           | D.1, uma execução            | 1/1; 5/5; Ferritina mascarada sinalizada | reutilizado                   |
| `many-pages-repeated-parameters`  | D, uma execução              | 24/24; 160/160 em oito páginas           | reutilizado                   |

São seis PDFs v3 distintos, 32 resultados legíveis e 203 campos corretos históricos;
nenhuma réplica v3 independente por PDF. As 24 observações do documento longo continuam
sendo um único documento. Há seis PDFs dedicados pendentes, com 12 observações legíveis
de referência ainda sem saída real v3. ISO/qualitativos/anteriores aparecem também em
outros PDFs, mas isso não substitui os casos dedicados ou suas combinações.

[Matriz verificável](benchmarks/laboratory-stage-d2-coverage.json), incluindo campos,
erros, alertas, hashes, custo e latência históricos por documento. Reproduzir sem IA:

```sh
npx tsx scripts/report-laboratory-stage-d2.ts > work/laboratory-stage-d2-coverage.json
```

## 3. Robustez, custo e latência

O limite existente permanece seis importações/hora e vinte/dia. Havia 5/6 na hora,
mas **20/20 no dia**; a vaga horária não autoriza uma chamada além do limite diário.
A renovação diária seguinte é **21/10/2026 00:00 UTC, 20/10 às 21:00 de Fortaleza**.
Não houve tentativa 429, reset, aumento de cota, outra organização ou fornecedor para
contornar o limite. Nenhuma chamada futura ficou agendada.

- D.2: zero requests de modelo e **US$0 de novo custo de tokens**; latência, acurácia,
  erros e falsos alertas de novas inferências são **não medidos**, não zero.
- Referência histórica v3: US$0,0031469 estimados para os seis PDFs; não cobrado de novo.
- D.1 histórico: mediana HTTP 9,485 s em cinco PDFs; não é nova latência D.2.
- Infraestrutura, armazenamento e trabalho humano não foram precificados; não confundir
  ausência de inferência paga com custo operacional total zero.

Plano após renovação, sujeito a novo preflight de SHA, escopo, cotas e orçamento:
seis casos pendentes na primeira janela; até duas réplicas adicionais de cada PDF em
duas janelas horárias posteriores, somente se houver cota. Total planejado máximo 18
imports em três janelas, dentro de 20/dia e 6/hora. Não é uma agenda executada. Registrar
hash do documento, índice da réplica, versão e hora; analisar variabilidade dentro do
PDF, sem transformar 18 chamadas em 18 documentos independentes. Modelo por alias exige
proveniência atualizada; confirmar revisão resolvida quando disponível.

## 4. Ambiente humano operacional

[Acesso e instruções](studies/laboratory-d2/README.md), com pacote local para os
participantes. O responsável autorizou o estudo e informou disponibilidade nesta
conversa. Quantidade efetiva e registros de execução ainda não foram recebidos.

Implementado somente como ferramenta de estudo, fora das rotas da aplicação:

- Componente real `LaboratoryReview`, sem alteração de seu código ou das regras v3.
- Capturas históricas sintéticas reais em um lote; seis mutações controladas em outro.
  São baterias separadas, nunca rotuladas como erro observado da OpenAI.
- S1–S4 em cada lote, sem repetição de PDF por pessoa; três condições A e três B.
- PDF original rasterizado localmente por página, com hash, zoom e rotação; nenhuma
  imagem ou evidência é fabricada a partir da transcrição da IA.
- Fonte e tabela prontas antes de iniciar o cronômetro. Treino separado, limite de oito
  minutos por tarefa, declarações de evidência e problemas, edições, filtros, ajuda,
  páginas, dificuldade/confiança, snapshot final e export JSON anônimo.
- `fetch` restrito a leituras e SAVE **em memória** do caso local. EXTRACT, VALIDATE,
  REOPEN, outras APIs, escopo diferente e destinos externos são recusados. Não existe
  caminho para prontuário, banco ou modelo. CSP bloqueia conexões e frames.
- Servidor opcional restrito a `127.0.0.1`, servindo somente os dois HTMLs. POST e
  qualquer rota de API são recusados sem carregar handlers da aplicação ou `.env`.
- Exportações de ensaio trazem `automated_smoke` e são rejeitadas pelo avaliador humano,
  inclusive com autorização informada na linha de comando. Não há dados de participantes
  fabricados ou enviados automaticamente.

Adaptação explícita: o iframe PDF nativo é substituído **somente no estudo** por viewer
instrumentado e barra de coleta, iguais nas condições A/B. Os tempos absolutos não
representam diretamente o Preview. O estudo também altera a confirmação clínica final
para bloqueio, mantendo apenas a intenção de término e o snapshot local. Estas
limitações devem acompanhar qualquer resultado futuro.

**Métricas humanas nesta entrega: não medidas.** Disponibilidade/autorização não são
tempo, cliques ou detecção de erros. É necessário que os participantes executem o pacote
e entreguem os exports. O avaliador preparado confronta snapshots com o gabarito,
verifica proveniência, informa adesão à condição e preserva percepção/não percepção
confirmada como pendente de adjudicação do moderador. Declaração de evidência não é
prova de leitura; uma marcação não é automaticamente detecção correta.

## 5. OCR e erros residuais

OCR permanece experimental e fora do runtime clínico. O experimento D.1 mostrou erro
de unidade na orientação automática e perda de acentos com idioma inglês. Não foi
reclassificado como novo resultado D.2. O plano separado inclui `por`/`por+eng`, versões
e hashes dos traineddata, orientação automática versus oracle separadas, números,
unidades sensíveis a maiúsculas/prefixos, qualitativos, máscaras e caixas de palavras.
Validar coordenadas contra pixels do original, não contra texto OpenAI; medir conflitos
e concordâncias corretas e incorretas. Concordância OCR/IA não comprova verdade.

O benchmark em português não foi executado nem integrado. São riscos ainda presentes:
geometria não sustentada pelo parser, scans sem evidência textual independente,
transcrição de `evidence` com pontuação alterada, inventário que pode reconhecer zero
exames e apontar zero omissões, nomes/unidades ainda sem inferência no caso dedicado
e ausência de medição da variabilidade do modelo.

## 6. Recomendação

**Manter a homologação aberta.** Seis casos reais pendentes e ausência de resultados
humanos impedem afirmar fechamento de robustez ou redução de trabalho. A preparação
operacional está concreta e verificável; os oito códigos planejados não representam
oito pessoas já medidas.

O próximo trabalho dentro de D.2 é coletar os registros autorizados e executar os casos
pendentes após a renovação, com novo preflight. Não há justificativa medida para novo
fornecedor, confirmação automática ou promoção à produção. A fase seguinte continua
dependendo de revisão e aprovação.

## 7. Testes e entrega verificável

- **22 testes unitários/interface** de conferência e avaliação laboratorial passaram.
- **11 verificações técnicas de navegador** no ambiente de estudo: dois lotes completos,
  capturas locais de edição, eventos, exportação/reset, bloqueio clínico e de escopo,
  CSP bloqueando XHR nativo, rotação/zoom sem perda de geometria, recusa de API pelo
  servidor estático e rejeição de exports automatizados pelo avaliador humano.
- Viewport 1440 × 900, Chromium 151.0.7922.173. Houve somente duas leituras iniciais dos
  HTMLs locais no ensaio; nenhuma chamada HTTP de API/asset/serviço externo. A tentativa
  XHR foi bloqueada por CSP antes da rede, independentemente do mock de fetch.
- Typecheck do projeto e do estudo, lint dos scripts e formatação verificados.
- Hashes dos PDFs, pipeline e componente clínico preservados; reprodução offline da
  matriz. Falha de qualidade do teste nunca foi convertida em resultado humano.

[Validação técnica](benchmarks/laboratory-stage-d2-study-validation.json) inclui hashes
dos HTMLs efetivamente testados. [Manifesto do pacote](studies/laboratory-d2/manifest.json)
permite conferir o ZIP e as versões de origem. [Preservação](benchmarks/laboratory-stage-d2-preservation.json):
os mesmos 88 resultados, duas versões e digest, cota diária 20/20 e produção no mesmo
deployment `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`. Não houve estudo humano medido no lugar
do ensaio técnico.

Reproduzir o ambiente usa somente as dependências existentes do repositório e
`pdftoppm`; não executa build, bootstrap, migrations ou servidor da aplicação clínica.
Os arquivos gerados para participantes rodam sem credenciais e sem instalação de
dependências; apenas o fallback de servidor estático requer Node.js. O commit de
entrega contém os scripts, documentação, ledger e pacote sintético, fora das rotas clínicas.
