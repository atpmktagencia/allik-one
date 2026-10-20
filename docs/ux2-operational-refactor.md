# UX 2.0 — Atendimento e Paciente360º

## Estado inicial auditado

Base: `75c416e819afb557f07c8d2ab19d568ddeefe0c8`, branch `feature/allik-patients`.

Atendimento já reutiliza `ClinicalPatientHeader`, tokens de `clinical-workspace.css`, documentos versionados, composição farmacêutica validada no servidor, histórico laboratorial confirmado e proteção de alterações locais. Prontuário usa o mesmo header e AppShell, mas difere no espaçamento e na navegação. As cinco abas permanecem montadas para preservar rascunhos.

Lacunas verificadas: formulários estruturados redundantes na Anamnese; quatro atalhos laterais repetem as abas; largura da barra de etapas varia com o painel contextual; Exames exibe arquivos acima da tabela e reserva PDF vazio; compositor depende de documento e modal; solicitações não oferecem descarte direto de rascunho; Histórico sai do workspace.

## Alterações propostas antes da implementação

- Reutilizar header/tokens e consolidar o frame da navegação; barra de etapas estável, editores mantidos montados.
- Ocultar os dois formulários redundantes, mantendo campos, endpoints e conteúdo histórico; editor, hipóteses, plano, conduta e retorno preservados.
- Priorizar tabela de exames; arquivos, gráficos e PDF sob demanda, sem modificar extração ou referências clínicas.
- Montar compositor diretamente na Prescrição; resolver/criar documento de forma idempotente apenas na inserção explícita. Não criar registros por visitar abas.
- Permitir descarte lógico e auditado de rascunhos próprios, com versão, permissão e trava do atendimento. Documentos finais permanecem imutáveis. Uma coluna aditiva de descarte é necessária para remover o rascunho da lista sem apagar registro ou histórico.
- Integrar Histórico ao Prontuário sem remover a rota existente.

## Comparação de interações

| Fluxo                                  | Antes (caminho auditado)                                             | Depois                                           |
| -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| Abrir compositor sem receita existente | Prescrição → categoria → Novo documento → Receita → Abrir compositor | Prescrição                                       |
| Consultar tabela laboratorial          | Exames, com arquivos e painel vazio antes/ao lado                    | Exames, tabela em destaque                       |
| Abrir/fechar PDF                       | Selecionar arquivo / recolher painel que permanece reservado         | PDF sob demanda / fechar e recuperar largura     |
| Criar solicitação laboratorial         | Solicitações → Novo documento → Exames                               | Solicitações → Adicionar solicitação             |
| Excluir solicitação rascunho           | Não disponível                                                       | Excluir → confirmar                              |
| Histórico no paciente                  | Outra rota                                                           | Seção contextual, mantendo demais áreas montadas |

Contagem por ações de navegação, sem digitação clínica nem confirmações: abrir compositor caiu de 5 para 1 clique; iniciar solicitação laboratorial de 3 para 2; exames e histórico permanecem a 1 clique. Carregar protocolo e preencher medicamento mantêm as escolhas clínicas explícitas. Excluir rascunho é uma nova operação de 2 ações (excluir e confirmar). A consulta histórica durante evolução abre em painel sem desmontar o editor; fechar devolve o contexto com 1 ação.

## Critérios de segurança

Nenhuma dose, via, resultado ou referência inventados. Criação de receita não finaliza nem assina. Descarte não apaga documentos e não afeta finais. Validação de versões e restrição de autoria permanecem no servidor. Testes com escrita somente em PostgreSQL descartável ou Preview sintético confirmado. Produção fora do escopo.

## Validação e evidências

### Implementação

Reutilizados: AppShell, ClinicalPatientHeader, ClinicalNoteEditor, LaboratoryHistory, LaboratoryReview, PrivateDocumentPreview, PrescriptionComposer, EncounterDocumentsCard, PatientDocumentCenter, PatientTimelinePage e guardas de navegação existentes. Adicionado somente o frame compartilhado ClinicalNavigation; nenhuma biblioteca nova.

