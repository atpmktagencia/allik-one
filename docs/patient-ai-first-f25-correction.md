# F2.5 — correção visual e pendência de persistência de Ideal

**Estado: UX corrigida para homologação no Preview; F2.5 não encerrada enquanto a persistência de Ideal estiver pendente.** Nenhuma migration de metas foi aplicada. Nenhum avanço para F3.

## Causa comprovada

A primeira implementação usava cada partição exata por unidade/método/material/laboratório como modalidade selecionável. Isso era adequado para separar séries de dados, mas inadequado como projeção visual: criava nomes de opções enormes e ocultava parte das coletas quando o usuário trocava a origem. A tabela ainda repetia datas, referências, links e descrições técnicas em cada célula.

No Preview anterior (`2c1d39a`), 50 linhas principais medidas tinham entre **145 e 337 px**. A captura mostra que a validação local anterior não representava a densidade dos documentos do Preview. A inspeção visual desta rodada também identificou variações como “Linfócitos atípicos (contagem)” e “Plaquetas - contagem”, ampliando os testes e corrigindo os sufixos antes da publicação.

## Nova projeção de leitura

- Uma linha principal por biomarcador canônico, com **Exame | Unidade | Normal | Ideal | Datas**.
- Modalidades de apresentação agrupam resultados de diferentes origens com a mesma modalidade e unidade literal. As partições exatas permanecem preservadas internamente; o gráfico calcula conexões dentro de cada partição, nunca entre métodos/laboratórios incompatíveis.
- Alternador compacto Percentual / Absoluto / Não resolvido, quando disponíveis. Escalas de unidade distintas continuam opções diferentes, identificadas somente pela unidade, sem nomes de métodos ou laboratórios.
- Sufixos explícitos de modalidade são removidos da identidade de apresentação. Qualificadores como atípicos, imaturos, livre e total permanecem distintos. Espaços, acentuação e pontuação irrelevante são normalizados apenas para leitura; não há similaridade aproximada nem renomeação de resultados armazenados.
- A sigla UPA aceita variações tipográficas na apresentação da proveniência, preservando o restante do nome e o valor original. Bom Jardim e Cristo Redentor não são tratados como a mesma origem.
- Linhas recolhidas com altura de 44 px, sem descrições técnicas ou links PDF. Múltiplos resultados na mesma data permanecem acessíveis na célula, sem exclusão ou deduplicação clínica silenciosa.
- “Normal” mostra a referência literal ou “Varia por coleta” quando há mais de uma. O cálculo de cor consulta a referência própria de cada entrada.
- Clique no resultado abre o painel com valor original, unidade, referência, estado de Ideal, nome original, laboratório, método, material, data, documento privado e página de origem.

## Cores

| Condição demonstrável                                                           | Ponto                     |
| ------------------------------------------------------------------------------- | ------------------------- |
| Fora da referência laboratorial aplicável                                       | Vermelho, mesmo sem Ideal |
| Dentro do normal e de Ideal persistido, válido e vigente                        | Verde                     |
| Dentro do normal, fora de Ideal persistido válido                               | Amarelo                   |
| Sem Ideal válido, referência não comparável ou modalidade/unidade não resolvida | Neutro                    |

Cada ponto possui tooltip explicativo e descrição acessível. Não há preenchimento saturado de células. Faixas explícitas com separador “A”, vírgula decimal e unidade literal compatível são aceitas na leitura; unidade contraditória continua neutra. Não se aplica uma referência absoluta a um valor percentual. Valores com unidade explícita compatível, como `0%`, podem gerar número derivado para o gráfico, mantendo o payload e o texto original intactos.

Verde/amarelo têm regras implementadas e testes com metas de referência, mas **não são ativados por rascunhos**. Nenhuma meta universal é criada. O runtime atual não consulta uma tabela de metas ainda não aprovada.

## Ideal: editor entregue, persistência bloqueada deliberadamente

A coluna é clicável. O editor compacto inclui biomarcador, modalidade, unidade, mínimo, máximo, escopo Organização/Profissional/Paciente, justificativa e vigência. Permite guardar, revisar e desativar **rascunho no estado do workspace**, claramente identificado como não aplicado. Não há falsa mensagem de salvamento clínico nem aplicação do rascunho às cores. Não há compartilhamento entre organizações, profissionais ou pacientes a partir desse rascunho.

