# Paciente360º — Fase 4: questionários pré-consulta

## Escopo técnico entregue

O Paciente360º reúne o contexto do paciente e reaproveita a biblioteca existente de questionários. Esta fase acrescenta a configuração de perguntas condicionais e a experiência de preenchimento por etapas, sem criar uma segunda biblioteca, novas tabelas ou migrações.

Continuam disponíveis perguntas de texto e escolha única, rascunhos e versões publicadas, convites por unidade, expiração e revogação, resposta única transacional e leitura profissional sujeita às permissões clínicas. Cada convite preserva as perguntas da versão publicada no envio: editar um modelo não muda convites anteriores nem respostas já recebidas.

## Perguntas condicionais

No editor profissional, **Exibir esta pergunta** permite escolher entre exibição permanente e uma resposta específica de uma pergunta de escolha única anterior. O campo seguinte seleciona a opção que ativa a pergunta. Todas as respostas continuam opcionais, inclusive as condicionais.

A condição é armazenada no conteúdo versionado da pergunta como `visibleWhen: { questionId, equals }`. O contrato compartilhado valida que a pergunta de origem vem antes, é de escolha única e contém a opção indicada. Referências quebradas, dependências futuras e condições incompatíveis não podem ser salvas ou publicadas. Remover a pergunta de origem ou alterar suas opções pode exigir corrigir as condições dependentes; o editor sinaliza a inconsistência e bloqueia o salvamento.

O servidor valida novamente o modelo e as respostas contra a versão imutável do convite. A interface não constitui a barreira de autorização. Um descendente só aparece quando todos os seus ancestrais condicionais estão visíveis e sua condição é atendida. Campos desconhecidos, escolhas inválidas e respostas preenchidas de perguntas ocultas são recusados pelo backend.

## Experiência do paciente

O formulário mostra até cinco perguntas **visíveis** por etapa, com progresso, navegação para frente e para trás e revisão opcional antes do envio. O número de etapas acompanha as condições; perguntas ocultas não contam como pendências nem aparecem na revisão.

Alterar uma resposta de controle remove imediatamente da memória as respostas de todos os ramos que se tornam ocultos. Reabrir o ramo não recupera respostas descartadas. O envio também filtra novamente as perguntas visíveis. A equipe profissional consulta apenas as respostas aplicáveis, identificadas como relato recebido por link e não como informação clinicamente verificada.

Nenhuma etapa envia respostas parciais. O envio final usa a operação de resposta única existente. Respostas e token ficam apenas na memória da página; fechar ou recarregar perde o preenchimento ainda não enviado, como explicado na interface. Não são usados `localStorage` nem `sessionStorage` para esses dados.

## Segurança preservada

- Link com token no fragmento, removido da URL antes da requisição.
- Token armazenado como hash no servidor, com expiração, revogação e consumo único.
- Novo link limpa respostas, etapa e revisão anteriores; respostas atrasadas de uma requisição antiga não substituem o formulário atual.
- Endpoint público autoriza o token do convite, sem exigir conta completa no portal e sem usar uma sessão comum para substituir essa autorização.
- Publicação, geração de links e acesso às respostas mantêm o controle de organização, unidade e perfil existente.
- Histórico de versões, respostas e auditoria preservado; nenhuma incorporação automática em diagnóstico ou anamnese.

## Critérios de aceitação técnica

1. Configurar uma condição baseada em escolha anterior e salvá-la em um modelo válido.
2. Impedir modelo inválido após remover uma pergunta de origem ou uma opção utilizada.
3. Mostrar e ocultar ramos, incluindo dependências encadeadas, com limpeza de respostas ocultas.
4. Calcular etapas e revisão somente sobre perguntas visíveis.
5. Rejeitar respostas manipuladas para campos desconhecidos, escolhas inválidas ou ramos ocultos.
6. Preservar preenchimento visível ao navegar entre etapas, sem gravação parcial ou armazenamento persistente no navegador.
7. Preservar isolamento, autorização, expiração, revogação, versão enviada e resposta única.

Há testes de interface para configuração, condição inválida, limpeza de descendentes, revisão, envio e paginação condicional, além das proteções anteriores de URL, troca de link e StrictMode. A validação local passou em 416 testes unitários/de interface e 364 testes de integração; o teste integrado também confirmou condicionais no celular, limpeza de respostas ocultas, revisão, envio único, replay negado e leitura profissional no mesmo paciente usado para exames, consulta e receita finalizada. A correção do vínculo da central às respostas passou em 12 testes focados de segurança de documentos, incluindo um novo caso. Consulte o checklist para os resultados finais de navegador e bundle. Testes automatizados usam dados fictícios e não representam homologação clínica ou envio real de convite.

## Homologação e limites

A configuração condicional está implementada tecnicamente. Ainda é necessário homologar no Preview um modelo publicado, seu link, o preenchimento em celular, a revisão e o consumo único, seguidos da consulta das respostas pelo profissional. A homologação humana do atendimento completo está registrada separadamente em [Aceitação do Paciente360º](paciente360-acceptance.md).

Esta fase não implementa portal do paciente, monitor de apresentação, pré-anamnese por IA, novos recursos comerciais ou promoção para produção. Preparação de produção, recuperação, permissões oficiais e remoção do operador compartilhado de testes permanecem uma etapa separada.
