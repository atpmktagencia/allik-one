# Etapa D.2 — fechamento de lacunas e validação operacional

**Estado: homologação técnica ainda aberta; seis inferências reais bloqueadas pela
cota diária.** A continuidade foi autorizada, mas a leitura de 20/10/2026 às
**14:23 UTC** confirmou **20/20**. Não foram executadas novas chamadas nem alterados
limites. A renovação seguinte é **21/10/2026 00:00 UTC — hoje, 20/10, às 21h de
Fortaleza**. Nenhuma chamada futura está agendada.

**Decisão atual do responsável: não realizar estudo humano nesta fase.** Substitui a
autorização anterior de participantes. O estudo não é requisito pendente para encerrar
esta rodada técnica; sua ausência limita as conclusões sobre a experiência de revisão.
Tempo, ações, erros humanos e economia de tempo continuam **não medidos**. Não há
estimativas ou resultados simulados.

## 1. Candidato, escopo e evidências

Relatórios D, D.1, protocolo de usabilidade, capturas reais, referências independentes
e avaliadores preservados. Rechecagem pelos conectores, sem exportar credenciais:

- SHA clínico: `2b16b12c7f6417ae3e9df6042a4e01f793379b07`.
- Deployment READY de Preview: `dpl_9FxbUKdHHaKS1YLsiN7Rg5dGgfyt`.
- URL imutável: <https://allik-dkwdbf14o-atp-mkt.vercel.app>.
- Branch: `feature/allik-patients`; HEAD inicial desta continuação: `26fdbae`.
- Nenhuma diferença de `src`, dependências ou `vercel.json` entre o candidato e esse HEAD.
- Pipeline `lab-pipeline-3`, prompt `lab-transcription-3`, verificador 3; modelo
  configurado histórico `openai/gpt-6-luna`, mesmo fornecedor e limites.
- Preview sintético identificado anteriormente: Neon `little-dust-61663559`, branch
  `br-winter-hill-b69uz195`. Só essa branch recebeu consultas SQL de leitura.
- Nesta continuação não se iniciou nova sessão de runtime ou sandbox, pois a cota
  já impedia inferência. A configuração e identidade sintética do runtime foram
  comprovadas nas rodadas anteriores, não revalidadas por uma nova extração agora.

[Evidência atual](benchmarks/laboratory-stage-d2-continuation.json) contém horários,
SHA/deployment, cota, snapshot e a decisão sobre o estudo. Os arquivos de
[preflight inicial](benchmarks/laboratory-stage-d2-preflight.json) e
[preservação inicial](benchmarks/laboratory-stage-d2-preservation.json) continuam
intactos como registros históricos, inclusive da autorização humana anterior.

## 2. Extração, completude e verificação consolidadas

**Inferências novas da D.2: zero.** Os números medidos são de D/D.1. Não se usaram
controles determinísticos para preencher lacunas de inferência.

| PDF sintético                     | Inferência real v3 existente | Resultados / campos positivos                | Situação D.2 |
| --------------------------------- | ---------------------------- | -------------------------------------------- | ------------ |
| `similar-names-distinct-units`    | nenhuma                      | não medidos; 4 resultados de referência      | pendente     |
| `scan-degraded` sem rotação       | nenhuma                      | não medidos; 2 de referência                 | pendente     |
| `historical-dates-current-result` | nenhuma                      | não medidos; 1 de referência                 | pendente     |
| `reference-formats-qualitative`   | nenhuma                      | não medidos; 3 de referência                 | pendente     |
| `dates-unambiguous-ddmm`          | nenhuma                      | não medidos; 1 de referência                 | pendente     |
| `dates-iso`                       | nenhuma no PDF dedicado      | não medidos; 1 de referência                 | pendente     |
| `dates-explicit-ddmm`             | D.1, uma execução            | 1/1; 10/10                                   | reutilizado  |
| `dates-ambiguous-no-format`       | D.1, uma execução            | 1/1; 4/4; três datas ambíguas mantidas nulas | reutilizado  |
| `geometric-current-previous`      | D.1, uma execução            | 3/3; 15/15                                   | reutilizado  |
| `scan-rotated`, também degradado  | D.1, uma execução            | 2/2; 9/9                                     | reutilizado  |
| `scan-partially-masked`           | D.1, uma execução            | 1/1; 5/5; valor mascarado não inventado      | reutilizado  |
| `many-pages-repeated-parameters`  | D, uma execução              | 24/24; 160/160 em oito páginas               | reutilizado  |

