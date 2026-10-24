# F3 — revisão da persistência de encaminhamento

**Atualização de 24/10/2026:** proposta aprovada para implementação/testes locais. A versão final 0078 foi validada exclusivamente em PostgreSQL descartável; Preview e produção não foram migrados. Veja [SQL final, resultados e rollback](../patient-ai-first-f3-persistence-local.md). Nenhuma migration de metas ideais está incluída.

O restante deste documento preserva o escopo da proposta original e suas limitações anteriores à validação local.

## O que já foi autorizado e entregue nesta rodada

A F2.5 está encerrada por decisão de produto de 23/10/2026. A apresentação canônica da PCR com sufixo `1` usa alias explícito; nome e evidência originais permanecem intactos. Hemácias ambíguas continuam neutras. A persistência de Ideal foi adiada.

A F3 foi iniciada pelo contrato de elegibilidade e transições, com testes determinísticos. O contrato ainda **não está conectado a upload, classificação ou extração**. Não há automação F3 ativa nem nova chamada paga nesta rodada.

## Diagnóstico verificado

- F1 confirma o original e o evento de recebimento em transação; o disparo F2 ocorre após commit.
- F2 já grava autoria SYSTEM/HUMAN, revisão e evidência. Só uma classificação sustentada pode encaminhar o primeiro incremento.
- O endpoint de extração atual autentica cookies, baixa o original por outro endpoint autenticado e reautentica no final. Um worker não deve fabricar uma sessão HTTP.
- Imports e eventos laboratoriais atuais exigem usuário humano e fazem join de nome do usuário na leitura. Acrescentar duas tabelas não corrige essa semântica sozinho: o serviço e a apresentação de autoria ainda precisam ser adaptados.
- `document_id UNIQUE`, versão, tentativa e seals dos imports já protegem a entidade de extração. Não criar outra entidade de resultado ou outro arquivo.
- F2 pode ocupar 180 s; v3 até 150 s. `waitUntil` não renova o orçamento da invocação. A concorrência v3=2 é por documento/batches, não um limite global de documentos.

## Alternativa avaliada sem migration

É tecnicamente possível inscrever novos uploads nos metadados do evento `UPLOADED` e guardar classificação/páginas nos eventos de importação existentes, sob os mesmos locks. Isso exige definir claramente execução delegada, adaptar a UI de autoria e refatorar o serviço para não depender de cookies.

Não afirmamos que novas tabelas são a única solução possível. A opção proposta é uma escolha de governança e confiabilidade: manter o encaminhamento e a execução automática append-only com autoria SYSTEM explícita, sem sobrecarregar eventos cujo contrato atual exige autor humano. Essa escolha fica submetida à revisão antes de qualquer aplicação.

## Diff SQL proposto

[SQL completo](patient-f3-handoff.sql), aditivo:

1. `inventory_laboratory_automation_requests`: identidade da inscrição por documento/versão, organização/paciente/unidade/hash, evento de recebimento e iniciador. Não contém resultados laboratoriais nem duplica bytes do original.
2. `inventory_laboratory_automation_events`: revisões e operações únicas, tentativa, classificação de origem, autoria SYSTEM/HUMAN e estados STARTED/READY/FAILED/CANCELLED/RETRY_REQUESTED. READY significa **rascunho**, nunca validação clínica.
3. Guards de escopo, permissão atual, autoria do uploader, matrícula no mesmo recebimento/transação, tipos do payload, revisão e tentativa, imutabilidade e bloqueio de UPDATE/DELETE/TRUNCATE.
4. SELECT/INSERT para `allik_runtime`; nenhum privilégio adicional de alteração/exclusão.

Inscrição na mesma transação de um novo original e do RECEIVED bloqueia varredura/backfill do acervo. A versão de pipeline é fixa nesta proposta. Não há gatilho que invoque IA ou processe documentos ao aplicar o SQL.

O banco fornece uma segunda barreira; autorização efetiva de leitura/escrita continua obrigatória no backend por organização, paciente, ambas as unidades e papel. Idempotência do serviço deve verificar a operação existente e comparar seu conteúdo/escopo antes de retornar replay; índice único sozinho não implementa replay seguro.

## Elegibilidade do primeiro incremento

`src/lib/laboratory-automation.ts`:

