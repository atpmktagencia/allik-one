# F2 — persistência revisada e validação local

Data: 21/10/2026 (Fortaleza). Base revisada pelo responsável: `b8d861e`.
Escopo autorizado nesta rodada: ajustes de código e SQL, executados exclusivamente
em PostgreSQL 16 descartável. **Preview, produção, inferências pagas e F3–F5 não
foram alterados ou acionados.** A aplicação no Preview ainda exige aprovação.

## SQL e contrato

[SQL revisado completo](proposals/patient-f2/persistence.sql). Continua fora de
`drizzle/` e do journal: não será aplicado por build ou deployment. Acrescenta uma
única tabela de eventos ligada ao original; três funções (duas de validação de
payload e um guard), três índices explícitos e três triggers. Não altera, apaga,
copia ou reclassifica metadados do original, nem faz backfill.

| Evento            | Autoria | Condições principais                                                                                                   |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| RECEIVED          | SYSTEM  | Primeiro evento; único por documento/versão                                                                            |
| STARTED           | SYSTEM  | Somente RECEIVED ou RETRY_REQUESTED; attempt UUID obrigatório                                                          |
| SUGGESTED         | SYSTEM  | Tentativa ativa; categorias/evidências estruturadas; suporte declarado pelo produtor; sem abstenção                    |
| NEEDS_REVIEW      | SYSTEM  | Tentativa ativa; incerteza, identidade divergente ou fonte indisponível                                                |
| FAILED            | SYSTEM  | Tentativa ativa e código fechado de falha                                                                              |
| CONFIRMED         | HUMAN   | Somente após SUGGESTED; mesmo evento e conjunto de categorias; original e identidade conferidos; motivo                |
| MANUAL_CLASSIFIED | HUMAN   | Classificação manual distinta, inclusive durante STARTED ou após FAILED; categorias, motivo e conferência obrigatórios |
| CORRECTED         | HUMAN   | Novo evento após sugestão/revisão/decisão; não altera a decisão anterior                                               |
| RETRY_REQUESTED   | HUMAN   | Somente após FAILED; motivo obrigatório; não é disparo de IA nesta implementação                                       |

Não existe transição STARTED→CONFIRMED ou FAILED→CONFIRMED. NEEDS_REVIEW também
não é confirmável como sugestão verificada: exige classificação/correção manual.
Após decisão humana, resposta tardia não pode voltar o stream para SUGGESTED.

SYSTEM usa `actor_user_id=NULL` e identidade fixa `document-classifier`. HUMAN exige
usuário ativo e identidade de sistema nula. Não atribuímos o classificador ao autor
do upload. Modelo e versão aparecem nos eventos apropriados; payload tem schema 1.

O backend valida os tipos com Zod estrito e o banco repete controles essenciais:
categorias fechadas e sem repetição, páginas inteiras 1–100, trechos não vazios,
limites de tamanho, justificativas e flags de conferência, UUID do resultado
confirmado e versões permitidas. JSON com campos desconhecidos é recusado.

**Limite importante:** evidência estruturada não comprova sua veracidade no PDF.
`SUPPORTED` é uma declaração do produtor interno, não um campo aceito de uma
requisição humana nem uma prova independente. O classificador futuro deverá verificar
a evidência contra o original antes de produzir SUGGESTED; essa integração ainda não
existe. Não há publicação clínica nem confirmação automática. Os testes usam eventos
controlados, não medem qualidade real da IA.

## Backend e autorização efetiva

`documentClassificationResponse` autentica a sessão real e deriva o autor, tenant e
papel no servidor. Valida organização, paciente e unidade original, paciente/unidade/
organização ativos, permissões `patients.private.read` e `patients.clinical.manage`
e acesso tanto à unidade histórica quanto à atual do paciente. Reconsulta membership,
papel e acessos ativos antes da leitura/escrita. API comercial, integração, preview
anônimo e papéis não clínicos não têm esse caminho. SUPER_ADMIN não atravessa tenants.
POST exige Origin correto. Corpo não pode fornecer autoria ou organização.

GET é somente leitura dos eventos e não agenda trabalho. POST aceita apenas comandos
humanos; eventos de sistema são recusados. A função interna de sistema exige escopo
explícito de organização/paciente/unidade e deriva o hash do original no banco.
**Nenhuma das funções está montada em rota, hook de upload ou worker da aplicação.**
São limites de serviço preparados e testados localmente; não há F2 habilitada remotamente.

O backend mantém autorização independentemente do trigger. O banco faz validação de
consistência adicional. Não foi criada uma política RLS nova: conexões do runtime são
confiáveis e acesso HTTP continua dependendo do backend autenticado. Não se autoriza
expor diretamente a conexão do banco ao cliente.

## Concorrência e idempotência

- Lock consultivo transacional por documento, com chave idêntica no backend e no
  trigger. Não exige UPDATE nos originais imutáveis.
- Revisão sequencial e `expectedRevision` obrigatório; estado é verificado no backend
  e no banco. Duas operações novas sobre a mesma revisão não avançam ambas.
- `operation_id` único: repetição idêntica retorna o evento existente, inclusive após
  perda de resposta. Reutilização com outro conteúdo/autor/escopo é recusada.
