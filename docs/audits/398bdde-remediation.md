# Remediação da auditoria consolidada — Paciente360º

Base revisada: `398bdded9ea7b5b738671f819c43cbda6225afe1`, branch `feature/allik-patients`.
Esta é a resposta de implementação à auditoria fornecida pelo responsável pelo produto, não um novo parecer independente ou uma aprovação para produção.

## Regras adotadas

- O Preview continua sintético e isolado. Todos os caminhos de acesso compartilhado exigem classificação sintética, branch/endpoint/usuário permitidos e identidade de banco sem privilégios de proprietário. Produção continua com acesso individual.
- Concluir um atendimento exige evolução FINAL e ausência de conteúdo clínico significativo em rascunhos de receitas, documentos e planos vinculados. Prescrever, solicitar exames ou procedimentos é opcional; as cinco abas não são uma sequência obrigatória. Contêineres vazios não equivalem a conduta pendente.
- Um atendimento COMPLETED bloqueia edições clínicas comuns. Adendos/retificações exigem vínculo explícito, justificativa e auditoria, preservando o original. Retorno/revisão de solicitação são metadados posteriores permitidos ao profissional responsável habilitado, sem alterar o conteúdo final.
- Histórico consolidado inclui unidades autorizadas e identifica sua origem. Consultas contextuais do atendimento usam sua unidade explícita. Transferência de paciente exige acesso à unidade atual e à unidade histórica do documento.
- Registro terapêutico e documento emitido permanecem independentes. A transferência registra origem e versão; uma atualização posterior não modifica automaticamente a receita emitida.
- Nenhuma dose, via ou combinação é sugerida. Frequência/duração não viram recomendação clínica automática; quantidades inconsistentes ou indetermináveis exigem reconciliação explícita/justificativa.

## Disposição dos achados

| Identificadores | Alteração / situação |
|---|---|
| SEC-P0-001 | Vínculo sintético obrigatório em login, cookie, acesso automático e fallback; validação real do usuário restrito no Preview. Achado era condicional, sem incidente demonstrado. |
| CON-P1-001, CON-P1-002, CON-P2-001 | Pré-condições de conclusão verificadas no servidor sob lock do atendimento; resumo diferencia finais, rascunhos, vazios, carregamento e falha. Edições posteriores bloqueadas, com exceções documentais explícitas. |
| CTX-P1-001, PAT-P1-001, DOC-P1-001 | Contexto explícito e política histórica/atual uniforme; histórico autorizado identificado, sem confundir seletor global com unidade do atendimento. |
| ALL-P1-001, UX-P1-001 | Alergia REPORTED qualificada como relatada; data de atualização da nota identificada sem apresentá-la como hora de medição. |
| PAT-P1-002 | Consulta longitudinal dentro do atendimento, preservando o editor em andamento. |
| TIM-P1-001 | Conduta e recomendação de retorno já existiam. Acrescentada data de retorno programado, sem afirmar que os campos anteriores estavam ausentes. |
| DRAFT-P1-001 | Compositor, planos e revisão laboratorial propagam edição/processamento aos guards de saída/unidade e preservam buffers entre painéis. |
| RX-P1-001, RX-P1-002, RX-P1-003 | Defaults clínicos removidos; reconciliação explícita de aplicações; proveniência canônica vinculada à versão terapêutica, preservada no documento. |
| LAB-P1-001, LAB-P1-002 | Upload iniciado como exame exige categoria compatível. Conteúdo duplicado gera conflito; repetição intencional exige justificativa auditada, inclusive sob concorrência. Duplicatas antigas preservadas. |
| DOC-P1-002 | Retificações irmãs novas bloqueadas no servidor e banco; leitura de casos legados seleciona a retificação final vigente. |
| REQ-P1-001 | Plano de procedimentos vinculado ao atendimento exato e à sua unidade, com versões, autorização e imutabilidade do vínculo. |
| REQ-P1-002 | Emissão → retorno → revisão, eventos append-only, operação idempotente e versão otimista. Plano alterado exige nova emissão; documento substituído não pode ser reemitido. Registrar emissão não envia mensagem nem cria venda/estoque. |
| UX-P2-001, UX-P2-002 | Foco e anúncio acessível nas mudanças programáticas; contraste do token auxiliar clínico aumentado, sem redesenhar os mockups. |
| NAV-P2-001, NAV-P2-002 | Estado do modal de documentos preservado; seções/filtro histórico com endereço contextual, mantendo editores montados. |
| DRAFT-P2-001 | Reconciliação de resposta perdida por leitura autorizada, sem repetir gravação nem substituir buffer divergente. |
| DOC-P2-001, DOC-P2-002 | Originais privados verificados por tamanho/hash antes da entrega; abertura/download auditados com identidade da origem. |
| DOC-P2-003, DOC-P2-004 | Prévia FINAL usa snapshot; novos finais arquivam PDF e HTML imutáveis com hashes e versão do renderizador na mesma transação. |
| REQ-P2-001 | Menu respeita a categoria de solicitação selecionada. |
| PRE-P2-001, PRE-P2-002, PRE-P2-003, PRE-P2-004 | Convite recuperável de forma determinística sem token bruto no banco; reemissão revoga anterior transacionalmente; recibo mínimo reconcilia envio; submetido não pode ser revogado; eventos públicos/administrativos auditados sem respostas/tokens. |
| TEST-P2-001 | Orçamento individual de tempo no teste Care custoso, sem aumentar timeout global; resultado integrado registrado abaixo. |
| QP-001 | Decomposição ampla dos componentes continua pendente; foram extraídos contratos/políticas e utilitários pontuais. |
| QP-002 | Consultas dos painéis clínicos inativos/ocultos pausadas, preservando montagem dos editores para proteger rascunhos. Não é desmontagem indiscriminada. |
| QP-003 | Paginação/resumo dos documentos do atendimento permanece pendente; não houve truncamento silencioso como substituto de paginação. |
| QP-004 | Invalidação e identidade de cache escopadas nas frentes alteradas; não se declara eliminada toda invalidação global do sistema. |
| QP-005 | Agregação repetida indexada; decomposição/paginação das coleções operacionais de patient-detail continua pendente para preservar cálculos completos. |
| QP-006 | Lista de pacientes com paginação visível e pesquisa no servidor. |
| QP-007 | Indexação e memoização de tabela/gráfico laboratorial, sem conectar unidades/métodos incompatíveis. |

