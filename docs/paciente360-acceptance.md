# Paciente360º — checklist de aceitação

Este documento separa entrega técnica, evidência de Preview, homologação humana e autorização de produção. Um teste automatizado aprovado não substitui a conferência clínica do profissional. A entrega implementa as quatro fases no Preview; a homologação humana e a liberação oficial continuam separadas. Os resultados técnicos desta rodada estão registrados abaixo, sem presumir aprovação clínica.

## Escopo das quatro fases

| Fase                       | Entrega técnica                                                                                           | Limite de aceitação                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1 — Documentos             | Central unificada, busca/filtros, arquivos privados, prévia e original                                    | Confirmar arquivo correto, vínculo e permissões no fluxo do paciente              |
| 2 — Extração e conferência | PDF original preservado, extração estruturada, checagens de origem, revisão explícita e versões imutáveis | IA não publica sozinha; profissional confirma identidade do paciente e resultados |
| 3 — Histórico longitudinal | Tabela por datas, busca/período, paginação, gráficos conservadores e origem                               | Somente versões confirmadas; não inferir unidades, datas ou compatibilidade       |
| 4 — Pré-consulta           | Modelos publicados, link seguro, etapas, condicionais, revisão e resposta única                           | Respostas são declarações recebidas por link, sem validação clínica automática    |

A navegação deve manter o contexto do paciente sob a identificação **Paciente360º**, sem exigir percorrer páginas desconectadas para consultar documentos, exames e pré-consulta.

## Evidência real já obtida no Preview

- [x] O responsável informou que a extração por IA funcionou no Preview.
- [x] Download do original respondeu `200`, `application/pdf`, com `private/no-store`, disposição `attachment` e `noindex`.
- [ ] Confirmar e publicar a revisão humana dessa importação. A extração recebida ainda não equivale a uma revisão confirmada.
- [ ] Conferir que a revisão publicada aparece no histórico longitudinal e abre o mesmo original.

O download confirma a operação observada de acesso ao original. Não comprova, isoladamente, todos os casos de autorização, qualidade da extração ou segurança de produção.

## Verificação técnica integrada

Validação local em 19/10/2026, com dados fictícios e PostgreSQL descartável:

- [x] Bundle de beta (`npm run test:beta:local`): migração sintética 0012 → atual, isolamento, autorização, documentos finais e impressão, congelamento de PDF, revogação de sessão e backup/restauração descartável passaram. Não comprova restauração de produção.
- [x] Typecheck, lint e build; seis avisos de Fast Refresh já existentes, sem erros.
- [x] 416 testes unitários e de interface (`npm run test`): parse literal, origem, confirmação, filtros, histórico, gráficos e condicionais.
- [x] 364 testes na suíte completa de integração e, após corrigir o vínculo da pré-consulta, 12/12 testes de segurança de documentos (incluindo um novo caso). Provisionamento do papel restrito 3/3; guardas de Preview/build 8/8.
- [x] Suíte completa de navegador 17/17 (`npm run test:e2e:local`), incluindo o E2E integrado: documentos → extração/conferência → versão confirmada → histórico/original.
- [x] E2E de pré-consulta: publicar → link → perguntas condicionais → revisão → envio único → leitura profissional.
- [x] Navegação e legibilidade em celular e desktop, com capturas sintéticas inspecionadas.
- [x] Mesmo paciente: consulta criada/iniciada pela interface, receita com 10 mg/30 cápsulas salva, recarregada, finalizada e impressa; evolução finalizada; documentos, respostas e histórico anteriores reencontrados. Sem migração nesta rodada.

O navegador local usa armazenamento e extração simulados, sem mensagens ou chamadas pagas. A impressão validada é a visualização HTML do documento finalizado; não comprova assinatura certificada, entrega externa ou aceite clínico.

## Segurança e isolamento

- [x] Autorização no backend por organização, unidade e perfil, com testes negativos entre organizações e unidades.
- [x] Histórico e arquivos respeitam unidade atual e unidade de origem conforme regras existentes.
- [x] Leitura clínica auditada antes da resposta; falha de auditoria não revela resultados.
- [x] Arquivos continuam privados; nenhum token de armazenamento ou URL pública é entregue como atalho.
- [x] Modelos enviados, revisões e resultados anteriores permanecem rastreáveis e imutáveis.
- [x] Questionários recusam respostas ocultas manipuladas e mantêm expiração, revogação e consumo único.
- [x] Tokens de convite ficam fora da query e são retirados da URL; nenhuma resposta clínica é persistida em Web Storage.
- [x] Atualização de paciente ou link não exibe dados atrasados do contexto anterior.
- [x] Produção preservada: verificações remotas de produção são somente leitura; nenhuma promoção, migração, configuração ou alteração de acesso nesta rodada.

O operador compartilhado está autorizado exclusivamente no Preview com dados fictícios. Essa autorização não se estende a produção nem substitui contas individuais no ambiente oficial.

## Homologação humana no Preview — pendente

Usar dados fictícios e registrar o resultado observado, sem inserir novas pessoas apenas para preencher o checklist:

- [ ] Encontrar e abrir um documento sem perder o contexto do paciente.
- [ ] Comparar resultados extraídos com todas as páginas do PDF, incluindo valores, unidade, referência, datas e possíveis omissões.
- [ ] Resolver exceções e confirmar somente após a conferência; observar que dados não confirmados ficam fora do histórico.
- [ ] Publicar uma correção e verificar preservação da versão anterior e atualização da versão vigente.
- [ ] Comparar datas e gráficos, distinguindo resultados qualitativos, unidades/métodos diferentes e datas ausentes.
- [ ] Publicar um questionário condicional e verificar que mudar a resposta de controle descarta respostas ocultas.
- [ ] Revisar, enviar uma vez e consultar as respostas pelo profissional, mantendo identificação de informação declarada.
- [ ] Percorrer atendimento, documentos, exames, evolução e prescrição com quantidade/unidade e orientações corretas.

A confirmação de que a extração funcionou fecha apenas essa operação observada; não encerra os demais itens.

## Produção — etapa separada, não autorizada por este checklist

Antes de eventual promoção oficial:

- [ ] Concluir a homologação humana e registrar pendências aceitas pelo responsável.
- [ ] Preparar recuperação/restauração, migrações aplicáveis, conta restrita e configuração oficial.
- [ ] Revisar acesso individual de profissionais e administradores e restringir o operador compartilhado de Preview.
- [ ] Validar configuração e tratamento de dados pelo provedor de IA para o uso oficial pretendido.
- [ ] Registrar candidato, evidências e autorização concreta para implantação em produção.

Não fazem parte desta entrega: portal do paciente, monitor de apresentação, diagnósticos automáticos, metas laboratoriais universais ou evolução de vendas/estoque/comércio.