- `attempt_id` único para STARTED e associado à resposta. Tentativa diferente ou
  resposta obsoleta não altera a revisão atual.
- Classificação manual durante processamento invalida a chegada posterior. Se o
  resultado vencer a corrida primeiro, a decisão humana recebe conflito e pode ser
  reapresentada como correção na nova revisão; não há retry humano silencioso.
- Até duas tentativas por documento nesta versão, com solicitação humana de retry.
  Isso não restabelece cotas de 6/h ou 20/dia.

Ainda não há dispatcher, chamada de provedor, timeout de execução ou limitador global
implementado. Esta entrega não declara que esses controles operacionais da futura F2
já estão prontos. Resposta tardia rejeitada não gera um evento de resultado: preserva-se
a decisão corrente e retorna-se conflito; registrar telemetria operacional de descarte
sem conteúdo clínico é uma tarefa para a integração do worker.

## Rollback preservando dados

Não existe down migration destrutiva. Após o primeiro evento persistido, a reversão
operacional deve suspender novos trabalhos, preservar a tabela inteira, índices,
constraints, triggers e todos os eventos, inclusive evidências e autoria. Retornar ao
código F1 pode deixar de exibir sugestões, mas não as exclui. Tentativas em voo devem
ser reconciliadas antes de reativar, sem repetir chamadas automaticamente.

Não executar DELETE, TRUNCATE, DROP, desabilitar triggers ou restaurar o banco inteiro
para um ponto anterior como parte desse rollback. Comparar contagens/digests e
integridade dos originais. Exportação isolada não autoriza destruição. Remoção
estrutural só poderia ser proposta antes do primeiro uso, com tabela comprovadamente
vazia e produtores parados, por manutenção explicitamente autorizada. O candidato
não contém rotina de remoção.

## Reprodução local

```sh
npm run test:integration:local
npm test
npm run typecheck
npx eslint src/lib/document-classification-events.ts src/server/document-classification-store.ts src/server/document-classification-store.test.ts
```

O runner cria PostgreSQL 16 exclusivo, injeta URL local com sufixo `_test` e remove
o container ao final. O novo teste exige também host localhost/127.0.0.1 e aplica
literalmente o arquivo SQL proposto depois das migrations atuais, sem adicionar esse
arquivo ao journal remoto. Somente fixtures sintéticas são criadas. Sem uso de Neon,
Vercel, storage remoto ou provedores de IA.

## Resultados efetivamente executados

| Verificação                                        | Resultado                 |
| -------------------------------------------------- | ------------------------- |
| SQL revisado aplicado em PostgreSQL 16 descartável | passou                    |
| Integração completa, 40 arquivos                   | **501 passaram**, 81,85 s |
| Novos testes F2 incluídos nessa contagem           | **37 passaram**           |
| Provisionamento e segurança do papel restrito      | **3 passaram**            |
| Unitários/interface, 82 arquivos                   | **597 passaram**, 90,87 s |
| Typecheck                                          | passou                    |
| ESLint dos três arquivos TS desta revisão          | passou                    |
| Diff sem erros de whitespace                       | passou                    |

Os 37 testes incluem confirmação recusada em STARTED/FAILED/NEEDS_REVIEW, confirmação
do resultado exato, autoria automática/humana, injeção de evento automático pela API
humana, tenant/paciente/unidade/papel, usuário inativo, transferência de unidade,
Origin, payloads inválidos no backend e diretamente no SQL, claims simultâneos,
mesma operação concorrente, tentativa divergente, resposta tardia e decisão manual,
correção com histórico, retries limitados, UPDATE/DELETE/TRUNCATE recusados e
integridade do original. O teste de role verifica efetivamente ausência de UPDATE
nos originais/eventos e executa STARTED e MANUAL_CLASSIFIED com SELECT/INSERT.

A primeira execução da suíte nova falhou nas fixtures, por código interno curto e
nome de organização repetido. Ambos foram corrigidos; nenhuma alteração de schema
existente foi feita para acomodar fixtures. A segunda execução passou com 497 testes;
após reforços e lock compatível com o papel restrito, a execução final passou com 501.
Não se ocultam falhas anteriores nem se contam execuções repetidas como casos novos.

O teste de imutabilidade compara a linha original antes/depois e confirma a sequência
RECEIVED→MANUAL_CLASSIFIED→CORRECTED sem substituir eventos. Os testes não fizeram
escritas em tabelas de resultados laboratoriais ou de revisões clínicas. Não houve
acesso de manutenção a banco remoto, mudanças de ambiente ou deployment. A limpeza
pelo runner exclui somente o container e os dados sintéticos descartáveis do teste.

## Pendências para aprovação e próxima implementação

1. Revisão final deste SQL e autorização explícita para sua aplicação no Preview.
2. Após autorização: integrar schema/journal pelo processo do repositório, validar
   novamente grants/isolamento e só então aplicar à branch correta de Preview.
3. A integração ao upload, dispatcher, classificador OpenAI, evidências contra o PDF,
   UI e benchmark real permanecem pendentes. Nenhuma chamada paga foi autorizada ou
   executada nesta rodada; precisão, custo e latência da IA são **não medidos**.
4. Sem promoção para produção, extração automática ou F3–F5.
