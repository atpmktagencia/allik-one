# F2 — proposta de classificação documental assistida

**Somente proposta. Não implementada. Aguarda aprovação específica.** F1 autoriza
receber e reabrir originais; não autoriza chamadas de classificação, novos prompts,
extração automática, normalização clínica, novos fornecedores ou publicação clínica.

## Base entregue pela F1

O mesmo original privado recebe UUID, SHA-256, paciente/organização/unidade e evento
`UPLOADED`. Recebimento neutro usa a categoria técnica existente `OTHER`, com metadata
`intent:RECEIPT` e `receiptVersion:1`. A interface apresenta “Sem classificação”. Uma
categoria escolhida explicitamente continua possível. O documento é acessível sem
classificação ou extração; seus estados de recebimento e laboratório são separados.

As categorias atuais e os metadados do arquivo são imutáveis no banco. **F2 não deve
atualizar silenciosamente o array original**, substituir o arquivo ou alterar sua
identidade para classificá-lo. A persistência de sugestões/revisões precisa ser
apresentada antes de qualquer migration. Nenhuma nova tabela foi autorizada por F1.

## Objetivo e experiência

Após um único upload, sugerir tipo/categorias do documento com indicação de origem,
versão e necessidade de revisão. O profissional pode aceitar, corrigir ou deixar
pendente. Recebimento e acesso ao original nunca dependem da disponibilidade da IA.

Na linha existente da central: badge de classificação, estado e ação contextual
“Revisar classificação”, sem formulário obrigatório. O painel mostra original,
páginas que sustentam a sugestão, categorias propostas e confirmação/correção. Não
abrir visualizador vazio nem criar outra biblioteca. Preservar busca, filtros e
anamnese ao navegar. Sugestão não aprovada não deve ser confundida com classificação
confirmada nem com resultado laboratorial validado.

## Escopo funcional sugerido

1. Distinguir resultado laboratorial, pedido de exames, laudo de imagem, prescrição,
   relatório/atestado e outros; reutilizar os IDs existentes. Definir exemplos e
   diferenças antes do benchmark, especialmente pedido versus resultado.
2. Permitir múltiplas categorias com justificativa e páginas de origem. Documento
   misto permanece um original; não duplicar o arquivo nem criar resultados por página.
3. Abstenção explícita: conteúdo não reconhecido, ilegível, ambíguo ou misto sem escopo
   demonstrado permanece pendente. “Outros” não deve ocultar incapacidade do modelo.
4. Nome encontrado no PDF não vincula automaticamente outro paciente. Divergência de
   identidade bloqueia confirmação e exige revisão autorizada.
5. Correções humanas preservam a sugestão original e sua proveniência. Não mudar
   permissões ou expor conteúdo clínico à equipe comercial por mudar uma categoria.
6. F2 não dispara `EXTRACT` nem escreve no histórico validado. Isso pertence a um marco
   posterior, que também exige aprovação.

## Alternativas técnicas a decidir

Comparar classificação por sinais inequívocos do texto nativo com classificação
estruturada pelo provedor OpenAI já autorizado. Não adicionar OCR ou fornecedor.
Classificação visual de scan exige avaliação própria; confiança autodeclarada pelo
modelo não equivale a probabilidade calibrada.

Contrato proposto para avaliação: tipo principal, categorias candidatas permitidas,
estado `sugerido/incerto/misto`, páginas e evidências sustentadas, motivo de abstenção,
versão do esquema/prompt/modelo e referência ao SHA original. Nomes e dados pessoais
não entram em logs de desempenho. Conteúdo do documento é dado não confiável, nunca
instrução para executar ferramentas ou modificar prontuários.

Persistência: avaliar primeiro uma projeção versionada e auditada associada ao arquivo,
sem sobrescrever os metadados imutáveis. Reutilizar infraestrutura de eventos quando
compatível com seus triggers; se precisar de tabela/tipo de evento/migration, trazer
o diff de schema, política de acesso e plano de rollback para aprovação antes de executar.
Uma “classificação em metadata” não pode contornar a imutabilidade existente.

Execução: avaliar acionamento pós-recebimento e durabilidade com os mecanismos atuais.
Se a requisição precisar sobreviver à navegação, comparar alternativas de execução
confiável antes de escolher fila/serviço. Idempotência por documento/hash/versão,
concorrência controlada e retry explícito/limitado; não restaurar 6/h ou 20/dia.
Nenhum reprocessamento pago do acervo inteiro ao abrir a tela.

## Qualidade, custo e segurança

Corpus sintético rotulado independentemente, separado em desenvolvimento e avaliação,
com PDFs digitais, scans, pedidos, resultados, documentos mistos e conteúdo adversarial.
Medir por documento/categoria: precisão, recall, confusão, cobertura/abstenção, páginas
associadas corretamente, falhas, latência, requests/tokens e custo. Repetições não viram
novos documentos. Não usar score médio para esconder confusão pedido/resultado.

Apresentar orçamento finito do experimento e contagem máxima de chamadas antes de
inferências novas. Custos desconhecidos permanecem nulos; estimativa não é fatura.
Não transferir a obrigação de conferir evidências para uma porcentagem de confiança.

Regressões obrigatórias: isolamento de organização/paciente/unidade, proteção do
original, duplicação e resposta perdida, classificação manual preservada, fonte mista,
identidade divergente, recusa do provedor e navegação sem perda de rascunho. As capturas
reais D.2 continuam referência: histórico de Glicose não pode virar resultado atual,
e a referência multilinha de Ferritina não pode ser reduzida a uma população arbitrária.
Esses achados não serão corrigidos silenciosamente por classificação de documentos.

## Incrementos para eventual aprovação

- F2a: contrato, corpus, UX e proposta de persistência; nenhuma chamada de IA.
- F2b: experimento autorizado com o provedor existente e relatório por categoria.
- F2c: implementação de sugestões/correções em Preview sintético, com auditoria e
  fallback neutro. Persistência/migrations somente se especificamente aprovadas.
- F2d: homologação visual/funcional e decisão de ampliar. Sem F3–F5 ou produção.

Critérios quantitativos de aceite precisam ser definidos com o corpus e o risco de
cada confusão antes de rodar o benchmark. Não inventar limiares clínicos ou declarar
redução de tempo: estudo humano não foi realizado nesta fase.
