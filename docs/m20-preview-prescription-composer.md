# M20A — Composição de receita e protocolos pessoais no Preview

Incremento exclusivo do Preview sintético. Backend, interface e testes foram divididos entre agentes, com integração pela assistência principal; isso não constitui auditoria externa ou liberação em produção.

O profissional responsável pelo atendimento pode informar componentes e respectivas doses/unidades, apresentação, via, orientações e etapas ordenadas da posologia. O sistema soma somente as unidades de administração explicitamente informadas: unidades por administração × administrações por dia × dias. Não converte unidades, sugere doses, verifica compatibilidade ou capacidade de cápsulas, nem classifica medicamentos controlados. Manutenção sem prazo deixa o total indeterminado. Componentes em cápsulas individuais exigem conferência separada das quantidades.

Protocolos são pessoais, restritos ao autor e à organização, sem dados de pacientes. Edições e arquivamento mantêm versões imutáveis. A lista mostra até 100 protocolos ativos. A composição calculada só alimenta um rascunho de receita pelo fluxo existente; o profissional deve revisar antes de salvar/finalizar. Documentos finalizados e seus dados congelados permanecem preservados. A assinatura continua física.

A API exige identidade individual com permissão clínica, escopo das unidades do atendimento e do paciente atual, registro profissional apto e vínculo como profissional responsável. Identidades compartilhadas de demonstração e integrações não podem compor ou gerenciar protocolos.

## Manutenção e verificação

Alvo autorizado: projeto Neon `little-dust-61663559`, branch `br-winter-hill-b69uz195`, banco `neondb`. A migration aditiva `0064_prescription_composer` cria protocolos e versões; não altera registros clínicos existentes. Verificar os 64 hashes anteriores antes da aplicação transacional explícita. Conceder ao runtime acesso operacional aos protocolos e apenas SELECT/INSERT às versões imutáveis, sem TRUNCATE.

O projeto atingiu o limite de branches na rodada anterior; nenhum backup será removido para contornar o limite, e os checkpoints anteriores não representam uma cópia recente deste incremento. Produção permanece fora do escopo.

Verificação concluída: typecheck, build e lint aprovados (seis avisos preexistentes de Fast Refresh); 204 testes unitários e mais dois testes específicos de interface, 260 testes de integração, 11 E2E com runtime restrito, verificações do runtime 3/3 e guardas de build/migration 7/7. O E2E novo confirma cálculo, reutilização de protocolo, revisão explícita e persistência como DRAFT, sem finalização.

Os 64 hashes existentes foram conferidos integralmente antes da transação. A 0064 foi aplicada somente no Preview, que agora possui 65 migrations. A conta restrita recebeu os grants específicos; histórico sem UPDATE/DELETE/TRUNCATE, TEMP negado. Não houve criação de usuários, envio de mensagens ou alteração de credenciais. A base oficial permaneceu com 61 migrations e sem as tabelas do M20.