Total histórico v3: **seis PDFs distintos, 32/32 resultados legíveis recuperados,
203/203 campos positivos corretos** nesta amostra. Sem repetições independentes por
PDF. As 24 observações do PDF longo pertencem a um único documento.

Nos seis PDFs dedicados pendentes há **12 resultados legíveis de referência**.
Nenhuma precisão, latência, custo por documento ou resultado do verificador foi
atribuído a eles. Qualitativos, ISO e anteriores presentes em outros PDFs não
substituem os casos dedicados e suas combinações.

Diferenciar as três dimensões:

- **Extração:** comparação independente de nomes, valores, unidades, referências,
  datas, páginas e associação atual/anterior; aprovação pelo verificador não define acerto.
- **Completude:** o inventário experimental continua offline e retorna
  `completenessProven:false`. Pode reconhecer zero exames em tabela geométrica e não
  apontar omissões. Ausência de divergências não comprova cobertura do documento.
- **Verificação:** no PDF longo pareado, 24 falsos alertas v2 caíram para zero v3,
  sem ganho de recall (24/24 em ambos). Na D.1, 7/8 resultados legíveis corretos ainda
  exigiram atenção adicional legítima, além do item mascarado. Esse trabalho não
  equivale a falso alerta. Os oito controles adversariais locais de D são separados:
  seis aceitações indevidas provocadas caíram para zero, dois positivos preservados.

[Matriz reproduzível](benchmarks/laboratory-stage-d2-coverage.json), com hashes,
campos, erros, verificações, custos e latências históricos por documento:

```sh
npx tsx scripts/report-laboratory-stage-d2.ts > work/laboratory-stage-d2-coverage.json
```

## 3. Custo, latência e execução restante

Limites preservados: **seis importações/hora e vinte/dia por organização**. A leitura
atual encontrou o bucket diário 20/20; não encontrou bucket da hora atual. Ausência do
bucket horário não autoriza exceder o diário. Não houve tentativa 429, reset, aumento,
chave direta, outra organização ou fornecedor para contornar a cota.

- D.2: **zero requests novos e US$0 de novos tokens**; precisão, latência e taxas de
  erro das seis novas extrações **não medidas**, em vez de zero.
- Histórico v3: **US$0,0031469 estimados** para os seis PDFs, não cobrados novamente.
- D.1 histórica: mediana HTTP **9,485 s** em cinco PDFs; não é latência nova D.2.
- Estimativas não são fatura e excluem infraestrutura/armazenamento. Não inferir custo
  operacional total zero nem melhora causal a partir de amostras pequenas diferentes.

A instrução atual limita a próxima execução a **seis inferências**, uma por caso
pendente, sem as doze réplicas adicionais antes propostas. Antes da primeira chamada:
reconsultar SHA/READY da URL imutável, runtime v3, identidade e branch sintéticas,
saldo horário/diário, limites de documento e orçamento. O horário de renovação sozinho
não comprova saldo livre. Conferir os hashes e eventuais duplicatas antes do upload.

Executar somente upload sintético → `OPEN` → `EXTRACT` com versão e `operationId`
estáveis → leitura do rascunho não confirmado. Interromper diante de 429, divergência
de versão/escopo ou estado ambíguo. Após perda de resposta, consultar status/telemetria;
não reenviar com nova operação. Não executar `SAVE`, `VALIDATE` ou `REOPEN`. Preservar
capturas, tokens, campos, falhas e custo desconhecido sem convertê-lo em zero.

