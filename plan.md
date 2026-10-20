# Teste B — Allik One UX 2.0

Base congelada: `75c416e819afb557f07c8d2ab19d568ddeefe0c8`, de `feature/allik-patients`. Branch experimental: `experiment/test-b-atendimento-exames`. A cópia da auditoria anterior não será modificada. O nome da branch destaca a prioridade Exames, mas a implementação segue o briefing UX 2.0: shell, Anamnese, Exames, Prescrição, Solicitações, Revisão e Prontuário, com entregas e limitações individualizadas.

A referência oficial é a Anamnese ampliada enviada pelo usuário. Preservar branco/cinza frio, teal, Inter, cards discretos, bordas suaves, sidebar longitudinal, cabeçalho clínico e navegação numerada. O painel de documentos e o mosaico complementam o contexto, sem impor colunas estreitas às tarefas que precisam de largura. Não redesenhar a Anamnese, criar um segundo design system, inventar dados clínicos ou funcionalidades decorativas.

## Implementação e estrutura

Reutilizar os componentes em `src/components/clinic`, tokens de `clinical-workspace.css`, contratos em `src/data`, os parsers e comparabilidade em `src/lib` e endpoints em `src/server`. Manter arquivos/testes existentes e extrair componentes pequenos quando a nova responsabilidade justificar. Nenhum endpoint de IA, assinatura, comunicação, autenticação ou cálculo clínico será reconstruído.

1. Shell/Anamnese/Revisão: consistência de dimensões e navegação longitudinal sem rotas removidas; retirar somente os formulários redundantes da interface, preservando dados carregados e envio de campos históricos; manter editor, modelo, hipóteses, plano, retorno, guards e operações clínicas separadas.
2. Exames: tabela longitudinal como conteúdo principal, filtros compactos, grupos expandíveis, detalhes/gráfico/PDF sob demanda e arquivos em progressive disclosure. Manter pipeline upload/conferência/validação e guard de revisão em andamento. Preservar dados literais e fronteiras de comparabilidade.
3. Prescrição/Solicitações: compositor disponível diretamente sem exigir criação documental anterior; reutilizar criação/associação de draft com proteção contra duplicação e proveniência; biblioteca/composição/prévia com espaço adequado. Para solicitações, ação direta segura de descarte de rascunho apenas se houver contrato auditável, jamais excluir finais. Mudanças server mínimas devem manter autorização, versão e lock.
4. Prontuário: reutilizar cabeçalho/tokens e navegação, organizar visão geral e histórico sem duplicar serviços ou remover recursos.

## Limites de execução

A implementação será feita somente nesta cópia/branch, usando GitHub nativo. Não mudar `main`, `feature/allik-patients`, configuração Vercel/Neon/Lovable, aliases, conexões ou produção. Um push na branch experimental pode acionar automações já existentes do repositório; não solicitar deploy nem homologação remota como efeito dessa implementação. Verificar automações antes do push. Nenhuma credencial ou `.env` remoto será copiado. Testes de escrita somente em banco descartável local com fixtures sintéticas; mocks de teste não são resultados clínicos fabricados na aplicação. Se a infraestrutura local não permitir integração, registrar não executado.

Entregar branch/commit, relatório com alterações, componentes reutilizados, interações antes/depois, verificações efetivas, screenshots sintéticos a 1536×1024 e 390×844 e limitações. Não declarar pixel-perfect, zero regressão, persistência real ou aprovação de produção sem evidência correspondente.
