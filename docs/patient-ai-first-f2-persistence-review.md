# F2 — primeiro incremento e revisão da persistência

Estado: proposta para revisão remota, somente documentação e SQL não executado.
O contrato offline e seus testes existem no commit local `65e7826`; não fazem parte
deste commit documental. Runtime, banco, chamadas pagas e deployment não alterados.
Este documento não declara F2 entregue nem benchmark realizado.

## Diagnóstico e decisão proposta

Foram lidos integralmente F1, proposta F2 e encerramento D.2. A F1 conserva o original
em `inventory_patient_documents`, com categorias imutáveis. `0070` permite apenas
`UPLOADED` na tabela de eventos; exige o autor original e tem índice único
`(document_id,action)`. `0074` adiciona metadata mas não remove essas restrições.
Eventos laboratoriais são vinculados a imports e versões clínicas; usá-los para
classificar qualquer arquivo criaria importações falsas. Auditoria de acesso não é
um diário de processamento. Nenhum desses mecanismos deve ser sobrecarregado.

**Proposta mínima: uma tabela append-only de eventos de classificação**, ligada ao
mesmo UUID e SHA. Não há nova biblioteca, blob, import laboratorial ou tabela de fila.
A última revisão do stream é o estado; o histórico guarda sugestões e correções.
Reutiliza os padrões de imutabilidade, autorização e revisão do sistema atual.

[Diff SQL proposto](proposals/patient-f2/persistence.sql), fora de `drizzle/` e do
journal: uma tabela, três índices explícitos, uma função guard e três triggers.
Não altera tabelas existentes, não insere registros e não faz backfill.

O guard valida origem/tenant/paciente/unidade/hash, autor clínico ativo e unidades,
serializa revisões pelo original, recusa transições inválidas, duplica inicialização
no máximo uma vez por versão e limita duas tentativas explícitas por documento.
Isso é proteção por tentativa, não cota por hora/dia. O backend ainda precisa validar
payloads Zod, escopo de leitura, permissões efetivas e os motivos das correções.
A correspondência literal de uma frase não prova que a categoria está correta.

## Contrato já preparado

`src/lib/patient-document-classification.ts` define categorias existentes, evidências
por página, abstenção e versão. A saída do modelo não aceita confirmação, confiança
ou instruções operacionais adicionais. O verificador offline checa presença literal
na página indicada e exige revisão sem fonte independente ou identidade resolvida.
Não confirma categoria, não prova completude e não extrai valores laboratoriais.
O contrato não é ainda um classificador semântico nem está conectado à interface.

A classificação sugerida pode organizar a lista com identificação “Sugerida”. Somente
ação humana autenticada gera “Confirmada”. Ambiguidade, conflito pedido/resultado,
identidade divergente e scans sem evidência independente geram “Revisar categoria”.
PDFs mistos mantêm categorias com suas páginas, nunca originais duplicados.

## Acionamento proposto e controles a implementar

No commit do upload novo, registrar RECEIVED na mesma transação, somente com F2
habilitada no Preview sintético. O dispatcher pós-resposta usa o mecanismo suportado
pelo runtime; deve ser comprovado antes de habilitar. Não usar fetch desacoplado sem
ciclo de vida garantido. RECEIVED pendente continua visível se o dispatcher falhar;
recuperação operacional explícita não depende de abrir a lista nem dispara pelo GET.

Antes da chamada, claim STARTED persistido com attempt UUID e lock. Um slot global
transacional limita dois documentos concorrentes. Timeout ou resultado de provedor
ambíguo não é repetido automaticamente. Retry solicitado por profissional, até uma
repetição, conserva documento/hash e registra nova tentativa. Chegada tardia não
sobrescreve correção humana. Leases expiradas exigem resolver a tentativa anterior;
expiração não comprova que a chamada deixou de ser cobrada.

Reutilizar OpenAI autorizado, sem nova credencial/exportação; requests sem filename
como evidência, sem ferramentas, PDF como dado não confiável, timeout e saída
limitados, sem retries do SDK. Verificar tamanho/páginas antes de enviar; até 4 MB,
até 20 páginas por classificação inicial, saída máxima 4.000 tokens e deadline 60 s.
Acima disso, preservar original e pedir revisão, sem truncar silenciosamente.
Limites de entrada/saída e concorrência não garantem teto monetário no fornecedor.

Leituras usam escopo original; filtro de categoria considera projeção sugerida/corrigida
sem reescrever categorias históricas. Mudanças de categoria não concedem acesso,
não associam outro paciente e não habilitam extração automática.

## Aplicação e rollback propostos

