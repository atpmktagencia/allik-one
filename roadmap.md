# Allik One — roadmap operacional

Este arquivo registra o estado funcional do produto. Cada entrega deve preservar autorização por
unidade, autoria individual, auditoria imutável e separação entre decisão clínica e cálculo
comercial.

## Estoque e operação

- [x] Milestone 1 — API, dashboard, PostgreSQL, migrations, ledger e Preview verificado.
- [x] Milestone 2 — Compras e recebimento parcial transacional.
- [x] Milestone 3 — Histórico, transferências, contagens e ajustes.
- [x] Milestone 4 — Aplicação transacional, baixa por lote e FEFO.
- [x] Milestone 5 — Rastreabilidade ponta a ponta.
- [x] Milestone 6 — Cadastro e edição de produtos, locais e usuários do piloto.
- [x] Milestone 7 — Fornecedores, catálogos e pedidos com custos.

## Pacientes, tratamentos e demanda

- [x] Cadastro operacional de pacientes com escopo por unidade.
- [x] Tratamentos, documentos de prescrição privados e agenda de aplicações.
- [x] Reservas, demanda futura e sugestão de compra.
- [x] Consumo agendado, apresentações abertas e perdas fracionárias.
- [x] Precificação por apresentação e por dose com validação administrativa.

## Agenda e prontuário clínico

- [x] Agenda por unidade, profissional, sala e leito/poltrona.
- [x] Cadastro de recursos, tipos de atendimento e conselho profissional.
- [x] Workspace de atendimento com autoria profissional e reassunção auditada.
- [x] Evolução longitudinal, sinais vitais e cálculo de IMC.
- [x] Problemas e alertas clínicos auditados.
- [x] Anamnese e exame físico estruturados em seções expansíveis.
- [x] Roteiros opcionais de pré-preenchimento da evolução.

## Próximas entregas

- [x] Consolidar diagnósticos/hipóteses, plano clínico e retorno no prontuário longitudinal.
- [ ] Implementar prescrição de tratamento durante o atendimento, vinculada ao profissional,
      paciente e versão imutável do encontro.
- [ ] Gerar orçamento a partir da prescrição, mostrando apresentação, dose, quantidade prevista,
      materiais, perda técnica, custo, preço aprovado e total estimado.
- [ ] Manter prescrição clínica e orçamento comercial como registros separados e auditáveis; o
      orçamento não pode alterar automaticamente a conduta ou a prescrição.
- [ ] Permitir converter orçamento aceito em tratamento/reserva sem duplicar paciente, produto ou
      dose e sem baixar estoque antes da aplicação/consumo real.
- [ ] Revisar impressão/exportação, assinatura profissional e trilha de versões antes de liberar
      receitas ou documentos clínicos definitivos.
- [ ] Executar auditoria externa e E2E clínico completo antes da promoção para a versão estável.

## Critérios para prescrição com orçamento

- A dose e a via são decisões do profissional; o sistema apenas calcula e alerta inconsistências.
- O cálculo deve usar somente preços vigentes e aprovados, preservando o valor aplicado na data.
- Quantidades fracionárias devem respeitar concentração, unidade-base, precisão mensurável, prazo
  após abertura, perda técnica e materiais adicionais.
- O aceite comercial não substitui consentimento, receita, conferência clínica ou registro de
  aplicação.
- Toda leitura e escrita deve respeitar organização, unidade, função e profissional responsável.