- Novo upload PDF explicitamente inscrito enquanto F3 estiver habilitada apenas no Preview sintético.
- Acesso clínico/privado vigente do iniciador nas unidades do documento e do paciente.
- Unidade do documento igual à unidade principal atual, conforme a restrição legada da criação de imports.
- Hash/tamanho do original conferidos novamente pelo serviço privado.
- Classificação corrente SUGGESTED/SUPPORTED, sem abstenção, categoria única LAB_RESULT e páginas completas conferidas com contagem independente do PDF.
- Nenhuma importação manual/confirmada prévia; a tentativa posterior deve pertencer ao mesmo pedido automático e seguir retry explícito.

Pedidos, documentos mistos, scans sem evidência independente, identidade divergente, páginas incompletas e classificação alterada vão para pendência/manual. Uma confirmação humana concorrente da classificação também impede o primeiro encaminhamento automático: será exibida pendência explícita, sem descartar o documento. A ampliação a mistos/confirmados exige contrato de escopo de páginas revisado; não se processa o PDF inteiro cegamente.

## Integração ainda necessária após aprovação

1. Refatorar extração/verificação v3 para um serviço interno reutilizável, sem cookies fabricados; ler storage privado e usar `verifiedOriginal`.
2. Inscrever F3 na transação de recebimento F1, somente para novo original, sem retomar históricos/replay de upload.
3. Ao terminar classificação elegível, reivindicar pedido com locks e revisão. Worker revalida autorização/estado antes da inferência e do commit.
4. Ordem única de locks: classificação → pedido F3 → import. Criação/atualização do import e evento correspondente na mesma transação. READY_REVIEW + evento F3 READY devem commitar juntos.
5. Nos registros legados, separar iniciador delegado de executor SYSTEM na metadata e na UI. Nenhuma decisão clínica será atribuída ao uploader por uma ação automática.
6. Correção humana, mudança de unidade/acesso ou edição do rascunho invalida a resposta tardia. No VALIDATE, revalidar a vinculação da classificação do rascunho automático. Não alterar versões clínicas já confirmadas.
7. Aplicar deadline absoluto desde a entrada da requisição. Primeiro rollout: no máximo uma extração por execução e reserva proposta de 170 s antes de iniciá-la. Essa margem é projeto técnico, **não medição de desempenho**. Sem janela, conservar pendência recuperável; sem retry pago por reload/GET.
8. Coordenar vagas de extração e de chamadas ao provedor: dois batches por documento não equivalem a duas chamadas globais. Telemetria deve medir o pico combinado F2/F3 e o custo por etapa. Não restaurar cotas de 6/h ou 20/dia.
9. Recuperação explícita para tentativas órfãs; nunca repetir automaticamente uma chamada de resultado desconhecido. Falhas preservam o original. No máximo duas tentativas iniciadas por documento nesta proposta, segunda mediante ação humana auditada.

## Testes e limites da evidência

Nesta rodada: testes unitários do contrato, regressão de apresentação clínica, typecheck e lint. Revisão estática independente por três agentes; correções incorporadas para NULL em CHECK, tipos JSON, autoria do iniciador, timestamps e lock do import. Concordância entre agentes não comprova funcionamento do SQL nem qualidade da IA.

**Ainda não executado:** SQL em PostgreSQL descartável, testes de integração da persistência, worker, upload → classificação → extração real e benchmark pago. Não há métricas reais de F3 para custo, latência, completude ou trabalho humano.

Após aprovação da proposta, antes do Preview: executar SQL em PostgreSQL descartável e testar isolamento, autoria, imutabilidade, operação repetida, claim simultâneo, correção/revogação durante inferência simulada, import manual concorrente, resposta tardia, rollback da transação, recuperação e proteção de resultados/versões confirmados. Apresentar os resultados e o journal final antes de solicitar aplicação no Preview. Esta aprovação de proposta não deve implicar autorização de produção.

## Rollback operacional, inclusive após primeiro uso

Desabilitar somente o dispatch F3, aguardar/cancelar tentativas em voo por evento e apontar Preview ao runtime anterior se necessário. Preservar as duas tabelas, todas as inscrições/eventos, imports, originais e versões clínicas. GET permanece somente leitura. Nenhuma retomada paga automática ao reativar.

Não existe down migration destrutivo. Não executar DROP, DELETE ou TRUNCATE, nem restaurar backup sobre dados novos para desfazer esta feature. Em falha durante a aplicação, a transação do SQL ainda não commitada é revertida por PostgreSQL; após commit/primeiro uso, o rollback é operacional e preserva os dados.

## Aprovação solicitada

Revisão do SQL e autorização para incorporar/testar a persistência proposta **em PostgreSQL descartável**, juntamente com a implementação do serviço F3. A aplicação no Neon de Preview será uma aprovação posterior apoiada nos testes. Produção, F4, F5 e publicação clínica automática permanecem excluídas.