Antes de aplicar: apresentar este diff; confirmar SHA/URL imutável, Preview sintético,
branch Neon e papel restrito; snapshot de resultados/digest e produção. Testar o SQL
em PostgreSQL descartável, incluindo cross-tenant, cross-unit, autores, corrida de
revision/claim, rollback do upload, correção durante execução e falha de auditoria.
Adicionar schema/journal apenas depois da aprovação; nenhum build executa manutenção.

Aplicação restrita à branch de Preview, com F2 desabilitada até schema, grants e runtime
compatíveis. Não executar este arquivo diretamente em produção.

Rollback operacional, inclusive após haver classificações persistidas:

1. Suspender novos claims e chamadas do classificador. Registrar operador, motivo,
   horário e tentativas em voo; não interpretar suspensão como cancelamento de
   uma chamada já enviada ao provedor.
2. Retornar ao código F1 compatível, mantendo os originais acessíveis. A F1 pode
   deixar de mostrar as categorias sugeridas da F2, mas isso **não apaga** as
   classificações, confirmações, correções, evidências ou autoria.
3. **Manter a tabela e todos os eventos**, suas constraints e triggers de
   imutabilidade. Não executar DROP, DELETE, TRUNCATE, backfill destrutivo,
   restauração integral anterior ou desativação de triggers como parte do rollback.
4. Conservar as revisões anteriores. Correção é evento novo com revisão incremental;
   não altera o evento original. Antes de reativar F2, reconciliar tentativas em voo
   e resultados tardios sem repetir automaticamente chamadas ou sobrescrever a
   última correção profissional.
5. Verificar contagens e digest dos eventos antes/depois, integridade dos originais,
   histórico clínico validado e escopo de acesso. Preservar evidências da operação.

Rollback estrutural só será admissível **antes do primeiro uso**, com F2 desligada,
nenhum produtor/worker em execução e tabela comprovadamente vazia, mediante comando
administrativo explícito. Não haverá down migration destrutiva automática.
Se houver sequer um evento, rollback padrão é exclusivamente operacional e preserva
os dados. Uma futura descontinuação de armazenamento exigirá plano separado, autorização
específica, cópia íntegra verificável, retenção e teste de recuperação. Uma exportação,
isoladamente, não autoriza excluir a tabela ou os eventos.

A aprovação conceitual do usuário não autoriza executar este SQL: a migration e a
implementação operacional aguardam a revisão deste diff e autorização posterior.

## Escopo proposto do benchmark pago (ainda não executado)

Doze PDFs sintéticos distintos, referências independentes fixadas antes das respostas:
2 resultados laboratoriais, 2 pedidos, receita, laudo de imagem, relatório, atestado,
PDF misto multipágina, scan, ilegível e adversarial com identidade divergente.
Uma chamada por PDF, sequencial, **máximo 12 chamadas**, zero retries automáticos.
Sem repetir acervo histórico. Incluir controles determinísticos adicionais sem cobrança.

Antes de iniciar: conferir versão do deployment, isolamento, modelo autorizado e preço
vigente. Propor envelope total de US$ 0,50 para o experimento; não iniciar se o custo
máximo conservador do lote não couber nesse envelope. Parar diante de erro/uso não
mensurável/custo inesperado. Não prometer teto na fatura de chamadas em andamento.
Preço indisponível impede benchmark até revisão; custo observado e estimado separados.

Métricas por documento/categoria/página: precisão e recall multilabel, confusão
pedido/resultado, abstenções, associações de página, falhas, duplicações, tokens,
custo e latência. Não contabilizar páginas como documentos independentes. Critério
para esta rodada: zero pedido classificado como resultado sem sinalização, zero
identidade divergente tratada como confirmada, zero chamadas por GET/reload, original
e histórico preservados. Corpus pequeno não comprova acurácia clínica ou economia humana.

## Próximos incrementos após revisão

1. Persistência testada e autorizada; contrato de claim e dispatcher demonstrado.
2. OpenAI e corpus, sem extração laboratorial.
3. Recebimento único, listagem/estados e correção auditada.
4. Benchmark limitado e homologação visual no Preview; relatório, capturas e commit.
5. Proposta detalhada de F3, sem implementação.

A implementação operacional ainda está pendente. Não existem métricas reais de F2,
classificações no Preview ou screenshots novas nesta entrega preparatória.

## Validação anterior do contrato local (não reexecutada nesta publicação)

- `npx vitest run src/test/patient-document-classification.test.ts`: 11 testes passaram.
- `npm run typecheck`: passou.
- ESLint dos dois arquivos TypeScript novos: passou.
- SQL proposto ainda não foi aplicado nem validado em PostgreSQL. Não é migration liberada.
- Zero inferências reais nesta rodada; custo, latência e precisão do classificador não medidos.
- Sem alterações de banco, histórico clínico, configuração remota ou deployment.
