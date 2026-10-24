# F3 — persistência validada em PostgreSQL descartável

Entrega de 24/10/2026. **A migration 0078 foi aplicada somente em bancos locais descartáveis. Preview e produção não foram acessados por SQL nem atualizados. A extração automática continua desabilitada. Não houve inferências pagas.**

## Implementação

- [SQL final 0078](../drizzle/0078_laboratory_automation_handoff.sql), schema Drizzle, snapshot e journal oficial: acrescentam apenas as duas tabelas de encaminhamento aprovadas. Não armazenam outra cópia do documento ou outro conjunto de resultados.
- `src/server/laboratory-automation-store.ts`: inscrição, leitura autorizada e eventos internos SYSTEM/HUMAN, com transação obrigatória, revalidação de acesso e replay de operação por escopo/conteúdo exatos.
- `src/lib/laboratory-automation-events.ts`: contrato estrito dos payloads e vínculos entre evento, tentativa e classificação. Não existe ação de publicação/validação clínica nesse contrato.
- `src/server/laboratory-automation-store.test.ts`: 35 casos reais de banco, sem provedor, reaproveitando eventos F2, imports/revisões/guards v3 e confirmação manual já existente.

O serviço é interno: não foi exposto em rotas, ligado ao upload nem ao worker F2. Nenhum segundo motor de extração foi criado. O pipeline laboratorial v3 e os serviços de classificação F2 permanecem intactos; somente um teste antigo F2 precisou deixar de presumir que a 0077 seria para sempre a última migration.

## SQL final e diferenças em relação à proposta

[Diff integral](benchmarks/patient-f3-persistence-sql-diff.patch), comparando a proposta aprovada com a 0078. Diferenças relevantes:

1. DDL, constraints, FKs e índices integrados ao schema/snapshot Drizzle com nomes explícitos. BEGIN/COMMIT externos retirados porque o migrator já controla a transação.
2. Grants condicionais à existência de `allik_runtime`, permitindo migrar um banco limpo antes do provisionamento desse papel. O provisionamento existente identifica tabelas append-only e concede SELECT/INSERT; UPDATE/DELETE/TRUNCATE continuam negados.
3. Registro profissional INVALID/DUPLICATE bloqueado na segunda barreira SQL, além da validação do backend.
4. Lock compartilhado com o v3: classificação → pedido F3 → `lab:org:documento`. Isso protege a corrida com uma abertura manual, inclusive quando o import ainda não existe.
5. READY exige import do mesmo original/escopo/tentativa, autoria delegada correspondente ao iniciador, atualização na mesma transação, ausência de revisão confirmada, `patientConfirmed=false` e todas as linhas `verified=false`.
6. Backend também aplica a máquina de estados, exige transação explícita e valida acesso atual. Replay exato devolve o evento existente; operação com conteúdo, ator, revisão ou escopo diferente falha, sem nova gravação.

A proposta original foi preservada para comparação. **Os 78 arquivos SQL anteriores e as 78 entradas anteriores do journal permaneceram idênticos**. Acrescentada apenas a entrada 78 (79ª entrada), com timestamp posterior à anterior, independentemente do relógio da sessão. `drizzle-kit check` passou.

## Testes executados

| Verificação                                                |                            Resultado |
| ---------------------------------------------------------- | -----------------------------------: |
| Integração completa em PostgreSQL 16 descartável           |             **555/555**, 42 arquivos |
| Casos específicos de persistência F3, em execução separada | **35/35**, subconjunto da integração |
| Unitários/interface completos                              |             **688/688**, 89 arquivos |
| Provisionamento/papel restrito                             |                              **3/3** |
| Typecheck e ESLint dos arquivos alterados                  |                             passaram |
| Schema/snapshots Drizzle                                   |                             passaram |

A suíte completa de integração levou 75,94 s; o teste focado final levou 4,34 s. Esses tempos são da execução automatizada local, **não latência do extrator nem economia de tempo humano**.

A primeira execução apontou fixtures incompatíveis com regras existentes (nome de organização único, código de paciente e privilégio legado do papel de teste), corrigidas sem flexibilizar controles. A regressão completa revelou uma expectativa antiga de que a 0077 seria a última migration; o teste foi ajustado para comparar o journal inteiro antes/depois do rerun e conferir a integridade da 0077 pelo seu registro específico. Nenhuma migration anterior foi alterada.

