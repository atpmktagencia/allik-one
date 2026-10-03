# Clinic OS — primeira prévia visual

## Objetivo
Transformar a tela inicial vazia em um protótipo clínico navegável, exclusivamente frontend, com dados locais explicitamente fictícios e sem integrações, autenticação ou persistência.

## O que será construído
- Estrutura principal com navegação lateral compacta no desktop, menu móvel, cabeçalho, busca global de pacientes, notificações e ação “Novo”.
- Visão geral com indicadores, agenda do dia, resumo financeiro, pacientes recentes, Patient 360 e atalhos operacionais.
- Páginas próprias para Agenda, Pacientes, Prontuário, Vendas, Estoque e Financeiro, cada uma com conteúdo representativo, filtros ou abas pertinentes e aviso discreto de prévia visual.
- Páginas de CRM, Exames e Configurações para que toda a navegação funcione, também como prévias coerentes.
- Tela detalhada Patient 360 com identidade fictícia, consulta, linha do tempo, plano, aplicações, exames, financeiro e acompanhamento, separando claramente informações clínicas e administrativas.
- Busca global funcional por nome, CPF ou telefone, abrindo o Patient 360 do paciente escolhido.
- Layout responsivo e acessível em português do Brasil, com valores em BRL e datas brasileiras.

## Componentes e dados
- Criar um shell reutilizável do Clinic OS para navegação, cabeçalho e conteúdo.
- Criar componentes compartilhados para títulos, indicadores, estados, tabelas/listas e aviso de protótipo.
- Manter todos os dados demonstrativos em uma camada local separada, preparada para futura troca por chamadas a `/api/v1/`.
- Usar os componentes shadcn/ui existentes e ícones Lucide, sem dependências novas desnecessárias.

## Direção visual
- Produto SaaS clínico premium: superfícies claras, fundo cinza muito leve, estrutura azul-marinho/grafite e status discretos.
- Hierarquia tipográfica limpa, bordas suaves, sombras mínimas e bom espaço em branco.
- Evitar gráficos em excesso e padrões genéricos de dashboard.

## Rotas previstas
- `/` — Visão geral
- `/agenda`
- `/pacientes`
- `/pacientes/$patientId` — Patient 360
- `/prontuario`
- `/vendas`
- `/estoque`
- `/financeiro`
- `/crm`
- `/exames`
- `/configuracoes`

## Validação
- Preservar e ampliar os testes básicos de roteamento para validar a home e a rota Patient 360.
- Verificar a compilação, os testes e a navegação real em desktop e mobile.
- Conferir metadados próprios em cada página e ausência de links quebrados.

## Premissas
- Todos os nomes, documentos, telefones, eventos e valores exibidos serão marcados no código como demonstração e não representam pessoas reais.
- A ação “Novo”, filtros e abas serão interações visuais locais; nada será salvo.