## Integridade histórica e limites

PDF/HTML arquivados passam a valer para novos finais. Documentos antigos que não tinham bytes arquivados continuam explicitamente identificados como regenerados; não é possível provar retroativamente identidade binária inexistente. Prescrições anexadas antigas sem SHA continuam disponíveis com aviso de integridade não verificada. Não foram inventados hashes nem reescritos documentos finais antigos.

O erro observado pela auditoria em `/pacientes/ana-beatriz` usava uma rota que exige UUID. Esse endereço não prova falha de um paciente válido; identificadores inválidos agora recebem resposta controlada. A homologação usa UUIDs existentes/sintéticos.

Não há medição comparativa de latência, memória ou volume de requests nesta entrega. Os QP estruturais remanescentes requerem profiling e trabalho incremental. Assinatura certificada e liberação oficial não fazem parte deste pacote.

## Banco e ativação

Migrações aditivas: `0072_clinical_document_artifacts`, `0073_preconsultation_events`, `0074_laboratory_document_audit`, `0075_clinical_request_lifecycle`. Histórico aplicado preservado e hashes conferidos antes da ativação.

Alvo exclusivo: projeto Neon `little-dust-61663559`, branch `br-winter-hill-b69uz195` (`preview/feature/allik-patients`), banco `neondb`. `DATABASE_ADMIN_URL` foi conferida no ambiente de manutenção: presente e apontando para o endpoint de Preview, sem exibir seu valor. Nenhuma variável administrativa é entregue à aplicação. Novas tabelas append-only recebem apenas SELECT/INSERT para `allik_runtime`.

Antes da migração: 72 checkpoints; 5 documentos finais; 2 arquivos de paciente; 4 atendimentos. Ponto WAL registrado em `2026-10-19 21:51:17.09358+00`, LSN `0/3F4FE38`; fingerprint dos finais `04854324af21c6b7752428e2d9ca15e8`. Retenção PITR declarada pelo provedor: 21600 segundos. Tentativa de branch de segurança recusada pelo limite de 10 branches; snapshot recusado por se tratar de branch não raiz. Nenhum branch foi excluído. Esse checkpoint não equivale a um backup independente nem a uma restauração remota ensaiada.

A configuração `INVENTORY_SESSION_SECRET` foi verificada por metadados, sem exibir o valor: existe em Preview; não foi configurada em Production. Sua configuração oficial será requisito antes de habilitar convites determinísticos em produção. Nenhuma configuração de produção foi alterada.

## Validação

A ativação transacional no Preview terminou com 76 checkpoints. Permaneceram 5 documentos finais, 2 arquivos e 4 atendimentos; o fingerprint dos finais ficou idêntico. O papel `allik_runtime` foi confirmado com SELECT/INSERT nas novas tabelas append-only, sem UPDATE/DELETE/TRUNCATE, criação de schema ou TEMP; o schema de migrações permanece inacessível ao runtime.

