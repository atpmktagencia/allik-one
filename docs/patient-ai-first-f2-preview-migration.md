# F2 — migration 0077 aplicada somente no Preview

**Concluída em 21/10/2026. Persistência disponível; classificador permanece desabilitado.**
Autorização: persistência revisada `ea21ecc27ef94103779c73d5915de5417c634969`.
Commit de registro da migration: `549b5e8`.

## Alvo confirmado antes da escrita

| Item                                                 | Identidade                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| Repositório / branch de trabalho                     | atpmktagencia/allik-one / feature/allik-patients                            |
| Projeto Neon                                         | little-dust-61663559                                                        |
| Branch Neon                                          | br-winter-hill-b69uz195 — preview/feature/allik-patients                    |
| Compute                                              | ep-hidden-cloud-b6hskjjt                                                    |
| Banco                                                | neondb                                                                      |
| PostgreSQL remoto                                    | 18.6 (fd34222)                                                              |
| Dados / ambiente                                     | synthetic / preview                                                         |
| Papel de aplicação conferido por conexão autenticada | allik_runtime                                                               |
| Preview imutável mantido                             | https://allik-h1z8fw0b6-atp-mkt.vercel.app                                  |
| Deployment / SHA do Preview                          | dpl_8eMtsBpW533oxeD2kDZGUHo89rmn / a99712079deff8a1fc0df6d7260f2183b8f27218 |

O runtime continua no candidato F1 deliberadamente: esta autorização não inclui
habilitar classificador ou publicar nova aplicação. O código aprovado da persistência
não precisava substituir o deployment para executar manutenção aditiva do schema.
GET de sessão retornou 200 e o operador sintético esperado; seu UUID foi encontrado
na conexão conferida de Preview. Configurações de ambiente/branch indicaram Preview
sintético. Nenhuma credencial foi exibida ou exportada.

O conector Neon foi fixado explicitamente em projeto, branch, compute e banco em
**todas** as operações. A própria conexão retornou os IDs esperados em
`neon.branch_id`/`neon.endpoint_id`. Não foi aberta conexão SQL com produção.
A produção foi inspecionada somente por metadata de deployment e permaneceu em
`dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`, SHA
`091612549723e484d41bd3c984e877ddd19365e6`, antes/depois.

## Compatibilidade e mecanismo oficial

Os 77 registros já aplicados tiveram timestamps e hashes comparados com o repositório:
prefixo completo coincidente, sem omissões ou reescrita. As funções/tabela F2 não
existiam. Sete tabelas referenciadas tiveram colunas, nulabilidade, defaults,
constraints e triggers comparados com o PostgreSQL descartável; a função existente
de imutabilidade também coincidiu.

A comparação inicial de catálogo identificou representação diferente entre versões:
PostgreSQL 18 inclui NOT NULL em `pg_constraint`, PostgreSQL 16 registra a mesma
nulabilidade em `pg_attribute.attnotnull`. A comparação foi interrompida para análise
e normalizada somente nessa representação, mantendo a checagem de `attnotnull` em
ambos. **Nenhuma divergência estrutural semântica foi encontrada ou corrigida
silenciosamente.** A inspeção não dispensou uma constraint de nulabilidade diferente.

- [Migration oficial 0077](../drizzle/0077_patient_document_classification_events.sql).
- Journal: nova entrada idx 77, depois de 0076; ordenação estritamente crescente.
- SHA-256: `451ee65e6014f5a6c085b3a14ea784770196a694f8c856ffcbd24101dddb5c0d`.
- SQL **byte a byte igual** ao aprovado em `ea21ecc`. O comentário histórico do
  arquivo dizendo que não estava autorizado permanece nessa cópia para conservar o
  hash; a autorização de aplicação é a decisão posterior registrada nesta rodada.
- Declaração ORM e snapshot 0077 adicionados. Seus nomes de constraints/FKs refletem
  os nomes efetivamente gerados pelo SQL aprovado, sem renomear objetos no banco.
  Nova execução do gerador respondeu **No schema changes**.
- Nenhuma migration anterior ou entrada antiga do journal foi editada.

A aplicação remota usou o conector Neon em **uma transação atômica** contendo o mesmo
SQL oficial, registro de hash/ordem no journal Drizzle e GRANT SELECT/INSERT. Não foi
executado `npm run db:migrate` no runtime do Preview, nem exportada sua URL de conexão.
O executor de manutenção foi o conector autorizado; o arquivo, o journal e a identidade
da migration são os mesmos consumidos pelo migrador oficial.

A transação adquiriu o lock de migrations do projeto, definiu lock_timeout de 5 s e
statement_timeout de 60 s, revalidou branch/compute/banco e o prefixo completo do
journal, recusou objetos F2 preexistentes e validou privilégios antes do commit.
O registro final passou de **77 para 78 migrations**; todos os hashes correspondem
aos arquivos oficiais e não há migration pendente.

## Privilégios e testes

Conexão autenticada como `allik_runtime` comprovou:

