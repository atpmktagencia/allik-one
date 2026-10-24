# F3 — contrato inicial e revisão antes da persistência

Entrega de 23/10/2026. Runtime `b448ed69d5ddb153a3e525280c43ec8e76f57145`.

## Estado real

| Entrega                                                  | Estado                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| Encerramento F2.5, alias PCR específico e aviso Ideal    | Implementado e publicado no Preview                               |
| Contrato de inscrição, elegibilidade e transições F3     | Implementado e testado, ainda desconectado do runtime             |
| SQL do encaminhamento append-only e rollback operacional | Proposto para revisão; não executado, fora do journal             |
| Worker F3 / integração upload → classificação → extração | Não implementado nesta rodada; depende da decisão de persistência |
| Extração automática F3                                   | Desabilitada / inexistente no fluxo ativo                         |
| Benchmark pago F3, latência, custo e completude reais    | Não medidos; zero novas inferências                               |
| F4/F5 / produção / publicação clínica automática         | Fora do escopo                                                    |

A coluna Ideal mantém sua estrutura e o rascunho visual, sem alegação de salvamento persistente. Hemácias com escala ambígua permanecem neutras. Nenhum nome/resultado original foi substituído no banco.

## Entregáveis para revisão

- [SQL proposto](proposals/patient-f3-handoff.sql).
- [Diagnóstico, alternativas, integração necessária, testes e rollback](proposals/patient-f3-handoff-review.md).
- Contrato: `src/lib/laboratory-automation.ts`; testes: `src/test/laboratory-automation.test.ts`.

O contrato inicial aceita somente novos PDFs inscritos com autorização vigente, mesma unidade principal, original íntegro e classificação laboratorial sustentada com cobertura independente das páginas. Recusa históricos não inscritos, pedidos, mistos, identidade incerta, páginas incompletas e imports existentes. Não publica, confirma ou descarta resultados.

Há uma alternativa sem novas tabelas usando metadados existentes e execução delegada. A proposta aditiva foi escolhida para revisão por explicitar autoria SYSTEM e rastreabilidade de encaminhamento. Não é uma impossibilidade técnica absoluta reutilizar somente os metadados antigos. Ambos os caminhos exigem refatorar a extração atual, que depende de cookies, e a apresentação de autoria.

## Revisões em paralelo

Três agentes revisaram somente leitura:

1. Segurança SQL/concorrência/integridade: fechados casos de CHECK que aceitava NULL, tipos JSON permissivos, autoria do iniciador, timestamps e lock do import. Mantida a exigência de replay idempotente no serviço, não apenas índice único.
2. Runtime F1/F2/v3: identificados orçamento compartilhado da Function, dependência de cookies, concorrência de batches por documento e necessidade de invalidar rascunhos obsoletos após correção da classificação.
3. Fechamento F2.5: alias específico e originais preservados; adicionados texto explícito sobre adiamento de Ideal e teste de detalhe da PCR.

Essas revisões não substituem testes de PostgreSQL nem benchmark do modelo. SQL permanece candidato não homologado em execução.

## Testes executados

- 677 testes unitários/interface passaram, 88 arquivos, 80,98 s.
- Testes focados finais: 57 passaram, incluindo unidade principal alterada, nomes canônicos/originais, elegibilidade F3 e resposta tardia.
- Typecheck e ESLint dos arquivos alterados passaram.
- Nenhuma suíte de integração SQL F3, nenhum E2E de extração automática e nenhuma inferência real F3 foram executados: esses componentes ainda não estão ativos.

## Preview e preservação

- Projeto Vercel `allik-one`, branch de contexto `feature/allik-patients`, target `staging` (Preview).
- Deployment `dpl_nWC4Kbz9NhzWxTcD2wcG6nNZThrY`, READY, SHA conferido antes de atualizar o alias.
- Imutável: https://allik-52b32j9sd-atp-mkt.vercel.app
- Fixo: https://allik-one-git-feature-allik-patients-atp-mkt.vercel.app
- Neon `little-dust-61663559`, branch `br-winter-hill-b69uz195`, compute `ep-hidden-cloud-b6hskjjt`, banco `neondb`; apenas consultas com `allik_runtime`.
- [Contagens e hashes antes/depois](benchmarks/patient-f3-contract-preservation.json): mesmos 43 originais, 123 resultados e 3 versões clínicas.
- Produção permanece no deployment `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`, SHA `091612549723e484d41bd3c984e877ddd19365e6`, conferido pelo domínio oficial. Nenhuma conexão SQL de produção.
- Publicação por tag `patient-f25-close-f3-contract` e deployment explícito; branches remotas `main` e `feature/allik-patients` não foram movidas.

## Próximo passo sujeito à revisão

Conforme a exigência do responsável de apresentar SQL e rollback antes de aplicar migrations, solicitar aprovação da persistência proposta para implementação e testes em PostgreSQL descartável. Antes de qualquer aplicação no Neon de Preview, apresentar os resultados dos testes de banco e o journal final para autorização específica. Produção continua excluída.