Não existe estrutura adequada de metas clínicas no schema atual. Reutilizar documentos ou resultados para essa finalidade violaria seus contratos. Por instrução expressa do pedido — “Se persistência exigir migration, interromper somente essa parte, apresentar SQL e rollback e solicitar aprovação” — somente a persistência foi suspensa.

- [Proposta de persistência e autorização](proposals/f25-ideal-persistence-review.md).
- [SQL proposto, fora do journal](proposals/f25-ideal-targets.sql).
- Revisões append-only, autoria, idempotência, unidade/modalidade exatas e rollback operacional sem exclusão de eventos.
- O SQL ainda requer implementação/testes locais de autorização, escopo, concorrência e sobreposição. Não é apresentado como migration já homologada.
- A próxima autorização solicitada é para implementar e testar essa persistência em PostgreSQL descartável. Aplicação no Preview exige revisão/autorização posterior. Produção continua fora de escopo.

## Homologação e evidências

- **632 testes unitários/interface passaram**, em 85 arquivos. Typecheck e ESLint dos arquivos alterados passaram. O E2E integrado passou (1/1, 28,5 s no navegador).
- Suíte completa e E2E integrado executados em ambiente local isolado, com papel restrito. O E2E mede altura, testa alternância/gráficos, abre Ideal e compara payloads antes/depois. Anamnese, rascunhos, prescrições e questionários continuam exercitados.
- Capturas antes/depois feitas **no Preview real**, mesmo viewport 1440 × 1000 e paciente de teste, sem uploads ou chamadas de processamento. Links com nomes de arquivos foram mascarados na captura anterior para não expor identificadores. O script de captura cancela POST de documentos, classificação ou resultados e exige zero tentativas dessas operações.
- Medição final do Preview: 38 linhas principais/38 biomarcadores únicos, todas com 44 px; 8 pontos vermelhos e 54 neutros; um caso de “Varia por coleta”; alternador Percentual/Absoluto/Não resolvido sem proveniência no rótulo. Nenhuma tentativa de POST bloqueada foi observada, pois nenhuma foi disparada pelo fluxo.
- Comparação manual com a organização longitudinal solicitada na referência: cabeçalho simples, nomes curtos, datas horizontais, grupos recolhíveis, pontos discretos e detalhes escondidos. Não se declara comparação pixel a pixel com um arquivo de referência que não foi anexado nesta rodada.
- [Antes](screenshots/patient-f25-correction/before-preview.jpg), [depois com alternador](screenshots/patient-f25-correction/after-modalities-preview.jpg), [editor Ideal](screenshots/patient-f25-correction/ideal-editor-preview.jpg).
- [Medições visuais](benchmarks/patient-f25-correction-visual.json) e [contagens/hashes de preservação](benchmarks/patient-f25-correction-preservation.json).

## Preservação e limites

Preview: Neon `little-dust-61663559`, branch `br-winter-hill-b69uz195`, compute `ep-hidden-cloud-b6hskjjt`, banco `neondb`, leitura com `allik_runtime`. O ambiente é o Preview marcado como sintético; nenhum documento foi enviado a IA nesta rodada. Contagens e hashes completos dos originais, resultados e versões clínicas foram comparados antes/depois. O journal continua com 78 entradas e `inventory_laboratory_ideal_events` não existe no banco.

Produção permanece no deployment `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`, SHA `091612549723e484d41bd3c984e877ddd19365e6`. Não houve conexão SQL de produção, reprocessamento, mudança no pipeline v3, nova IA ou alteração de documentos originais.

A tabela continua paginada e avisa que a comparação se limita à página carregada. Referências ambíguas e escalas não normalizadas continuam sem interpretação automática. A pendência principal para concluir a F2.5 é a persistência autorizada de metas, com backend e testes de segurança.

## Candidato publicado

- Runtime `9bc0149b6ed0d88df0ae45f81b097f322ae1581e`, branch de contexto `feature/allik-patients`, publicação por tag e deployment explícito de Preview.
- Deployment `dpl_7hHKfqzxAc4A7wuGne32YtmzzcN2`, target `staging` (Preview), READY e SHA conferido antes das capturas.
- URL imutável: https://allik-9lwnlt798-atp-mkt.vercel.app
- URL fixa de avaliação: https://allik-one-git-feature-allik-patients-atp-mkt.vercel.app
- A projeção final apresenta 38 biomarcadores, todos com 44 px, onde a projeção anterior apresentava 55, dos quais 50 estavam renderizados na captura anterior. Essa redução corresponde ao agrupamento visual, não a exclusão de resultados. Os mesmos 123 resultados confirmados continuam no banco.
