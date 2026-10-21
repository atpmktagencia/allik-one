# F2 — persistência append-only revisada

**Candidato para aprovação; não aplicado no Preview ou em produção.**
A proposta conceitual `b8d861e` foi revisada conforme os seis pontos solicitados.
Somente ajustes de código e testes locais foram executados, sem chamadas pagas.

- [SQL completo revisado](proposals/patient-f2/persistence.sql).
- [Relatório técnico, testes, limites e reprodução](patient-ai-first-f2-local-validation.md).
- [Evidências resumidas e hashes dos arquivos testados](benchmarks/patient-f2-local-validation.json).

## Preservação e isolamento

Uma única tabela append-only, vinculada ao mesmo documento por UUID, SHA-256,
organização, paciente e unidade. Metadados originais e UPLOADED não são modificados.
Não há novo blob, biblioteca, import laboratorial ou reprocessamento histórico.

O backend autentica e valida permissões e escopo de leitura/escrita, com rechecagem
de membership e das unidades original/atual. O trigger é uma segunda defesa de
consistência; não substitui autorização de backend. Não foi adicionada RLS.

## Máquina de estados e autoria

- **CONFIRMED** só sucede SUGGESTED verificável, referenciando o mesmo evento e
  categorias, com autoria profissional, motivo e conferência do original/identidade.
- **MANUAL_CLASSIFIED** é operação humana distinta, permitida durante STARTED ou
  após FAILED. Não simula confirmação de IA sem resultado.
- **CORRECTED** acrescenta evento; não sobrescreve decisões anteriores.
- Eventos automáticos usam SYSTEM, identidade `document-classifier` e usuário nulo.
  Decisões humanas usam o usuário autenticado, sem identidade de sistema.
- Payloads estritos e versionados são validados no backend e no SQL. A API humana
  recusa eventos automáticos e campos de autoria/tenant enviados pelo cliente.

Evidência com página/trecho não é prova de verdade clínica. A futura integração do
classificador deve verificar os trechos contra o original antes de declarar suporte;
essa integração não foi habilitada nesta revisão.

## Concorrência e idempotência

Lock consultivo transacional por documento, revisões sequenciais e expectedRevision.
Não exige UPDATE na tabela imutável dos originais. operation_id reconcilia repetição
idêntica e rejeita reutilização alterada. attempt_id vincula resposta à tentativa.
Decisão humana impede que resposta tardia substitua a classificação. Limite de duas
tentativas por documento com retry explícito; sem restaurar cotas horárias/diárias.

## Rollback após o primeiro uso

**Preservar integralmente tabela e eventos, inclusive sugestões, correções,
confirmações, evidências, autoria e datas.** Não há down migration destrutiva.
Suspender trabalhos e voltar ao código F1 não exclui classificações; pode apenas
retirar sua exibição. Reconciliar tentativas em voo antes de reativar.

Não executar DROP, DELETE, TRUNCATE, desativação de triggers ou restauração integral
anterior para reverter F2. Exportação não autoriza exclusão. Uma remoção estrutural
só poderia ser avaliada antes do primeiro uso, com tabela comprovadamente vazia,
produtores parados e manutenção explicitamente autorizada. Não está implementada.

## Validação e limite desta entrega

SQL aplicado somente em PostgreSQL 16 descartável: **501 testes de integração**, dos
quais **37 novos da F2**, e **3 verificações de provisionamento** passaram. Também
passaram **597 testes unitários/interface**, typecheck e lint dos arquivos alterados.
O relatório distingue as execuções e documenta as falhas iniciais de fixture corrigidas.

O SQL permanece fora de `drizzle/` e do journal. Serviços são testáveis localmente,
mas não estão montados em rotas, upload ou worker. Não há migration remota, F2
operacional no Preview, inferência paga, extração automática ou publicação clínica.

A aplicação no Preview aguarda revisão final e autorização do responsável. Produção
e F3–F5 permanecem fora do escopo.