## Falhas, concorrência e recuperação

- Inscrição exige original e RECEIVED novos na mesma transação; acervo histórico, hash incorreto, outro iniciador e escopo divergente são recusados no backend e no SQL.
- Claims concorrentes usam revisão e locks compartilhados. A mesma operação retorna a mesma identidade; operações distintas disputando a mesma revisão produzem um único vencedor.
- Reclassificação F2 durante a tentativa invalida READY/FAILED atrasados. A correção humana permanece; cancelamento operacional não elimina o original ou eventos anteriores.
- Mudança de unidade principal e revogação de acesso bloqueiam persistência de uma conclusão. Um cancelamento SYSTEM de um pedido corretamente identificado continua disponível após revogação, sem leitura ou publicação de resultados.
- Nova tentativa requer decisão HUMAN auditada, limite de duas tentativas e reaproveitamento do import com falha associado ao mesmo pedido. Tentativa anterior não pode concluir a nova execução.
- Uma abertura manual concorrente tem prioridade quando já possui o lock v3; não é sobrescrita por um claim automático.
- READY_REVIEW e evento F3 READY devem ser gravados na mesma transação. Erro posterior, tentativa obsoleta ou indicação automática de confirmação humana faz a transação inteira voltar atrás.
- Autocommit é recusado. Isso impede que advisory locks sejam liberados antes das operações que devem proteger.
- O teste de papel restrito exerce INSERT e SELECT nas duas tabelas novas e confirma ausência de UPDATE/DELETE/TRUNCATE. Ele mantém apenas os direitos necessários nas tabelas legadas que os triggers consultam/travam, como no runtime existente.

Não há retry pago, timer, hook, chamada de modelo ou processo em background nesta entrega. A recuperação aqui validada é a persistência de falha/retry/cancelamento e a rejeição de respostas antigas. Recuperação operacional de workers mortos será validada quando a execução for implementada e autorizada; não se declara entrega exatamente uma vez ao provedor.

## Isolamento e preservação

[Evidência estruturada](benchmarks/patient-f3-persistence-local-checks.json) registra hashes, contagens e verificação dos arquivos anteriores. A fixture usa dois originais sintéticos do mesmo paciente, um resultado e uma revisão já selados. Após uma nova tentativa F3 falhar, todos os hashes e contagens permanecem iguais; o resultado literal `<0,1` permanece inalterado.

Os testes também tentam organização, paciente, unidade, hash, uploader e timestamp incorretos diretamente no SQL, além de papéis/contextos forjados no backend. Evento SYSTEM não é atribuído ao profissional como decisão clínica. Confirmação clínica continua no serviço v3 existente e exige ação autorizada.

Os runners recusam banco remoto e exigem localhost/127.0.0.1 e nome com sufixo `_test`. Os contêineres PostgreSQL são exclusivos e removidos ao final. Nenhuma consulta, migration, alteração de credencial ou deployment de Preview/produção foi realizada nesta rodada. Nenhum fornecedor novo, OCR adicional, F4/F5 ou publicação automática foi implementado.

## Rollback não destrutivo

Depois de uma futura aplicação autorizada, desabilitar o encaminhamento F3 e aguardar/cancelar tentativas em voo por evento. Se necessário, retornar o runtime ao candidato anterior, mantendo as novas tabelas, inscrições, eventos, imports, originais, resultados e revisões. O schema aditivo não exige excluir dados para executar o runtime anterior.

Não há down migration destrutiva. Não executar DROP/DELETE/TRUNCATE nem restaurar backup por cima de registros novos. Uma falha antes do commit da migration é revertida pela própria transação do migrator. Após commit/primeiro uso, rollback é operacional e preserva a trilha.

## Próxima autorização

A base de persistência está pronta para revisão da **aplicação da 0078 exclusivamente no banco isolado do Preview**, com checagem de identidade/schema/privilégios antes e depois. Essa aplicação não deve ativar o encaminhamento ou executar inferências. A ativação/homologação do worker automático permanece uma etapa posterior, sem produção ou publicação clínica automática.