## 4. Estudo humano retirado da fase

O [pacote local](studies/laboratory-d2/README.md) e seu protocolo permanecem como
artefatos históricos preparados. Nenhum participante foi medido ou recrutado por
ferramentas. Não executar nem coletar esse estudo nesta fase; eventual retomada exige
nova decisão específica. Não executar novamente o ensaio técnico como substituto.

Os **22 testes unitários/interface e 11 verificações técnicas de navegador da entrega
anterior** validam a ferramenta de estudo e seus bloqueios. São automação técnica,
não participantes, erros percebidos ou comprovação de produtividade clínica.

A revisão por exceção continua uma estratégia da interface com confirmação explícita.
Sua redução de esforço e segurança de uso humano **não foram demonstradas**. Essa
limitação permanecerá no encerramento técnico mesmo quando as inferências terminarem.

## 5. Erros residuais e limites de confiabilidade

1. Scans continuam sem evidência textual independente. A IA pode acertar o valor e
   reescrever pontuação no trecho de evidência; a própria transcrição não confirma a fonte.
2. Parser textual sem geometria não sustenta todas as associações de tabelas. Esses
   casos permanecem em revisão, sem declaração de completude universal.
3. Datas ambíguas não devem ser preenchidas por idioma ou cronologia. Histórico,
   coleta, resultado e emissão exigem associação inequívoca.
4. O inventário e o verificador compartilham reconhecimento textual e podem omitir a
   mesma região. Zero alertas não significa ausência de omissões.
5. Nomes semelhantes/unidades distintas e os cinco demais casos dedicados ainda não
   têm inferência real v3. Não há medição de variabilidade por repetição.
6. O alias do modelo não registra uma revisão resolvida imutável. Amostra pequena,
   sintética e selecionada não comprova acurácia clínica ou generalização.
7. Sem estudo humano, não há medição de erros residuais após conferência ou economia
   de tempo. O custo baixo de tokens não resolve essa incerteza.

Nenhum OCR adicional foi implementado ou executado nesta continuação. O experimento
OCR anterior da D.1 permanece histórico, fora do runtime. Não houve novo fornecedor,
publicação automática, alteração do pipeline ou do histórico validado.

## 6. Preservação, testes e entrega

Rechecagem em **20/10/2026 às 14:24:33 UTC**: os mesmos **88 resultados**, **duas
versões clínicas**, digest **`713f44bd5c8fa62783847475c61a3525`**. Nesta continuação
houve somente leituras nos serviços, sem novos documentos/imports nem escrita clínica.
Produção permanece em `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`, SHA
`091612549723e484d41bd3c984e877ddd19365e6`. Não houve promoção ou deployment manual.

O commit desta continuação altera documentação, evidência de leitura e agregador offline.
Nesta continuação passaram **109 testes unitários/interface e 26 testes offline de
servidor/corpus**, além de typecheck e lint do agregador. Os testes de servidor usam
SDK controlado e não representam novas inferências nem integração com banco. A matriz
foi reproduzida e seus seis casos pendentes permaneceram sem métricas inventadas.
Comandos, resultados e hashes constam em
[regressão desta continuação](benchmarks/laboratory-stage-d2-continuation-tests.json).
Não se reapresentam suítes antigas como execução nova. Nenhum teste usa API paga.

**Recomendação: manter a D.2 aberta até executar e avaliar os seis casos autorizados.**
O estudo humano foi retirado do escopo atual, não preenchido com simulações. É possível
encerrar depois a homologação técnica com essa limitação explícita, sem afirmar
validação clínica completa. Não existe evidência para remover a revisão profissional.

A [proposta da próxima fase](patient-ai-first-next-phase-proposal.md) está preparada
para revisão, **sem implementação**, migração ou mudança de arquitetura aprovada.