Exames passam a ter grupos visuais recolhíveis, pesquisa, ordenação temporal e detalhes de resultado confirmado. Unidade, método e material continuam segmentando séries incompatíveis. Agrupamento por nome é apenas organização visual; não define diagnóstico, referência ou compatibilidade. PDF abre lateralmente somente após seleção; fechar recupera a largura.

Prescrição abre diretamente no compositor e conserva os editores documentais e o registro terapêutico anterior em “Receitas e histórico”. A primeira inserção explícita resolve um rascunho próprio ou cria um com identificador idempotente. Visitar abas não cria documento. Inserção, salvamento, finalização, assinatura e conclusão continuam operações distintas.

Solicitações oferecem adicionar, editar, duplicar e excluir rascunho próprio, com confirmação, versão e trava transacional. Exclusão é um descarte lógico imutável: não há desfazer nem exclusão física. Retificações e documentos finais seguem os fluxos anteriores. Rascunhos descartados deixam de impedir conclusão do atendimento.

Histórico integra-se como seção do Paciente360º, com carregamento sob demanda e filtros incluindo exames validados e questionários respondidos. Estes aparecem identificados como declaração do paciente, sem reproduzir respostas, tokens ou diagnósticos presumidos. Eventos de agenda têm indicação visual própria. Rotas históricas continuam disponíveis.

### Migração e ambientes

A migração 0076 é aditiva e necessária para o descarte auditado. Aplicada somente no projeto Neon de Preview `little-dust-61663559`, branch `br-winter-hill-b69uz195`, depois de conferir os 76 hashes anteriores. Agora são 77 migrações. Os cinco snapshots documentais finais permaneceram idênticos: fingerprint `04854324af21c6b7752428e2d9ca15e8` antes/depois. Nenhum paciente, usuário, receita ou questionário criado remotamente para esta entrega. Uma consulta sintética foi criada pela API, com auditoria e regras de agenda, para o operador de Preview no paciente sintético existente: `de5f6c7a-2402-450c-b0e6-68ab34a70699`. O atendimento anterior pertence a outro profissional; sua autoria e conteúdo foram preservados. A consulta nova permanece agendada, sem evolução ou documento clínico criado.

A integração Neon deve manter desativada “Create Database Branch For Deployment → Preview”: a injeção de credenciais owner por implantação substituía a conexão restrita configurada no projeto. Não se altera o banco nem a integração de Production.

### Testes e limitações

- Typecheck e build: aprovados.
- Lint: zero erros; seis avisos anteriores de Fast Refresh.
- Unitários/interface: 500 testes aprovados em 76 arquivos.
- Integração PostgreSQL: 424 testes aprovados em 37 arquivos, incluindo descarte idempotente, concorrência com finalização, isolamento e histórico laboratorial/questionários.
- Provisionamento de papel restrito: 3/3; guardas de build/migrações: 8/8.
- E2E completo com usuário restrito: 17/17 aprovados.
- Após ajustes visuais adicionais em Exames/Documentos: 16 testes de interface e 2 E2E dos fluxos afetados aprovados; teste de fechar prévia e preservar filtro: 7/7.
- Cenário beta no bundle de produção, com autenticação individual, migração 0012→0076 e backup/restauração descartáveis: aprovado. Isso não comprova restauração de produção.
- Candidato inicial: `c78329c77586eec6a260557f4a2670f657bab717`; ajuste final de espaço: `ab86cfd85329c43447c0c634406d65560a9f50bb`.
- Preview final: deployment `dpl_8R5NB4q3ur3grvcNPz8VMiGuJPsT`, `allik-ga6cmtzwj-atp-mkt.vercel.app`, alias fixo abaixo. Produção continua em `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`.

Nas reproduções iniciais, o navegador Chromium esperado pelo Playwright não estava instalado; a execução passou a usar `/usr/bin/chromium`. Os cenários antigos foram adaptados para abrir arquivos recolhidos e acessar o editor documental secundário. Uma duplicação de “Voltar às solicitações” foi encontrada pelo E2E e corrigida na aplicação.