| Privilégio na tabela F2 | Estado    |
| ----------------------- | --------- |
| SELECT                  | permitido |
| INSERT                  | permitido |
| UPDATE                  | negado    |
| DELETE                  | negado    |
| TRUNCATE                | negado    |

Os três triggers estão ativos: guard, imutabilidade de UPDATE/DELETE e proteção de
TRUNCATE. Nenhum privilégio elevado ou de manutenção foi concedido. Uma consulta
inicial de pós-verificação tentou ler o journal com o papel restrito e foi negada
pelo schema `drizzle`; ela não escreveu nada. O journal foi então conferido com a
identidade de manutenção. **Não ampliamos grants para contornar essa restrição.**

| Verificação executada nesta rodada                                    | Resultado                              |
| --------------------------------------------------------------------- | -------------------------------------- |
| Integração completa pelo mecanismo oficial, PostgreSQL 16 descartável | **502 passaram**, 40 arquivos, 80,38 s |
| Testes F2 incluídos nessa contagem                                    | **38 passaram**                        |
| Provisionamento / papel restrito local                                | **3 passaram**                         |
| Guardas de build/Preview/journal                                      | **8 passaram**                         |
| Typecheck, lint dos arquivos TS alterados e formatação                | passaram                               |
| Gerador de schema após snapshot                                       | nenhuma mudança adicional              |
| Testes SQL controlados no Preview como allik_runtime                  | passaram; **zero eventos persistidos** |

A suíte local executou autorização no backend com sessões reais sintéticas, isolamento
por organização/paciente/unidade/papel, transferência de unidade, idempotência,
concorrência real entre transações, resposta tardia e correção humana, integridade e
imutabilidade. A recuperação inclui reexecutar o migrador oficial depois de um evento
persistido: operação sem mudanças, evento preservado e último hash conferido.

No Preview, [o teste SQL reproduzível](../scripts/patient-f2-preview-smoke.sql) validou
RECEIVED/STARTED como sistema, decisão manual durante processamento, confirmação sem
sugestão recusada, resposta tardia recusada, outro tenant recusado, payload inválido
recusado e operation_id duplicado recusado. Os INSERTs foram confinados a uma
subtransação intencionalmente revertida; não foi criado novo original nem alterado
um existente. Ao final a tabela voltou a **zero eventos**, sem DELETE/TRUNCATE.

Não se declara teste HTTP do novo backend no Preview: suas rotas ainda não estão
montadas. Concorrência e autorização completas foram testadas localmente; no Preview
foram conferidos o schema aplicado, triggers, papel e os testes SQL acima.
Os 597 testes unitários/interface da revisão anterior são evidência histórica, não
uma execução nova desta manutenção. Não houve mudança de UI nesta rodada.

## Preservação comprovada

| Objeto                     | Antes / depois | Digest antes = depois            |
| -------------------------- | -------------- | -------------------------------- |
| Documentos originais       | 30 / 30        | eab17a1685885aa625b638958041b3a5 |
| Eventos de upload          | 30 / 30        | 6fe5c6c3dcf368bf1edbea222932b714 |
| Resultados clínicos        | 88 / 88        | 713f44bd5c8fa62783847475c61a3525 |
| Versões de revisão clínica | 2 / 2          | 3787eba7f8d71a12604c9a5c2a283708 |
| Eventos EXTRACTION_READY   | 25 / 25        | contador preservado              |

Os digests abrangem as linhas completas, incluindo IDs, hash/caminho e metadata dos
originais. Não houve operação em Blob/storage; os arquivos binários não foram
baixados novamente nesta manutenção. Portanto a prova desta rodada é preservação da
metadata íntegra e ausência de operações de armazenamento, não um novo rehash de todos
os binários. Histórico validado e versões permanecem intactos.

## Estado operacional e rollback

F2 possui somente persistência. Não há nova rota, worker, agendamento, hook de upload,
classificação automática, extração laboratorial automática ou publicação clínica
automática habilitados. Não houve nova configuração de fornecedor ou chamada paga.
O deployment F1 e a configuração de produção não foram alterados.

**Rollback operacional não destrutivo:** manter F2 sem produtores/rotas; conservar
tabela, journal, funções, constraints, índices e todos os eventos. Se houver eventos
no futuro, jamais apagar ou sobrescrever para voltar ao código F1. Conferir contagens,
digests e tentativas em voo antes de qualquer reativação; respostas tardias não podem
substituir uma decisão humana. Não apagar a entrada 0077 para forçar reexecução.

Não há down migration ou comando de DROP/DELETE/TRUNCATE de rollback. Uma eventual
remoção estrutural seria outra manutenção, com autorização específica e análise de
retenção, nunca efeito automático de um rollback. A tabela vazia atual pode permanecer
sem impacto no F1 e essa é a opção adotada.

[Evidências estruturadas](benchmarks/patient-f2-preview-migration.json) incluem alvo,
contagens/digests antes/depois, privilégios, triggers, journal e deployments preservados.
O próximo passo exige **nova aprovação para implementar e homologar o classificador
F2 e seu fluxo**. Esta execução não autoriza F3–F5 ou produção.
