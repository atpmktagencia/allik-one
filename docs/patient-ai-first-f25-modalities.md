# F2.5 — uma linha por biomarcador

A tabela longitudinal agora possui uma linha principal por identidade visual de biomarcador. A expansão na própria tabela revela as demais modalidades/séries. O nome abre o gráfico da modalidade selecionada; tanto o seletor principal quanto o seletor do gráfico atualizam a apresentação, sem gravar resultados.

## Regras de apresentação

- Basófilos, eosinófilos, neutrófilos, linfócitos e monócitos possuem reconhecimento explícito de sufixos percentual, absoluto, contagem e unidade ausente. Não se usa similaridade aproximada para fundir nomes clinicamente diferentes.
- Percentual é a visualização inicial quando disponível. O profissional pode escolher outra modalidade; seleção e expansão acompanham o estado existente do workspace ao alternar seções/reabrir a visualização. Não há persistência de preferência entre sessões de login nesta entrega.
- Modalidades de contagem são reconhecidas pela unidade explícita. Não há inferência pelo valor, conversão ou cálculo entre percentual e absoluto.
- Unidade, método, material e laboratório continuam particionando séries exatas dentro do mesmo biomarcador. Unidades aparentemente equivalentes não são convertidas nem conectadas silenciosamente. Opções com a mesma modalidade mostram os metadados para desambiguação.
- Unidade ausente, unidade não reconhecida ou contradição entre nome e unidade fica como modalidade não resolvida: valores literais e original acessíveis, sem cor de normalidade nem gráfico numérico.
- “Normal (laboratório)” acompanha a referência do resultado da série selecionada. Cores utilizam as referências próprias de cada resultado, sem metas universais.
- O sistema atual não tem contrato de metas individualizadas neste histórico. “Ideal” mostra “Sem meta definida”; esta entrega não inventa faixas, metas ou cores de idealidade. A edição/persistência de metas não foi implementada.
- Cada gráfico recebe somente uma série exata da modalidade escolhida. O bloqueio existente de linhas entre métodos/unidades/material/laboratórios incompletos permanece.
- O agrupamento é de apresentação. Nomes, resultados, datas, referências, documentos, versões e autoria originais não são alterados.

## Arquivos

- `src/lib/laboratory-biomarkers.ts`: agrupamento visual, modalidades explícitas, nomes e seleção padrão.
- `src/components/clinic/laboratory-history.tsx`: expansão inline, seleção, referências, coluna Ideal, gráficos e estado de navegação.
- `src/test/laboratory-biomarkers.test.ts`: aliases, conflitos, separação de unidades/métodos e imutabilidade.
- `src/test/laboratory-history-ui.test.tsx`: seleção, expansão, cores, gráficos, pendências e restauração de estado.
- `e2e/laboratory-review.spec.ts`: três resultados sintéticos adicionais conferidos pelo fluxo real, alternância de modalidades e comparação dos payloads antes/depois no PostgreSQL descartável.

## Validação

- 612 testes unitários/interface, 84 arquivos, passaram. Após o ajuste final de identidade das linhas e sincronização do gráfico, 21 testes focados passaram novamente.
- Typecheck e ESLint dos arquivos alterados passaram.
- E2E integrado: 1/1, 28,8 segundos no navegador, PostgreSQL descartável e runtime restrito. O fluxo inclui conferência e correção de exames, questionário, anamnese, prescrição e preservação do rascunho entre abas.
- O E2E confirma que seleção/expansão não mudam os payloads clínicos. Ao corrigir posteriormente uma revisão, todas as cinco linhas sintéticas precisam ser novamente conferidas; o teste foi atualizado para respeitar essa proteção.
- [Modalidades expandidas](screenshots/patient-f25/modalidades-expandidas.png) e [modalidade não resolvida](screenshots/patient-f25/modalidade-nao-resolvida.png): capturas locais do teste integrado, dados exclusivamente sintéticos, viewport desktop 1500 × 1000. Não são capturas de produção.
- Nenhuma nova migration, chamada paga de IA ou alteração de persistência clínica. Nenhuma alteração em produção.

## Limitações

O histórico continua paginado em até 500 resultados por consulta, com aviso de comparação limitada à página. O agrupamento não implica completude do histórico nem normalização clínica de nomenclaturas arbitrárias. Modalidades/aliases não reconhecidos com segurança devem continuar explícitos para revisão; biomarcadores clinicamente distintos não são fundidos.