- Escritas de testes automatizados são feitas em PostgreSQL 16 descartável, com conta restrita no navegador. Não representam ensaios em produção.
- Trocar abas mantém os componentes e buffers locais montados. Recarregamento recupera os rascunhos explicitamente salvos; alterações locais ainda não persistidas usam aviso de saída. Não se promete recuperação após fechamento forçado/crash do navegador, nem se introduziu cópia de dados clínicos no localStorage.
- Erro de rede e conflito de versão mantêm conteúdo local e exigem correção explícita. Não há sobrescrita silenciosa automática.
- Não foi possível confirmar o status remoto do GitHub Actions nesta sessão; o CLI respondeu 403 e o conector disponível consulta somente execuções de pull request. Os resultados declarados são dos comandos efetivamente executados e do build READY na Vercel.
- Não se executou nova chamada paga de IA, envio de mensagens ou auditoria externa. O pipeline existente foi preservado e ensaiado com extração sintética no banco descartável.
- Validação visual usa os dados existentes e sintéticos, portanto nomes, conteúdo e contagens diferem dos mockups. Não foram adicionados valores clínicos para preencher espaços.
- Concluir atendimento continua sujeito às validações existentes; descartar documento não finaliza evolução, assina receita, cria venda ou consome estoque.

## Preview e evidências visuais

[Preview fixo — pacientes](https://allik-one-git-feature-allik-patients-atp-mkt.vercel.app/pacientes) · [Consulta sintética do operador](https://allik-one-git-feature-allik-patients-atp-mkt.vercel.app/atendimentos/de5f6c7a-2402-450c-b0e6-68ab34a70699).

Resolução de referência: 1536 × 1024. Nas oito telas, header global de 54 px, sidebar de 206 px e ausência de overflow horizontal. Barra das cinco etapas fixa em x=238, y=244, largura=1278 e altura=44 nas cinco abas. Nenhum POST clínico emitido pela navegação; zero erros de JavaScript. O PDF original foi aberto e fechado: tabela com 1228 px, 758 px com o painel aberto e 1228 px após fechar. Prévia privada em URL blob e detalhes do resultado confirmados no Preview.

Comparação com os mockups: preservados fundo claro, bordas discretas, teal, cabeçalho clínico horizontal e editor central com contexto lateral. Exames ocupa a largura sem PDF vazio; filtros foram compactados após a primeira captura. Documentos também passou a abrir a prévia sob demanda e recuperar largura ao fechar. Prescrição utiliza intencionalmente três colunas para biblioteca, composição e prévia; formulário documental anterior fica secundário. Avatar por iniciais quando não há foto. Sinais vitais, diagnósticos, categorias e estados exibem somente os dados existentes; uma consulta agendada apresenta ações de início e não simula conclusão.

| Tela                       | Screenshot no Preview                                     |
| -------------------------- | --------------------------------------------------------- |
| Anamnese                   | [Abrir captura](ux2-evidence/01-anamnese.jpg)             |
| Exames                     | [Abrir captura](ux2-evidence/02-exames.jpg)               |
| Prescrição                 | [Abrir captura](ux2-evidence/03-prescricao.jpg)           |
| Solicitações               | [Abrir captura](ux2-evidence/04-solicitacoes.jpg)         |
| Revisão                    | [Abrir captura](ux2-evidence/05-revisao.jpg)              |
| Paciente360º — Visão geral | [Abrir captura](ux2-evidence/06-paciente-visao-geral.jpg) |
| Documentos                 | [Abrir captura](ux2-evidence/07-documentos.jpg)           |
| Histórico                  | [Abrir captura](ux2-evidence/08-historico.jpg)            |

Não se declara equivalência pixel a pixel: o mockup contém dados, fotos, estados e recursos que não se substituem por exemplos fictícios. A implementação preserva operações clínicas reais e a distinção entre orçamento, receita, venda, assinatura e execução.
