# Remoção das cotas de extração laboratorial

Em 20/10/2026, o responsável solicitou explicitamente remover os limites internos de
seis extrações por hora e vinte por dia. Esses limites foram introduzidos no código
em `272d67f`; não eram uma janela de funcionamento exigida pela OpenAI.

`laboratoryResultsResponse` deixa de consumir ou consultar os contadores
`lab-extraction-hour` e `lab-extraction-day`. Não há limite interno por quantidade
horária/diária no fluxo de extração. Os registros antigos não são apagados e deixam
de bloquear a operação; nenhuma migration ou alteração de banco é necessária.

Mantidos: autenticação, organização/unidade, autorização clínica, original privado,
integridade, auditoria, idempotência, controle de versões, concorrência por import,
tamanho/páginas, timeout e confirmação clínica explícita. O mecanismo compartilhado
de proteção do login não é alterado. Limites do fornecedor continuam independentes.

Regressão específica: preencher ambos os contadores antigos até o limite, realizar
`EXTRACT`, exigir HTTP 200 e `READY_REVIEW`, uma chamada ao extrator, paciente/linhas
não confirmados e zero resultados publicados. O SDK é controlado no teste; isso não é
uma inferência real da D.2.

Os relatórios de benchmark anteriores permanecem registros das cotas e deployments
que existiam quando foram medidos. O relato de bloqueio diário não se aplica ao novo
candidato após esta mudança. As seis inferências D.2 continuam sem resultados novos
até sua execução real; retirar a cota não preenche suas métricas.

Entrega na branch `feature/allik-patients`, para Preview. Sem promoção de produção,
publicação clínica automática, OCR adicional ou novo fornecedor de IA.

Validação: 42 testes unitários/interface focados, 463 testes de integração em
PostgreSQL 16 descartável e três verificações do papel restrito passaram. Typecheck,
lint dos arquivos alterados e formatação aprovados. O banco descartável foi removido
pelo runner após a suíte; nenhuma credencial/banco do Preview ou produção foi usada.
