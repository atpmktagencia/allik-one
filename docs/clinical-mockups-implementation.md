# Atendimento e Paciente360º — implementação dos mockups

## Referência aprovada

As duas imagens fornecidas em 19/10/2026 são a especificação visual: anamnese em 1536 × 1024 e mosaico das seis telas. A comparação usa a organização e as proporções, sem copiar nomes, resultados, diagnósticos ou outras informações clínicas ilustrativas.

Medidas de referência: barra global 54 px, barra de navegação/ações aproximadamente 52 px, faixa clínica aproximadamente 111 px, margens 20 px, intervalos 12 px, sidebar 205 px e contexto 328 px. Em desktop, o centro ocupa a largura restante. Exames, prescrição e solicitações substituem o contexto da anamnese pelo painel pertinente.

Os tokens existentes do espaço clínico são adaptados para superfícies brancas, fundo cinza azulado, texto escuro, bordas suaves, raios de 10–12 px e teal funcional. As páginas operacionais de estoque mantêm seu comportamento.

## Invariantes

- Cinco etapas não lineares: Anamnese, Exames, Prescrição, Solicitações e Revisão.
- Os editores permanecem montados na troca de etapas; rascunhos não são descartados por navegação interna.
- Estado de salvamento derivado dos dados efetivamente salvos e das mudanças pendentes. Sem indicação fictícia de salvamento automático.
- Finalizar documento, finalizar evolução e concluir atendimento continuam operações distintas, sujeitas às validações atuais.
- Resultados laboratoriais confirmados, unidades, referências e documentos originais continuam sujeitos às regras de isolamento e auditoria.
- Nenhuma migração, dose sugerida, alteração de documento finalizado ou modificação de produção nesta entrega visual.

## Limites técnicos identificados antes da implementação

O sistema não possui gravação/transcrição de consulta por IA nem tela de apresentação ao paciente. Esses recursos não serão apresentados como ações operacionais. A evolução armazena texto simples: ferramentas de edição precisam produzir texto que possa ser preservado ao salvar e recarregar; não haverá promessa de formatação rica persistente sem suporte de armazenamento.

Informações ausentes, como foto, sinais vitais, nascimento ou diagnósticos, serão identificadas como não informadas ou omitidas conforme a região. Nenhum dado do mockup será preenchido como se pertencesse ao paciente.

Procedimentos clínicos reutilizam o plano estruturado existente quando integrados; não se cria um novo tipo de documento nem uma movimentação comercial ou de estoque para reproduzir uma aba.

## Validação

Implementadas as seis telas, com navegação não linear, painéis recolhíveis e componentes existentes. O editor de documentos é uma única instância com buffers por documento; o registro terapêutico também permanece montado. A troca de unidade é vetada antes de alterar seleção, armazenamento ou consultas quando o atendimento possui alterações ou salvamento pendente.

Na prescrição, as categorias reproduzem a organização aprovada. Medicamentos utiliza a tabela do registro terapêutico; Manipulados, Injetáveis e Suplementos abrem o compositor existente sem sugerir dose ou via. Orientações usa o tipo de documento já existente; Modelos apresenta a biblioteca autorizada. O registro terapêutico e o documento imprimível mantêm salvamentos separados: **Inserir itens na receita** acrescenta somente o snapshot salvo, mediante ação explícita e confirmação quando já há texto. A prévia identifica essa distinção.

### Comparação local

Capturas em 1536 × 1024 no percurso sintético de um mesmo paciente:

| Tela                          | Evidência do navegador                                                            |
| ----------------------------- | --------------------------------------------------------------------------------- |
| Anamnese                      | `mockup-01-anamnese-desktop.png`                                                  |
| Exames e original privado     | `mockup-02-exames-desktop.png`                                                    |
| Prescrição — lista e editor   | `mockup-03-prescricao-desktop.png`, `mockup-03-prescricao-editor-desktop.png`     |
| Solicitações — lista e editor | `mockup-04-solicitacoes-desktop.png`, `mockup-04-solicitacoes-editor-desktop.png` |
| Revisão                       | `mockup-05-revisao-desktop.png`                                                   |
| Visão geral                   | `mockup-06-prontuario-desktop.png`                                                |

Após a primeira comparação, o cabeçalho foi reduzido em aproximadamente 20 px e a mensagem de sucesso passou a notificação sem deslocar o conteúdo. A prescrição recebeu categorias e tabela; solicitações receberam lista compacta; a revisão foi ajustada para seis resumos em linha no desktop. Os estados transitórios são aguardados antes das capturas.

Typecheck e build aprovados; lint sem erros, com seis avisos de Fast Refresh preexistentes. **435 testes unitários/de interface e 365 testes de integração passaram**, além de 3/3 verificações do papel restrito. Os testes abrangem buffers entre abas, ponte explícita para a receita, salvamento concorrente, acesso por unidade e veto da troca de unidade durante edição. A suíte completa de navegador passou em **17/17 cenários**, incluindo o PDF privado no painel de exames, rascunhos entre etapas, finalização e impressão. As 8 verificações de Preview/build também passaram. A comparação publicada está em andamento.

### Diferenças necessárias e limites

- A evolução usa ferramentas de texto simples; o editor rico existente continua disponível nos documentos. Não é prometida formatação que desapareceria ao recarregar.
- A apresentação de um original PDF usa controles nativos do navegador. A leitura e o download continuam privados.
- A organização dos parâmetros laboratoriais mantém os agrupamentos conservadores existentes. Não se infere uma taxonomia clínica a partir do nome do exame.
- Resultados, modelos ou tratamentos ausentes produzem estados vazios reais; não são preenchidos com os exemplos das imagens.
- Gravação por IA, monitor e compartilhamento completo do prontuário não ganharam controles fictícios.
- Capturas locais e capturas do Preview são evidências distintas. A homologação visual pelo responsável e a liberação de produção continuam separadas.