- Integração: 418 testes em 37 arquivos aprovados, banco PostgreSQL 16 descartável.
- Provisionamento/limites do papel restrito: 3/3 aprovados.
- E2E: 17/17 aprovados com Chromium e aplicação servida pelo papel restrito. Inclui o percurso Paciente360º, revisão/validação de exames, questionário público, compositor, emissão documental e regressão de estoque.
- Gate de Preview/journal: 8/8 aprovados.
- Cenário de beta no bundle de produção: migração 0012→atual, autorização individual, congelamento documental e backup/restauração descartável aprovados. Isso não comprova restauração do provedor/produção.
- Typecheck e build aprovados; lint sem erros, com seis avisos Fast Refresh preexistentes.
- Interface/unidade: 483 testes em 75 arquivos aprovados, incluindo resposta perdida após salvar/finalizar e rascunho de procedimentos preservado entre categorias.
- CI remoto de `02b843259619e74708b0e67d7a72fee843afe10c`: [39332896424](https://github.com/atpmktagencia/allik-one/actions/runs/39332896424), aprovado; 485 testes UI/unidade, 418 integrações, 17 E2Es e cenário beta com restauração descartável.
- CI remoto de `82a2772b91867dffa7b670b2735b837559a62307`: [39333871240](https://github.com/atpmktagencia/allik-one/actions/runs/39333871240), aprovado. Esse commit acrescenta somente diagnósticos redigidos, sem relaxar autorização.
- Endurecimento posterior do banco: 6/6 testes de integração do guard e 3/3 de provisionamento aprovados em banco descartável. O guard protege toda a branch clínica de Preview, mesmo se a URL inválida para compartilhamento desabilitar esse acesso.

Os dois E2Es de questionários foram adaptados ao novo recibo mínimo: reabertura mantém READ bloqueado, STATUS contém apenas submitted=true, sem formulário nem respostas anteriores. O teste Care custoso recebeu orçamento individual explícito; falhas por novos hooks de guard nos testes foram corrigidas selecionando o bloqueio do pai, sem retirar a proteção da aplicação.

Testes de escrita, concorrência e navegadores usam apenas bancos descartáveis com dados sintéticos. E-mail, WhatsApp e IA remotos não são acionados por esses testes. No Preview remoto, além de DDL e grants explícitos, a homologação usa leituras autenticadas; não emite novos documentos clínicos.


## Gate remoto ainda bloqueado — não homologado

O código foi publicado na branch solicitada. O deployment `allik-orogfjjqx-atp-mkt.vercel.app` (`82a2772`, READY no provedor) respondeu 401 ao GET de sessão do operador compartilhado. READY atesta implantação, não homologação funcional.

A evidência de runtime, sem valores de credenciais, é:

```text
SHARED_PREVIEW_ACCESS_DENIED PREVIEW_BOUNDARY_RUNTIME_USER
expectedRoleIsAllikRuntime: true
urlUserIsAllikRuntime: false
pgUserIsAllikRuntime: false
```

A conexão canônica existente de `allik_runtime` foi obtida pelo conector Neon, validada contra o endpoint/banco autorizados e testada com SELECT a partir de sandbox Vercel: autentica corretamente como papel restrito em `neondb`. Nenhuma senha foi exibida, redefinida ou armazenada no repositório.

Os 13 overrides existentes de conexão/aliases foram atualizados por upsert, exclusivamente para Preview + `feature/allik-patients`; a API confirmou 13 alterações e zero falhas. Deployments novos por Git, com e sem SHA explícito e tanto com target padrão de Preview quanto com o target legado staging, ainda entregaram identidade efetiva divergente. A hipótese é uma substituição da configuração na integração/provisionamento do deployment; a origem exata ainda não foi demonstrada. Não se afirma que ocorreu acesso indevido ou exposição de dados.

As ferramentas disponíveis permitem ler a configuração da integração Neon, mas não editar sua vinculação/provisionamento ao projeto. Não foi desconectada a integração, excluído qualquer ambiente/branch, alterada configuração de Production ou substituída a credencial global de Preview, pois isso atingiria ambientes fora da branch autorizada.

Para desbloquear, o responsável pela configuração precisa verificar a conexão Neon do projeto `allik-one` na Vercel e impedir que a identidade entregue **a esta branch de Preview** substitua os overrides de `allik_runtime`. Se for necessário ajustar a integração, limitar a mudança ao Preview; não desconectar o recurso do projeto inteiro e não alterar Production. Depois, criar um novo deployment do candidato e verificar:

1. Sessão automática sintética retorna 200 com `sharedPreviewOperator=true`.
2. A identidade real de banco passa pelo guard de privilégios, sem credenciais administrativas/aliases de outro usuário.
3. Paciente com UUID válido, atendimento, aba Exames e acompanhamento de solicitações respondem 200.
4. Os documentos finais/checkpoints permanecem íntegros e o alias de produção segue no deployment anterior.

Até essa verificação, a ativação funcional do candidato permanece bloqueada. Não há aprovação para produção e não foi realizado teste de digitação, salvamento ou conclusão contra os registros remotos.
