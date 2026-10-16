# Estoque Allik Fortaleza

Aplicação em React/TanStack Start, sincronizada com Lovable. As cinco etapas do inventário persistem no PostgreSQL: consulta de estoque, compras e recebimentos, transferências e contagens, aplicações e rastreabilidade de lotes.

## Desenvolvimento

Use Node 22+ e Bun 1.3.14. Instale com `bun install --frozen-lockfile`.

Copie `.env.example` para `.env.local` e configure uma instância PostgreSQL **sintética e isolada** em `DATABASE_URL`. Defina `INVENTORY_ENVIRONMENT=development`, uma senha de Preview com pelo menos 12 caracteres e `INVENTORY_SESSION_SECRET` aleatória com pelo menos 32 caracteres. Não use prefixo `VITE_` para nenhum segredo.

```sh
bun run db:migrate
INVENTORY_ALLOW_SEED=true bun run db:seed
bun run dev
```

Abra `/estoque/acesso`, entre com a senha configurada e consulte `/estoque`. O seed é idempotente: rodar de novo não duplica movimentações. Seeds são proibidos com ambiente de produção.

## Codex Cloud

Selecione a branch `feature/allik-inventory-milestone-1` para continuar o estoque persistido; a `main` ainda contém o protótipo. No ambiente do Codex, use Node 22+ e configure o comando de setup:

```sh
npm run cloud:setup
```

O setup instala Bun 1.3.14 via npm e as dependências do lockfile, usando cache temporário gravável. Requer acesso de rede ao registry npm. Não aplica migrations nem seeds.

Configure `DATABASE_URL` de um PostgreSQL sintético exclusivo de desenvolvimento, `INVENTORY_ENVIRONMENT=development`, `INVENTORY_PREVIEW_PASSWORD` (12+ caracteres) e `INVENTORY_SESSION_SECRET` (32+ caracteres) nas variáveis/segredos do ambiente. As variáveis da Vercel não são transferidas automaticamente. Não coloque credenciais em prompts ou commits. Os segredos precisam estar disponíveis também durante a execução da tarefa, não apenas durante o setup.

```sh
npm run cloud:check
```

A conferência só consulta a conexão e a presença da tabela de produtos, sem alterar dados ou exibir credenciais. Se o banco sintético estiver vazio, execute os comandos de migration e seed da seção Desenvolvimento antes de conferir novamente.

O erro `workspace routing discovery unauthorized (401)` ocorre na conexão com o workspace do Codex e precisa ser resolvido na autorização/sessão desse serviço. Não deve ser confundido com o HTTP 401 da API de estoque, que exige uma sessão de Preview.

Os testes de proteção do Preview criam processos filhos. Se o sandbox retornar `spawnSync ... EPERM`, execute-os com as permissões que permitam processos filhos; não desative as proteções do banco para contornar esse bloqueio.

## Verificações

```sh
bun run lint
bun run build
bun run typecheck
bun run test
DATABASE_URL=<conexao-do-banco-isolado-com-nome-terminado-em-_test> bun run test:integration
```

Para E2E, use um servidor local com migrations/seed e sessão configurados, instale o Chromium de testes (`bunx playwright install chromium`) e execute `bun run test:e2e`. Informe `PLAYWRIGHT_BASE_URL` se o servidor não estiver em `http://127.0.0.1:4317`. O teste usa `INVENTORY_PREVIEW_PASSWORD` do ambiente. Nunca use uma conexão de produção nos testes.

## API e dados

GET `/api/v1/inventory/products`, `/products/:id`, `/locations`, `/lots`, `/stock` e `/movements`. Os filtros usam `productId`, `locationId`, `unitId` e `search`. As rotas HTTP e o driver do banco ficam no servidor; as telas usam TanStack Query. Preview exige sessão assinada de demonstração; Pilot exige identidade individual e autorização por unidade no servidor.

Product, Location, Lot e StockMovement persistem no PostgreSQL. StockBalance é uma projeção do ledger, atualizada por trigger na mesma transação. UPDATE/DELETE de movimentações e auditoria são rejeitados; alteração direta de saldo também é rejeitada. A constraint de saldo não negativo protege concorrência. Aplicações diretas de demonstração registram consumo transacional no Milestone 4.

### Compras e recebimento — Milestone 2

`/estoque/recebimento` carrega produtos e locais da API. O formulário envia fornecedor, referência da compra e até 50 itens para POST `/api/v1/inventory/receipts`. Cada item exige produto, lote, validade, quantidade positiva e custo não negativo. Lotes vencidos e produtos/locais inativos são rejeitados. Um lote existente só pode ser reutilizado com os mesmos dados e status disponível.

A migration `0001_lush_mandroid.sql` adiciona o registro de recebimentos. O servidor grava recebimento, lotes e movimentos de entrada em uma transação; os triggers existentes atualizam saldo e auditoria. A UUID do envio e o hash do conteúdo garantem repetição sem duplicação, inclusive em solicitações concorrentes. Reutilizar a mesma chave com outro conteúdo retorna 409. Falhas ambíguas na interface preservam os dados e a chave para nova tentativa enquanto o formulário permanece aberto.

A migration `0002_aromatic_lady_ursula.sql` adiciona fornecedores, pedidos, itens previstos e o vínculo entre item recebido e movimento. Na mesma tela, cadastre um fornecedor, crie um pedido e selecione-o para registrar uma entrega. GET/POST `/api/v1/inventory/suppliers` e `/purchases` exigem a sessão do Preview; gravações exigem a mesma origem. Pedidos não alteram estoque até o recebimento. Referências de pedido e nomes de fornecedores são únicos; a criação aceita repetição idempotente pelo mesmo UUID.

Informe somente a quantidade entregue na remessa. O pedido passa de Aberto a Parcial e depois Recebido conforme seus itens. O recebimento trava o pedido, confere produto e custo previsto e impede ultrapassar o pendente, inclusive em entregas concorrentes. Contadores do pedido, vínculos, movimentos, saldo e auditoria são gravados na mesma transação. Entradas sem pedido continuam disponíveis por referência. Edição/cancelamento de pedidos e alterações de custo após a compra não fazem parte desta etapa.

Os testes de integração cobrem repetição concorrente, rollback, entregas concorrentes, estados do pedido e criação idempotente. O Milestone 2 só deve ser aceito no Preview após aplicar as migrations e validar esse fluxo na Vercel.

### Transferências e contagens — Milestone 3

Em `/estoque/movimentacoes`, transfira um lote entre locais ativos ou ajuste uma posição pela quantidade física encontrada. As operações exigem referência e motivo de pelo menos 10 caracteres. O histórico mostra origem/destino, diferença de saldo e motivo; permite filtrar por local, tipo ou texto.

POST `/api/v1/inventory/transfers` recebe `operationId`, `lotId`, `sourceId`, `destinationId`, `quantity`, `reference` e `reason`. A quantidade é positiva, com até três casas decimais; origem e destino devem ser diferentes. Lotes vencidos, bloqueados ou em quarentena não podem ser transferidos. Dois movimentos do mesmo lote (saída na origem e entrada no destino), vínculos, saldos e auditoria são gravados na mesma transação. Qualquer falha desfaz ambos; a quantidade total do lote é preservada.

POST `/api/v1/inventory/adjustments` recebe `operationId`, `lotId`, `locationId`, `expectedQuantity`, `countedQuantity`, `reference` e `reason`. As quantidades são decimais não negativas com até três casas. O formulário guarda o saldo consultado ao selecionar a posição. Se outra movimentação mudar esse saldo antes da confirmação, o servidor retorna 409 e exige nova consulta, sem sobrescrever a movimentação. Contagens iguais ao saldo não geram ajuste. Uma contagem pode zerar o saldo ou conferir lotes indisponíveis, mantendo o status e a validade originais.

A migration `0003_spooky_genesis.sql` registra as operações e seus movimentos com histórico imutável. As rotas exigem sessão do Preview e mesma origem; o responsável é definido pelo servidor. O UUID e o hash do conteúdo permitem repetir um envio idêntico sem duplicar movimentos. Os saldos são travados em ordem consistente para transferências simultâneas em sentidos opostos; diferenças de contagem são calculadas com `numeric` no PostgreSQL. Após uma resposta perdida, o formulário conserva o envio original para reenvio enquanto permanece aberto.

Os testes cobrem preservação do total, repetição e concorrência, rollback após falha no destino, contagem zero, conflito de saldo consultado e imutabilidade. O teste de navegador confirma transferência, contagem, filtros e persistência após recarregar. O aceite no Preview depende da aplicação da migration e da validação na Vercel com PostgreSQL.

### Aplicações diretas e FEFO — Milestone 4

`/aplicacoes/nova` registra uma aplicação direta sintética com referência única, serviço, executor e local de consumo. Selecione um ou mais produtos e confira os lotes físicos utilizados. O formulário sugere, por produto e local, o lote disponível com vencimento mais próximo (FEFO); permite escolher outro lote disponível ou dividir o consumo em linhas de lotes distintos. Lotes bloqueados, vencidos, vazios e produtos inativos não são sugeridos. A recomendação trata o estoque disponível e não determina procedimentos ou quantidades clínicas.

GET/POST `/api/v1/inventory/applications` exige sessão do Preview; POST exige a mesma origem. O envio contém `operationId`, `patientRef`, `reference`, `service`, `professional`, `locationId` e até 20 `items` com `productId`, `lotId` e `quantity` positiva, com até três casas decimais. Não repita o mesmo lote em várias linhas. O servidor confere novamente produto, validade na data de Fortaleza, status do lote, local ativo e saldo. Um lote válido até hoje pode ser consumido. O horário é o da confirmação no servidor.

A migration `0004_keen_argent.sql` adiciona aplicações e vínculos imutáveis com as saídas do ledger. Todos os saldos consumidos são travados em ordem consistente, mesmo quando itens chegam em ordem diferente. Aplicação, movimentos `OUT`, saldos e auditoria são confirmados na mesma transação; um item inválido ou uma falha posterior desfaz tudo. UUID e hash permitem repetir um envio idêntico sem duplicar a baixa. A referência única também impede recriar a mesma aplicação com outra UUID. Falhas ambíguas preservam o envio original na interface enquanto o formulário permanece aberto.

`/aplicacoes` consulta o histórico persistido e permite buscar referência, paciente sintético, serviço, executor, produto ou lote. `/estoque/movimentacoes` mostra as saídas com a referência da aplicação; a API de movimentos inclui `applicationId` para rastreabilidade. O responsável pela movimentação é o operador autenticado do Preview; o executor declarado no formulário é um campo separado.

Somente os códigos `demo-patient-a`, `demo-patient-b` e `demo-patient-c` são aceitos. Seus rótulos ficam na fronteira local `mock-clinic.ts`; nenhum prontuário, CPF ou cadastro de paciente é gravado no inventário. O fluxo desta etapa é de aplicação direta; não consome pacotes/entitlements e não cria cobrança ou compensação. O modo compartilhado continua proibido em produção.

Os testes verificam FEFO, reenvio após resposta perdida, concorrência com itens em ordem inversa, validade no dia, indisponibilidade, referência duplicada e rollback após falha no segundo movimento. O navegador verifica recebimento de dois lotes → recomendação FEFO → aplicação de dois produtos → saldo → histórico → recarga. O aceite no Preview depende da migration e da validação desse fluxo na Vercel.

### Rastreabilidade do lote — Milestone 5

Abra o lote na tabela de produto ou selecione “Rastrear lote” em uma aplicação. `/estoque/lotes/:lotId` mostra produto, fornecedor, validade, situação, saldo físico por local e o caminho do lote, da movimentação mais recente à mais antiga. Cada evento exibe quantidade, local, referência, motivo, responsável e seus registros de auditoria. Recebimentos incluem pedido/fornecedor quando vinculados; transferências mostram os dois locais; aplicações mostram a referência, paciente sintético, serviço e executor. Entradas iniciais ou sem recebimento vinculado são identificadas como tais.

GET `/api/v1/inventory/trace/lots/:lotId` exige sessão do Preview e retorna `lot`, `summary`, `balances`, `events` e `nextCursor`. O resumo separa entradas, consumo por aplicações e ajustes, mantendo quantidades decimais como texto. A conferência compara cada saldo com a soma de seus movimentos, inclusive em locais inativos e posições zeradas. A quantidade de movimentos com auditoria também é conferida. Lotes vencidos e produtos inativos continuam consultáveis para inspeção histórica.

A consulta usa uma transação de leitura `REPEATABLE READ`: dados do lote, saldos, resumo e auditoria de cada página vêm do mesmo estado do banco. Cada página contém até 50 movimentos; envie `?cursor=<nextCursor>` para continuar. O cursor preserva microssegundos e desempata pelo UUID, evitando omissões quando vários movimentos têm o mesmo horário. A interface mantém as páginas carregadas se uma página posterior falhar e permite tentar novamente. Páginas sucessivas são consultas independentes; selecione “Atualizar rastreabilidade” para consultar novas movimentações.

A migration `0005_colorful_susan_delgado.sql` adiciona vínculos imutáveis entre **todos** os recebimentos e seus movimentos, incluindo entradas sem pedido. Recebimentos anteriores são vinculados pela UUID na chave de operação, sem depender da referência textual, que pode se repetir. Entradas do seed e saídas não recebem vínculos artificiais. Novos vínculos são gravados na mesma transação do recebimento; esta etapa não reescreve movimentos, auditoria ou saldos existentes.

Os testes exercitam o preenchimento de vínculos antigos, referências repetidas, UUID com letras maiúsculas, paginação de movimentos com o mesmo horário e histórico de lote vencido/zerado. O teste de navegador percorre fornecedor → pedido → duas entregas parciais → transferência → aplicação → contagem → rastreabilidade → recarga, conferindo recebimentos, pedido, paciente sintético, saldo e auditoria. Esse fluxo foi validado no Preview autorizado da Vercel com Neon em 4 de outubro de 2026, no commit `6647408`; os saldos persistiram após recarregar e as seis movimentações tinham auditoria. A evidência de aceite está no [PR #3](https://github.com/atpmktagencia/oi-companion/pull/3).

### Cadastros de produtos e locais

`/estoque/cadastros` lista registros ativos/inativos, inclusive produtos sem saldo. Cadastre nome, SKU, unidade, categoria e mínimo de reposição. Edições exigem motivo e versão consultada; SKU e unidade permanecem definidos na criação. Produtos com saldo físico (inclusive bloqueado/vencido) ou entregas pendentes não podem ser desativados; locais com saldo também não. Nome, mínimo e categoria podem mudar sem reescrever lotes ou movimentos.

GET/POST `/api/v1/inventory/catalog/products` e `/catalog/locations`, e GET `/catalog/history?resource=PRODUCT|LOCATION&itemId=<uuid>` exigem sessão. A migration `0006_inventory_catalog.sql` adiciona versões, unicidade sem distinção de maiúsculas e auditoria imutável antes/depois. Cada envio usa UUID/hash; atualizações concorrentes retornam conflito e reenvios idênticos preservam o resultado original. O seed não recria locais renomeados nem redefine metadados editados.

### Fornecedores, catálogos e pedidos comerciais

`/estoque/fornecedores` permite cadastrar/editar fornecedores, contato WhatsApp/e-mail e apresentações de catálogo com código interno, SKU oficial opcional, embalagem, conteúdo, boxes por apresentação, preço e fonte da cotação. Edições exigem versão/motivo e ficam no histórico. A migration `0007_supplier_catalog.sql` usa o mesmo PostgreSQL; não cria outro banco externo.

O arquivo `Cadastro_Essentia_Produtos_Protocolos.md` fornecido pelo usuário foi convertido em `src/server/vendor-catalog/essentia.json`: **178 produtos, 121 kits/protocolos comerciais e 89 adicionais (388 itens)**. Os sete preços com alternativas ambíguas permanecem nulos e bloqueados para seleção até confirmação. Códigos ESS são identificadores internos; o arquivo não fornece SKUs oficiais. Concentração, composição, apresentação, conteúdo, página, fonte/edição e hash do arquivo são preservados como dados do catálogo. As instruções clínicas do documento não executam fluxos nem definem aplicações.

A Essentia usa o contato informado pelo usuário `+55 48 8802-9876`, preservando exatamente os dígitos. `scripts/import-essentia.ts` exige autorização explícita e ambiente isolado development/preview/test; recusa produção e não sobrescreve preços ou contatos já editados. Os preços correspondem à edição **04.2026** (arquivo indicado como Maio/2026), portanto são estimativas históricas sujeitas à confirmação.

Selecione até 50 itens por checkbox, indique quantidade inteira de apresentações e revise o pedido. Cada preço é por apresentação completa: nos itens ESS-P037/ESS-P092, uma apresentação contém **dois boxes**, e quantidade 2 representa quatro boxes. Frascos/kits não recebem contagem fictícia de boxes. Frete vazio permanece a confirmar, não incluído no total. O servidor calcula subtotal/frete/total em centavos inteiros e reconfere preços/versões sob bloqueio; mudanças exigem nova revisão.

GET/POST `/api/v1/inventory/vendors`, `/vendor-catalog?supplierId=<uuid>` e `/vendor-orders`, e GET `/vendor-history?supplierId=<uuid>` exigem sessão; POST exige a mesma origem. Ao salvar, pedido/itens, produtos vinculados e snapshot imutável de preços/apresentações/contato são confirmados juntos. Reenvio com a mesma UUID/hash não duplica a compra, mesmo após edições posteriores do catálogo. Uma apresentação já usada em pedido mantém código/embalagem/conteúdo; mudanças de embalagem requerem um novo item.

O produto vinculado ao estoque usa unidade **apresentação**, preservando quantidades e custos comerciais; não converte automaticamente para ampolas/doses. O pedido fica disponível no recebimento existente, sem criar saldo antes da entrega. Status Pendente/Parcial/Recebido acompanha as quantidades recebidas. Fornecedor com entrega pendente não pode ser desativado.

GET `/api/v1/inventory/vendor-orders?id=<uuid>&format=csv|txt|html` exporta o snapshot autorizado, com respostas privadas sem cache. CSV tem BOM UTF-8, separador ponto e vírgula, valores em BRL e proteção contra fórmulas de planilha; HTML escapa conteúdo e permite imprimir/salvar PDF. A mensagem pode ser copiada ou aberta no WhatsApp **para revisão e envio pelo usuário**; listas extensas usam cópia/arquivo em vez de URL gigante. Salvar/exportar não envia mensagens nem confirma uma compra com o fornecedor.

Validação local desta etapa: build/typecheck/lint (apenas seis avisos preexistentes), 50 testes unitários/UI, 73 testes de integração PostgreSQL, sete fluxos de navegador e três proteções do Preview. Os fluxos verificam cadastro/edição/histórico, concorrência/reenvio/rollback, preços pendentes, custo por conjunto de boxes, exportação, contato WhatsApp, ausência de estoque antes da entrega e recebimento persistido.

### Catálogo Stin Pharma

`Cadastro_Stin_Produtos_Protocolos.md`, fornecido pelo usuário, origina `src/server/vendor-catalog/stin.json`: **115 produtos e um kit completo (116 apresentações)**. O contato informado para Stin Atendimento é `+55 11 2078-1800`. Todos os produtos individuais são boxes com 10 ampolas ou frascos; o preço comercial é o **preço da caixa**, conferido como dez vezes o unitário. Concentrações, volumes, vias, preço unitário, página e observações permanecem como dados transcritos. Códigos STIN são internos; nenhum SKU oficial foi inventado.

O kit STIN-K001 custa **R$ 499,00 pelo conjunto de cinco fases**, contendo cinco frascos e uma ampola. Fases/composições e suas pendências ficam na descrição; não se criam cinco itens com custo artificial nem estoque paralelo dos componentes. O volume de reconstituição de NADH e unidades ambíguas permanecem sem inferência. Seis apresentações com observações de cadastro exibem “Conferir cadastro”, com o texto original em detalhes. Os preços são históricos, referência março/2026, sujeitos à confirmação.

`import-supplier-catalog.ts` reúne a importação transacional/idempotente, utilizada por `import-essentia.ts` e `import-stin.ts`. Exige autorização/ambiente isolado e recusa produção; reimportações preservam preços, contato, identificadores e vínculos já editados. Stin e Essentia mantêm catálogos e produtos de estoque distintos. A preparação do Preview e o runner local importam ambos; o conteúdo da apresentação aparece também em CSV, lista, PDF e mensagem WhatsApp. A importação não cria compra, saldo, lote ou aplicação clínica.

Validação desta ampliação: 52 testes unitários/UI, 74 de integração PostgreSQL, fluxo de navegador Stin e proteções de Preview. Pedido de teste com dois boxes STIN-P001 (R$ 55,00 cada) e um conjunto STIN-K001 (R$ 499,00) totaliza **R$ 609,00**, com frete a confirmar. Reimportação concorrente, preservação de edições, composição do kit e ausência de estoque foram verificadas.

### Testes com PostgreSQL descartável no Codex Cloud

Com Docker local disponível, execute `npm run test:integration:local`. O comando cria um PostgreSQL 16 com banco `allik_test` e senha aleatória, aplica migrations pelos testes e remove o contêiner ao terminar. Não usa `DATABASE_URL` externa. O acesso ao socket local do Docker e a processos filhos deve estar permitido; o primeiro uso baixa `postgres:16-alpine`.

Para testar no navegador, instale Chromium com `npx playwright install chromium` e execute `npm run test:e2e:local`. O runner também aplica o seed sintético e importa o catálogo Essentia em seu banco descartável, inicia o servidor na porta 4317 e remove o servidor/banco ao final. Em ambientes com diretório de usuário restrito, use `PLAYWRIGHT_BROWSERS_PATH=/tmp/oi-browser-cache` tanto na instalação como na execução. A porta 4317 precisa estar livre.

## Preview na Vercel

O projeto usa o adaptador Nitro/Vercel da configuração Lovable, com frontend e API no mesmo deployment. Configure estas variáveis **somente para Preview**:

- `DATABASE_URL`: conexão PostgreSQL de Preview separada de produção.
- `INVENTORY_ENVIRONMENT=preview`.
- `INVENTORY_PREVIEW_PASSWORD`: senha longa exclusiva do Preview.
- `INVENTORY_SESSION_SECRET`: segredo aleatório exclusivo do Preview.
- `INVENTORY_DISABLE_PREVIEW_LOGIN=true`: opcional; dispensa a segunda tela de login somente em
  deployments onde `INVENTORY_ENVIRONMENT=preview` e `VERCEL_ENV=preview`. Use apenas com a
  Deployment Protection da Vercel ativa e defina também
  `INVENTORY_PREVIEW_DATA_CLASSIFICATION=synthetic`. Sem essa classificação explícita, o sistema
  mantém o login interno ativo. O login por senha permanece implementado e volta a ser exigido ao
  remover ou definir qualquer uma dessas variáveis como `false`/vazia. Nunca use essa classificação
  em banco Pilot ou em cópia de dados reais.

Para branches Neon criadas por deployment, autorize a preparação somente na branch sintética de Preview: `INVENTORY_PREPARE_PREVIEW=true` e `INVENTORY_ALLOW_SEED=true`. O build aplica migrations, seed idempotente e importações Essentia/Stin antes de compilar, exigindo também `VERCEL_ENV=preview` e `INVENTORY_ENVIRONMENT=preview`. Sem opt-in, o build não acessa o banco; com opt-in em produção, ele falha antes de qualquer migration. O seed sintético nunca deve ser autorizado em bancos com dados reais. PRs simultâneos devem usar branches de banco isoladas. Execute `bun run test:preview-guard` para verificar as proteções.

O acesso por senha compartilhada é exclusivo da demonstração sintética. A API nega esse modo em `INVENTORY_ENVIRONMENT=production`, onde o Pilot usa identidade individual, papéis e escopo por unidade. Proteção de deployment/rate limiting da Vercel pode complementar o Preview.

## Pilot multiusuário

O Pilot usa um PostgreSQL Neon exclusivo, separado do Preview e de testes. Configure somente no
ambiente `Production` da Vercel: `DATABASE_URL` pela integração Neon,
`INVENTORY_ENVIRONMENT=production` e `INVENTORY_SESSION_SECRET` como variáveis Sensitive.

O build de produção nunca executa migrations, bootstrap, redefinição de senha, importação ou
reconciliação. Essas ações são comandos administrativos explícitos, executados com a autorização
específica do respectivo script e retirados do ambiente logo após o uso. O bootstrap inicial cria
somente a organização Allik, as unidades Fortaleza e Juazeiro do Norte e o primeiro
superadministrador; seeds sintéticos são proibidos no Pilot.

`scripts/import-real-inventory.ts` é destrutivo e aceita somente ambientes não produtivos com
`INVENTORY_ALLOW_REAL_IMPORT=true`. O Preview normal usa `seed-inventory.ts`, sem dados operacionais
reais. Nunca aponte scripts de seed ou importação para o banco do Pilot.

Antes do uso operacional, confirme no console Neon a retenção disponível para o plano e faça um
teste de restauração em uma branch separada. Em incidente: interrompa escritas, restaure em nova
branch no ponto anterior ao evento, valide ledger versus balances e só então troque a conexão da
Vercel. Preserve o banco afetado até concluir a conferência.

## Milestones

1. API + dashboard e produto com dados do PostgreSQL; migrations, ledger e Preview verificado.
2. Recebimento parcial transacional, compra, fornecedor e entrada.
3. Histórico, transferências e ajustes reais.
4. Aplicação transacional com baixa, validade e recomendação FEFO.
5. Rastreabilidade ponta a ponta e validação do fluxo completo.
6. Cadastro e edição de produtos/locais com auditoria e proteção de saldo.
7. Fornecedores, catálogo Essentia e pedidos com custo, exportação e WhatsApp.

O Milestone 1 só é encerrado após validar o deployment com PostgreSQL na Vercel. Testes e build locais não substituem esse aceite.

## Sincronização

### Evolução clínica — próximos marcos

- Milestone 13: aprovação/recusa do orçamento emitido e registro manual do pagamento integral, com escopo por unidade, controle de versão e auditoria. Valores emitidos permanecem congelados; registrar pagamento não movimenta estoque.
- Milestone 14: ativação do plano terapêutico e programação das aplicações a partir da primeira data, frequência estruturada e quantidade contratada; confirmação da agenda pela equipe antes de reservar estoque.

  A ativação exige orçamento pago e uma prévia conferida pela equipe. A quantidade contratada define o número de aplicações, respeitando a duração prescrita. Intervalos mensais seguem o calendário; intervalos em horas exigem uma agenda com horários e não são convertidos em dias. Prescrições antigas com frequência livre precisam de revisão clínica antes da ativação. A operação gera plano, compra do paciente e aplicações previstas em uma única transação, sem alterar saldo físico.

- Milestone 15: documentos independentes por atendimento, modelos reutilizáveis de prescrição e solicitação de exames, visualização e impressão.

  Receitas textuais e solicitações de exames são documentos independentes, com rascunho, controle de versão, autoria e finalização imutável. Modelos são particulares do profissional e devem conter somente conteúdo reutilizável, sem identificação de pacientes. A impressão autenticada de documentos finais permite salvar em PDF pelo navegador. A prescrição estruturada de injetáveis mantém seu vínculo com orçamento e plano terapêutico.

- Milestone 16: histórico longitudinal do paciente, evoluções, planos terapêuticos, documentos e aplicações.

  O prontuário em `/pacientes/:patientId/prontuario` reúne agendamentos, evoluções finalizadas, prescrições estruturadas finalizadas, receitas e pedidos de exames finais, planos e aplicações. A consulta é protegida por organização e unidade em cada fonte, com paginação determinística e filtros. Rascunhos clínicos permanecem no atendimento; a linha do tempo não os apresenta como documentos finais.

- Milestone 17: assinatura eletrônica de documentos, integridade e validação.

  A preparação 17A congela a identificação do paciente, unidade, profissional/conselho e conteúdo nos documentos novos quando são finalizados. Documentos finais legados permanecem intactos e a impressão identifica o cabeçalho obtido do cadastro atual. A assinatura eletrônica depende da escolha e integração do provedor/certificado; finalização e impressão no navegador continuam sem assinatura digital.

Projeto Lovable: https://lovable.dev/projects/d9d8071f-e34a-4e1b-8e4d-5b845dc82c23
Não reescreva histórico publicado. A alteração do nome do repositório no GitHub e do projeto/domínio Vercel é independente do nome visível da aplicação.

### Documentos do atendimento — editor e duas vias

A área de documentos usa abas superiores por ID e editor TipTap com negrito, itálico, sublinhado, listas, alinhamento e histórico de edição local. São aceitos receita, solicitação de exames, atestado, encaminhamento, relatório, laudo e orientações. Novos documentos recebem título automático; títulos antigos permanecem preservados.

Os rascunhos exigem **Salvar rascunho**: alternar abas preserva as alterações em memória, mas sair da página sem salvar pode perdê-las. Modelos pessoais preservam formatação e permitem inserir no cursor ou substituir com confirmação. A prévia salva alterações pendentes antes de abrir o documento e identifica os rascunhos; somente o autor individual pode imprimir a prévia de um rascunho. Documentos finais continuam imutáveis e consultáveis dentro do escopo autorizado.

A opção **Emitir receita em duas vias** é persistida exclusivamente em receitas. A impressão apresenta duas cópias completas, identificadas como via do paciente e da farmácia, com quebra de página. A migration aditiva `0049_wet_tombstone.sql` preserva texto e versões finais existentes e congela formatação e opção de vias nas novas finalizações. Conteúdo do editor é validado por uma lista restrita de estruturas e renderizado com escape de HTML.

Mevo permanece indisponível até configuração de uma integração real. Finalização e impressão não equivalem a assinatura eletrônica; a integração Lacuna ainda depende de credenciais de homologação/licenciamento. A geração de duas vias não substitui requisitos específicos do documento.

### Espaço clínico e impressão de receitas

Atendimento e prontuário longitudinal compartilham superfícies brancas/cinzas e destaque azul. O editor de documentos mantém o rodapé de ações dentro da altura disponível, com rolagem interna do texto e opção de expansão/recolhimento sem perder conteúdo. Mevo e a ação duplicada de impressão foram removidos.

No menu de opções da receita, **Dados da receita** distingue receita simples, antimicrobiano e controle especial. Dados já cadastrados do paciente são sugeridos; campos ausentes permanecem vazios para conferência. Endereço profissional, contato, documento/endereço do paciente e idade/sexo quando aplicáveis podem ser completados por documento. Esses dados não são copiados para modelos e ficam congelados na finalização. Antimicrobianos e controle especial mantêm duas vias obrigatórias no servidor.

As duas vias são impressas lado a lado em A4 paisagem, com identificação própria. Receitas longas continuam em páginas adicionais, sem reduzir o texto até ficar ilegível. O controle especial inclui identificação do emitente e paciente, CPF/passaporte, endereços, data e assinatura, além dos campos opcionais para comprador e dispensação; antimicrobianos incluem idade/sexo e registro da dispensação. Dados e disposição foram conferidos no [modelo vigente versão 2 da Anvisa](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/sncr/receituario-fisico/modelos-vigentes/receita-de-controle-especial-rev20260313.docx/@@download/file) e na [RDC 471/2021](https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&cod_menu=8542&cod_modulo=310&link=S&numeroAto=00000471&orgao=RDC%2FDC%2FANVISA%2FMS&seqAto=000&tipo=RDC&valorAno=2021).

A impressão não implementa notificações A/B/B2 nem numeração/registro SNCR. A assinatura digital continua pendente; gerar duas vias e preencher estes campos não equivale a emissão eletrônica com validade garantida. A migration `0050_moaning_human_torch.sql` preserva metadados e documentos finais legados.

### Milestone 17B — integração de assinatura digital

O documento finalizado pode gerar um PDF determinístico no servidor, revisar esse arquivo e iniciar uma sessão da página de assinatura hospedada do **Lacuna Rest PKI Core**. Essa página oferece os certificados configurados na instância, incluindo VIDaaS/BirdID quando habilitados pela Lacuna. Nenhuma senha do certificado ou chave privada entra no Allik One.

Somente o autor individual, com acesso à unidade, pode iniciar, verificar ou cancelar uma tentativa. A administração individual com `users.manage` precisa conferir o CPF do profissional em **Identidade de assinatura** antes do primeiro uso. O CPF é criptografado no banco com uma chave própria, fica vinculado à conta e a alterações ficam auditadas; mudanças cancelam tentativas pendentes. O certificado usado deve corresponder a essa identidade.

O servidor envia um único PDF predefinido, associa sessão/documento/autor e valida o retorno autenticado. Antes de registrar `SIGNED`, compara o SHA-256 do PDF original, inspeciona a assinatura, exige contexto ICP-Brasil, CPF/certificado correspondente e validação sem erros ou avisos. São preservados os bytes exatos do PDF assinado, hash, certificado e evidência do provedor no PostgreSQL; a URL temporária de download não é usada como armazenamento. PDF, origem da tentativa, eventos e estados finais têm proteção de imutabilidade. Cancelamento local não revoga autorizações já concedidas ao provedor.

Configuração por ambiente:

- `LACUNA_REST_PKI_CORE_API_KEY`: chave exclusiva do aplicativo/ambiente, com acesso às APIs de sessão, documentos e inspeção. Solicitar à Lacuna acesso de homologação e habilitação de certificados em nuvem.
- `LACUNA_REST_PKI_CORE_URL`: endpoint suportado `https://core.pki.rest/`.
- `SIGNATURE_PUBLIC_ORIGIN`: URL HTTPS **estável** do Preview ou da produção. O usuário deve acessar essa URL para iniciar; não usar URLs efêmeras diferentes a cada deploy. Cadastrar a rota de retorno `/atendimentos/<id>` e parâmetros permitidos com o provedor conforme a configuração de sua instância.
- `DOCUMENT_SIGNATURE_SECRET`: segredo persistente aleatório com pelo menos 32 caracteres, separado do segredo de sessão. Guardar no gerenciamento seguro de segredos e no procedimento de recuperação; sem ele, os CPFs criptografados ficam inacessíveis. Uma troca exige reconferir as identidades e cancela/inviabiliza tentativas antigas.

Use variáveis Sensitive somente no servidor, sem prefixo `VITE_`; não copiar credenciais para código ou chat. Homologação, Preview e produção devem usar credenciais e dados isolados. A chave de teste dos exemplos públicos da Lacuna não é utilizada.

Sem configuração, a tela informa indisponibilidade e nenhuma sessão externa é criada. Os testes de fronteira usam respostas simuladas do provedor: eles não demonstram uma assinatura criptográfica real. O aceite final do 17B exige uma sessão de homologação com o certificado do profissional, comparação/validação do PDF recebido e conferência independente no [VALIDAR do ITI](https://validar.iti.gov.br/). Não liberar assinatura clínica oficial antes desse aceite. A assinatura não implementa numeração/notificações A/B/B2 ou registro SNCR.

Referências: [sessões Rest PKI Core](https://docs.lacunasoftware.com/en-us/articles/rest-pki/core/integration/signature-sessions), [CloudHub](https://docs.lacunasoftware.com/articles/cloudhub), [contrato OpenAPI](https://docs.lacunasoftware.com/openapi/rest-pki-core.json). A geração no servidor usa a distribuição PDFKit standalone com fontes embutidas, versão fixada, para evitar carregamento dinâmico de arquivos de fonte no runtime Vercel.

### Milestone 17C — first audit remediation batch

Migration `0052_clinical-authorship-guard.sql` preserves existing clinical records and blocks changing an appointment's patient, professional, organization or unit after any clinical note, prescription or document exists, including drafts. Clinical writes serialize on the appointment row; SQL triggers also preserve the author and identity fields of existing records. Taking over an appointment is permitted only before clinical records exist. Evolution and prescription writes independently require the original draft author.

The editor normalizes Tiptap's numbered-list `type: null` without accepting arbitrary attributes. Documents are rendered before finalization so unsupported glyphs cannot create an immutable, unrenderable document. Clinical evolution uses the version originally displayed rather than refreshed query-cache metadata, retains dirty text on refetch/conflict, and warns before navigation or browser exit. Numeric patient search requires numeric-like input and at least four digits; alphanumeric documents stay textual. Dev SSR loads PDFKit with Node's native loader; production bundling is unchanged. CI now runs browser E2E against an isolated disposable database.

This batch does **not** authorize clinical production use. The clinical-role and access-audit batch below adds further safeguards. Remaining 17C gates: recovery controlled by the account holder, least-privilege database runtime role, finalized-content hash and addendum/rectification flow, canonical patient/issuer print identity and verification identifier, allergy consistency, professional registration uniqueness and a second external review. Real Lacuna homologation remains a separate 17B gate. No historical authorship is rewritten and no real patient data is imported.

### Milestone 17C — clinical roles and access audit

`CLINICIAN` (Profissional de saúde) has unit-scoped patient/clinical access and does not gain stock-adjustment or global identity-management powers. `UNIT_MANAGER` retains administrative patient registration but no longer grants private chart access or clinical authoring. Existing administrator roles remain compatible with their organization/unit scope; writing requires a supported complete professional registration. This pilot's conservative document policy permits medical prescriptions, exam requests, certificates, referrals, reports and opinions only with CRM; supported other councils can write general instructions and clinical notes. This is not external license verification or a complete mapping of professional/legal scopes.

Only the author sees drafts in encounter note, prescription and document reads. Authorized clinicians can read finalized records. The document menu uses the server's allowed type list. Administrative demographic updates cannot overwrite hidden allergies/private information, and meaningful attempts to change private data are rejected.

Migration `0053_clinical-access-policy.sql` adds append-only clinical access events with organization, unit, patient/resource identifiers, authenticated actor, action and timestamp. Encounter reads, document lists, timeline reads, print/preview requests, source PDF and signed PDF downloads are recorded before returning data. Events contain no document body, passwords, tokens, CPF, IP or browser details. A PRINT event means the printable document was served, not proof that paper was physically printed. Foreign-unit/organization scope is checked in the API and access-event SQL trigger. UPDATE, DELETE and TRUNCATE on these events are rejected by triggers; a database owner can still disable protections, so runtime least-privilege database credentials remain a release gate.

No existing users are automatically reassigned roles and no production database is modified by these Preview changes. Remaining 17C gates include account-holder-controlled recovery, runtime database-role separation, finalized-content hash, rectification/addendum flow, canonical print identity/verification fields, professional registration uniqueness and second external review. Real Lacuna homologation remains pending independently.

### Milestone 17C — account-holder password control and runtime DB tooling

Activated accounts no longer accept administrator-generated invitations as password-reset links. The administrator cannot change an activated account's login email through the UI/API; migration `0054_account-password-security.sql` also protects that email in PostgreSQL and revokes legacy unused reset-style invitations, with an audit event. Pending first-access invitations remain supported. Activation and reinvitation serialize on the user before locking invitation records and cannot overwrite an existing password.

**Minha conta → Alterar senha** requires the current password and a new password of 12–200 characters. On success the server revokes all sessions, unused invitations and recovery tokens, increments the session version and clears browser session cookies. Passwords remain scrypt-hashed and never enter logs or browser storage. Password-change attempts are limited in PostgreSQL, shared across server instances. Recovery-token completion is single-use, short-lived and bound to the user's email/session version; concurrency tests prove only one completion succeeds.

**Email recovery via Resend (Preview first).** Enable `AUTH_RECOVERY_ENABLED=true` only after configuring server-only `RESEND_API_KEY` and `AUTH_EMAIL_FROM` with a verified sending domain. Preview derives its HTTPS link origin from Vercel's own `VERCEL_URL`; production requires an explicit HTTPS `AUTH_PUBLIC_ORIGIN` and a separate activation/deployment. The sender is `Allik One <nao-responda@allikone.atpmarketing.com.br>`. No DNS receiving/MX setup is needed for outbound recovery. Use a domain-restricted sending key for runtime; administrative Full Access keys are only needed for provider setup and should be revoked or replaced afterward.

The login page exposes **Recuperar acesso** when configuration is complete. Requests return the same conditional acknowledgement for eligible, unknown, inactive and throttled accounts, never an account lookup result or token. Delivery uses Resend's documented `/emails` API with an idempotency key and a two-second delivery budget measured from request start, covering both headers and response body. Every request has a 2.5-second minimum response time; a slow or ambiguous delivery is aborted and its token revoked, so the holder may need to retry. Only a SHA-256 token hash is stored, bound to email and session version; links expire in 30 minutes. Tokens stay in the URL fragment, are removed from browser history on load and are never logged. PostgreSQL limits requests per email and IP plus daily delivery attempts. Failed/ambiguous provider deliveries revoke the issued token and record only a static server error. Multiple issued links become invalid when one successfully resets the password. Password change still revokes all sessions, invitations and other recovery links. Resend acceptance is not proof of delivery to a person's inbox; test acceptance and the holder's mailbox separately.

The explicit command `node scripts/provision-runtime-role.mjs --apply` prepares a separate `allik_runtime` login with only required inventory table/sequence privileges, and `--check` verifies the result. It requires `INVENTORY_ENVIRONMENT`, `DATABASE_ADMIN_URL` (maintenance owner), `DATABASE_URL` (same database, runtime login), and `INVENTORY_RUNTIME_PASSWORD` (apply only, at least 32 characters). URLs/credentials are never printed. The script rejects ownership, inherited elevated memberships, schema CREATE, migration-history writes and reachable SECURITY DEFINER functions. Append-only tables receive SELECT/INSERT only; application roles cannot TRUNCATE, ALTER TABLE, disable triggers or change replication role. New migrations require rerunning this explicit grant/check step.

Keep maintenance credentials **outside deployed application environments**. Run migrations in a separate authorized maintenance process using owner credentials, apply/check runtime grants, and configure only the runtime `DATABASE_URL` in the application. Do not put `DATABASE_ADMIN_URL` in the app's Vercel variables. Preview synthetic build preparation currently uses owner access; before switching its URL, perform preparation explicitly and disable `INVENTORY_PREPARE_PREVIEW`. Never run seed or migrations automatically with the restricted role. This tooling is tested against disposable PostgreSQL and the production build's browser/API flow, but has **not been applied to Neon or the official deployment**. Live activation requires secure maintenance access and verification of the separate target database.

The local integration launcher and CI now test restricted-role DDL denial and normal transactional writes. Remaining gates include enabling verified email recovery in production, live runtime-role separation, finalized-content hash, addenda/rectification, professional registration uniqueness and an external re-audit. None of these changes authorize real clinical use yet.

### M17C — Finalized-document integrity and linked amendments (Preview)

Migration `0055` adds immutable SHA-256 seals over PostgreSQL's canonical JSONB snapshot text (UTF-8), independently from the signature source PDF's byte hash. Finalization creates the seal in the same transaction. Printing and signature-source access fail closed when the marker does not match. The UI displays the marker and its actual recorded date; this is integrity verification, **not a certified signature or trusted timestamp**. Existing frozen final snapshots receive a marker at migration time without modifying the original rows or backdating evidence. Legacy finals without snapshots remain explicitly unverified and cannot become amendment sources.

The responsible individual author can create an **Adendo** or **Retificação** from an original final document, with a mandatory reason. This creates a separate empty draft of the same authorized document type. The original is never rewritten, invalidated or reattributed automatically. Immutable linkage enforces the same organization, unit, appointment, patient and author; the source must have a valid seal. Each amendment refers directly to the original (no amendment chains). Its own final snapshot freezes the linkage, reason and original marker, and gets a separate integrity seal. Reasons and references appear in HTML/PDF output; long reasons paginate with the body, including two-copy prescriptions. The original screen lists linked final amendments and asks for confirmation before printing an original with finalized rectifications, while preserving the original PDF bytes and signature history.

Validated with disposable PostgreSQL tests for immutability, foreign-scope links, snapshot/link agreement, corruption detection and original preservation. Preview release only. Remaining 17C work includes live runtime-role separation, canonical patient/issuer print identity and verification identifiers, allergy consistency, professional registration uniqueness and external re-audit; Lacuna homologation is still independent.

### Clinical workspace UX — patient actions and encounter layout

The encounter header uses the same 1320px content limit as the clinical workspace; section navigation is rounded and the completion action is immediately before Contexto e histórico. Document tabs show newly created documents on the left while preserving IDs, chronological numbering and per-document draft buffers. Arrow-key navigation follows the displayed order.

Patient treatment creation opens in a visible, scrollable dialog with a default first-application date and inline server errors. Patient detail queries refresh on entry and do not reuse another patient's placeholder data; route components reset form state when the patient ID changes. The treatment capability flag matches both required server permissions. **Nova consulta** is available from the patient's treatment page and chart for authorized profiles: select the responsible professional, configured room and type, then create/open a regular encounter for the current time. The existing scheduling endpoint enforces unit scope, active patient/professional membership, configured resources and schedule conflicts; there is no conflict bypass. The new encounter starts scheduled and can be started through the existing action. Creating a treatment or encounter does not consume stock. Preview only.

### M17C — Consistent allergy assessment (Preview)

Migration `0056` adds explicit allergy assessment: unknown, patient denies allergies, or reported allergies. Historical records remain unknown unless positive intake/active allergy alerts provide evidence; no negative assessment, reviewer or review date is invented. Patient registration, chart, encounter and document context resolve the same summary. Positive evidence takes precedence, with exact normalized deduplication rather than inferred medical synonyms. Longer document-header lists expand on demand.

**Conferir alergias** is available only to an individually authenticated, appropriately registered clinical professional authorized for the patient's current unit. Recording requires a reason and optimistic patient version; the immutable patient-change history stores the actual actor. Concurrent assessments cannot silently overwrite each other. PostgreSQL rejects denial conflicting with active/intake evidence. New positive evidence withdraws an earlier denial transactionally; inactivating an alert does not restore it automatically. Unit scope also applies to the original alert when editing after a patient changes units. Restricted-unit readers do not receive private assessment data from an unauthorized primary unit.

Clinical query caches refresh after changes, including cached document context. Current allergy information does not rewrite finalized document snapshots, seals or PDF bytes. Disposable PostgreSQL and production-build browser checks cover unknown/denied/reported transitions across the four screens, audit authorship, unit/profile denial, concurrent writes, contradictory direct SQL, mobile layout and unchanged finalized PDF bytes. No real patients or provider emails were used.

Preview only; this does not complete M17C or authorize clinical production use. Remaining gates include live runtime-role separation, canonical patient/issuer print identity and verification identifiers, professional registration uniqueness and external re-audit. Real Lacuna homologation remains a separate gate.

### Patient page — consultation summaries

The patient detail page now shows **Resumo das consultas** near the top, independently of the longitudinal finalized-note list. The latest 50 authorized appointments include their status, unit, professional, final evolution/conduct/plan/return information, finalized injectable prescription and finalized document titles, with a link to the encounter. A completed appointment without a final evolution remains visible with an explicit notice; completing an appointment does not finalize a clinical draft. Only the draft's author receives an own-draft indicator, with no draft body disclosed by this summary. Prescriptions are identified as prescriptions, not administered medication or stock consumption.

The server checks patient-private access and organization/unit scope for each encounter and associated source, and records a clinical access event before disclosing the response. Another unit's records and other authors' drafts remain excluded. No migration, stock adjustment or clinical record finalization is performed by this fix. Preview only.

### M17C — Frozen patient print identity and internal verification (Preview)

New final documents freeze the patient's document type/number, birth date and address from the patient record, together with the existing patient/name/code, unit and responsible professional/council identity. Prescriptions validate their patient-print fields against the current server-side record before finalization; stale or forged values return 409 without creating a final document. Patient document/address/age fields are read-only in recipe details; reopening those details refreshes them from the current encounter context. Professional address/contact and patient sex remain explicitly entered document metadata, not an external registry or canonical clinic-address directory.

Each new final snapshot binds `documentId` and `verificationCode` (`A1-` plus the document's random UUID). Migration `0057` checks the binding in PostgreSQL without backfilling historical finals. The identifier appears in HTML print, the signature source PDF (both prescription copies) and the document's integrity details. Existing final snapshots, their original PDF rendering and historical authorship remain unchanged.

**Document options → Verificar documento** performs a scoped, authenticated lookup through the existing documents API's `verify` parameter. It checks the stored snapshot's SHA-256 seal, records the read before disclosure and returns only frozen identification/integrity metadata plus finalized amendment references. No document body, CPF, address or public patient lookup is returned by verification. Another organization/unit, drafts and unknown IDs receive no document data; legacy finals cannot acquire a retrospective code. Failed integrity checks fail closed. The UI links to the authorized preserved original for comparison and flags finalized amendments/rectifications. A valid internal code verifies the stored record, not an arbitrary paper copy, certified signature, license status or legal/clinical validity.

Validated with disposable PostgreSQL, restricted-runtime browser flow, two-copy print/source PDF, read audit, foreign-unit/organization access denial, patient identity conflicts, SQL identifier binding, corruption denial and original preservation after rectification. Preview only. Remaining M17C gates include professional registration uniqueness, live runtime-role separation, any required canonical issuer-contact configuration and external re-audit. Actual Lacuna/VIDaaS/BirdID homologation remains M17B.

### Registered prescriber contact and prescription delivery (Preview)

Migration `0058` adds prescribing address, city, state and phone to the professional's user record. **Administração → Usuários → Editar → Dados profissionais para emissão de receitas** is the controlled source, with the existing administrator permission and immutable user-change audit. Omitted contact fields in older API clients preserve their existing values; empty fields explicitly clear them. No real address or phone is seeded or inferred. New prescription finalization requires complete registered contact; drafts and finals reject client-submitted issuer values that differ from the profile. The recipe's patient/issuer identification fields are read-only. Opening recipe details refreshes registered values; finalization locks and rereads the sources before freezing them. Previously finalized documents retain their original metadata and PDF bytes.

**Enviar receita**, available to the individually authenticated responsible professional for an integrity-checked finalized prescription, uses the current patient contact and unit scope. The user confirms the destination, any finalized amendments and, when applicable, sending without a digital signature. The PDF service preferentially returns the preserved signed PDF; it falls back to the immutable unsigned source only with explicit acknowledgement. Finalization alone is not signature certification.

Email reuses the existing server-only `RESEND_API_KEY` and verified `AUTH_EMAIL_FROM`, attaching the PDF directly. No public download links or new mail integration are introduced. An immutable intent reserves the operation before the provider call; the provider receives a stable idempotency key. Concurrent/repeated requests do not dispatch twice. Ambiguous outcomes are recorded as unconfirmed and are never retried automatically. Recent requests have a two-minute cooldown and a professional may request at most ten emails per hour. Provider acceptance is reported as acceptance for sending, not inbox delivery. Logs contain neither recipient, document bytes, API key nor raw provider errors.

WhatsApp uses a private PDF preparation/download plus native file sharing where supported. The desktop fallback downloads the PDF and opens a `wa.me` conversation with a generic draft message; the user attaches and sends it. Explicit international prefixes are preserved; unprefixed Brazilian local numbers receive country code 55. This is **not** an automated WhatsApp Business API integration and does not claim delivery. Native sharing cannot choose or confirm the recipient on the user's behalf. The UI asks the operator to check the destination in the chosen app.

`inventory_document_delivery_events` is append-only, unit/organization/patient/document/author scoped by SQL trigger, and records intent/result or WhatsApp preparation, authenticated actor, operation, recipient hash, PDF hash and signed status. Runtime-role checks include its SELECT/INSERT-only grants. No clinical content or raw recipient is copied into this table. Tests use synthetic records and intercept Resend/WhatsApp; no real messages were sent during verification. Real sending requires the configured verified sender and correct patient contact, and an existing professional needs an administrator to complete the new contact fields once. Preview only; official production remains unchanged.

### M17C — Organization-scoped professional registration uniqueness (Preview)

Migration `0059` reserves council + normalized registration number + Brazilian UF per organization, including inactive accounts/memberships. Formatting punctuation, council prefixes and leading zeros do not create a second identity; alphabetic professional-category suffixes remain distinct. The database unique index protects concurrent reservations, and membership/profile triggers enforce the source and organization binding. A user authorized for multiple units still has one organization membership and registration. The same registration in an independent organization does not disclose or block that organization's accounts.

Existing duplicate or malformed profiles are retained, without choosing an owner, deleting accounts, changing roles or rewriting clinical authorship. **Usuários → Registro profissional** identifies conflicts; the administrator corrects them through the existing audited edit flow. Each authenticated request rechecks registration state. Duplicate/invalid profiles retain their authorized reading, account administration and inventory permissions, but cannot write clinical content; SQL also guards evolution, injectable prescriptions and encounter documents. Explicit correction restores eligibility, including the remaining unambiguous legacy profile. Previously finalized records remain immutable and keep their frozen issuer identity. This validates internal consistency only, not licensure, professional scope or an external council registry. Existing clinical role/council restrictions remain in force.

Verification: 169 unit/UI tests, 191 PostgreSQL integration tests, two restricted-runtime-role checks, typecheck, lint (six existing Fast Refresh warnings), build, real-browser create/edit conflict and correction using the restricted SQL runtime role, plus an actual 0058→0059 disposable-database migration with legacy duplicates and preserved documents. No messages were sent. Preview only; remaining M17C gates include live runtime-role activation and external re-audit. Lacuna/VIDaaS/BirdID homologation remains a separate M17B gate.

### M17C — Runtime activation and external audit release gate

**Status (2026-10-15): restricted Neon role activated for the patients Preview; official clinical beta remains gated.** The isolated Neon branch `preview/feature/allik-patients` now has `allik_runtime` with verified authenticated/session identity, 80 inventory tables and 43 append-only tables. The role was created by SQL with non-elevated attributes; Neon's role-creation API defaults to an administrative role and must not be used as-is for runtime. Verification used an authenticated read-only Neon MCP transaction with the checks from `check-runtime-access.mjs`, plus actual DDL/append-only denial and transactional rollback. The local live-target CLI was not run because executor TCP was unavailable. Candidate `dpl_DN1vGuezNFSjCn8eRcwYXxeofr2i` at `e414dd6cc51f51f4f8a22752c2c7d701c3fd7fe8` was READY and served the login/session/catalog routes. Its branch-only environment overrides replace owner aliases and disable automatic migration/seed; shared and Production variables were preserved. This records the activation evidence, not completion of the clinical release gate or the later candidate's verification. See [official beta preparation](docs/beta-production-release.md) for subsequent fixes, tests, recovery limitations and pending gates.

`npm run db:check-runtime` checks the application connection itself, without `DATABASE_ADMIN_URL`. Configure server-only `DATABASE_URL`, explicit `INVENTORY_ENVIRONMENT` and `INVENTORY_RUNTIME_ROLE` in the maintenance runner. It opens a **read-only transaction** and checks the authenticated/session identity, elevated attributes, role memberships, object ownership, schema/database CREATE, replication-setting bypass, executable SECURITY DEFINER functions, inventory CRUD versus append-only grants, sequence access and migration-history writes. Its CLI emits only verification status and table counts; failures never print a connection string or driver error. This is a manual maintenance check, not a public endpoint or build step.

Activation sequence for the synthetic `feature/allik-patients` Preview:

1. Provide the exact Preview `DATABASE_ADMIN_URL` only through the maintenance runner's secret configuration. Independently confirm that it targets the synthetic branch, not Pilot/Production. Record the provider's restore point/branch recovery procedure and migration checkpoint without credentials. Keep the existing working Preview URL available.
2. Run pending migrations explicitly with the maintenance connection. Generate a separate strong runtime password through the secret manager and set the same database's runtime `DATABASE_URL`, `INVENTORY_RUNTIME_PASSWORD`, `INVENTORY_RUNTIME_ROLE` and explicit `INVENTORY_ENVIRONMENT=preview` in that runner. Run `node scripts/provision-runtime-role.mjs --apply --role allik_runtime`, then `--check`. Do not print or paste secrets into chat or command arguments. Use the actual chosen role consistently.
3. Run `npm run db:check-runtime` with **only the runtime connection**. Stop on any failure. Existing objects must stay owned by the maintenance identity; ledger/audit/history data must not be recreated or reassigned.
4. For this branch's Preview only, disable `INVENTORY_PREPARE_PREVIEW` and `INVENTORY_ALLOW_SEED` before deploying with the restricted connection. Replace `DATABASE_URL` with the runtime URL. Review/remove other owner-credential aliases from this candidate's application environment; changing one variable while leaving `PGPASSWORD`, unpooled URLs or other owner aliases exposed is not credential separation. Do not change globally shared integration variables or other branches blindly. Keep all maintenance credentials outside deployments. Record variable names/scopes changed and a secure reversal procedure without their values.
5. Deploy a candidate Preview. Verify individual login/logout, correct unit isolation, user edit, draft save, finalization/print, existing history, receiving/consumption and transactional rollback using synthetic data. Confirm the candidate uses the verified runtime configuration, not an older deployment. Do not send real email/WhatsApp messages during verification. For future migrations, explicitly migrate and reapply/check grants before deploying code needing new tables.
6. If a check fails, stop promotion and return users to the known working Preview while correcting the candidate. A Vercel code rollback alone does not reverse database migrations or environment changes. Do not disable constraints/triggers or grant ownership to make a check pass. Production remains a separate rollout.

External auditor handoff: use the [M17C acceptance checklist](docs/audits/m17c-external-acceptance.md) and review the current `feature/allik-patients` HEAD, recording the **full SHA** before starting. Use synthetic/disposable databases only. Read `AGENTS.md`, this release-gate section, migrations `0052`–`0060`, auth/clinical policy, user administration, document snapshot/seal/amendment/printing/signature/delivery code, and runtime provisioning/checks. The intentionally disabled shared Preview login is an accepted demonstration configuration; verify that it cannot impersonate an individual clinical author or leak into Pilot. Prioritize reproducible cross-unit/cross-organization IDOR, other-author draft exposure, final-content mutation, duplicate registrations (including inactive and concurrent accounts), patient/issuer identity forgery, session/recovery/invite races, SQL ownership/trigger bypass and secrets in deployed environments. Distinguish finalization from certified signing, email-provider acceptance from inbox delivery, and WhatsApp preparation from actual sending. Report severity, file/line, reproduction, impact and missing coverage; list checks actually run and unresolved environmental gates. Do not claim live restricted-role activation, provider backup restoration or Lacuna homologation without direct evidence.

### Re-audit remediation of `39b5584`

The audit of `39b5584` found and this branch fixes, with regression tests:

- **Trigger bypass by the runtime role (high).** PostgreSQL grants `TEMPORARY` to `PUBLIC` by default, and unqualified names in trigger functions resolve `pg_temp` first, so a runtime-created temporary table could capture audit and balance writes. Migration `0060` pins `search_path = pg_catalog, public, pg_temp` on every `inventory_*` function; provisioning revokes `TEMPORARY` from `PUBLIC` and the role; provisioning and `db:check-runtime` reject a role with `TEMPORARY` or an unpinned function.
- **Runtime identity (medium).** With `INVENTORY_ENVIRONMENT=production` the application refuses to query unless `INVENTORY_RUNTIME_ROLE` is set, `DATABASE_ADMIN_URL` is absent, every owner alias (`DATABASE_URL_UNPOOLED`, `POSTGRES_URL*`, `PGUSER`, `POSTGRES_USER`) matches the role, and the authenticated connection has no elevated attribute, `CREATE`, `TEMPORARY` or table ownership (`INVENTORY_RUNTIME_ROLE_REJECTED`). Maintenance scripts opt in explicitly with `allowMaintenanceIdentity()`.
- **Migration runner.** `scripts/migrate.ts` prints the target without credentials, takes an advisory lock, sets `lock_timeout`/`statement_timeout`, refuses a database that records unknown migrations or would skip one, and in production refuses edited applied migrations.
- **Clinical exposure (high).** The quote endpoint returned another author's draft prescription without an access record; it now returns only final prescriptions to private-data readers and audits the read. Active allergies now follow the patient after a unit change. Clinical problems can be edited only with clinical management in the unit that recorded them.
- **Superseded documents (high).** A rectified original now prints `SUBSTITUÍDO POR RETIFICAÇÃO` with the replacement's verification code, and cannot be signed or sent. Delivery requires recorded consent; pending and revoked consent both block email and WhatsApp preparation. Encounters with finalized records cannot be canceled or marked as no-show.
- **Identities (high).** An activated professional's council registry cannot be reassigned through user administration; the Preview operator and integration keys cannot change accounts; login lockout and timing are fixed as described below.

Release-owner decisions on 2026-10-16: prescriptions retain complete available identity, including CPF/document and address; delivery requires `RECORDED` consent; invitations go directly to the holder by email with an administrator-visible single-use link expressly retained for manual WhatsApp handoff. Existing sealed documents remain unchanged. Identity minimization on other document types remains subject to external review.

**Deployment consequence:** this code needs migration `0060` and a re-run of `provision-runtime-role.mjs --apply` (which revokes `TEMPORARY`) on every database before it is deployed there; the patients Preview has now received `0060` and equivalent grant reapplication through an authenticated Neon transaction; otherwise `db:check-runtime` fails and production mode rejects the connection. The official database at `0012` now has 48 pending migrations (`0013`–`0060`).

### Official clinical beta preparation

The intended beta includes real patients and operational inventory, so synthetic Preview access is not a production identity. Individual login now limits attempts in PostgreSQL across instances: 100 per trusted Vercel IP per hour, plus account counters that keep failures only (ten per normalized email and source IP, 50 per email across sources), with generic throttling, hashed counter keys and no session on rejection. A correct password from another network is not locked out by a third party's guesses. Unknown and not-yet-activated accounts pay the same scrypt cost as real ones. Password change/recovery retain their separate counters, and recovery requests answer after the same minimum time for every account.

Purchase receiving now serializes deliveries with a transaction advisory lock and locks the mutable supplier, without requiring UPDATE on the immutable purchase header. Restricted-runtime browser tests exposed the previous row-lock privilege failure; no history privileges were broadened.

`npm run test:e2e:local` now serves inventory E2E using a verified restricted SQL role. `npm run test:beta:local` builds the current production bundle without live credentials, creates a disposable local PostgreSQL database, rehearses synthetic `0012`→current migration with preserved ledger/balances, checks runtime grants, then verifies individual browser login, unit isolation, draft privacy, finalization/printing/source PDF/internal verification, registration uniqueness, audited profile editing, frozen PDF preservation, password/session revocation and logout. It also exercises local backup/restore and compares the final snapshot and migration checkpoint. No emails/WhatsApp messages are sent. This does not establish provider recovery, certified signing, external audit or authorization to use real patients before the production gates in the linked release procedure are closed.

### Follow-up verification of `7bf7771`

Independent reproduction found two further gaps, now fixed: the runtime identity guard also covers callback-based `Pool.connect` and native `Pool.query`, including concurrent valid calls; recovery delivery is bounded by the request-wide two-second budget even when provider headers or JSON stall. Regression tests cover an elevated callback connection, a 3.4-second provider and a never-ending response body. Local verification passed 171 unit/UI tests, 213 PostgreSQL integration tests, three runtime/tooling checks, eight inventory E2E, typecheck and the production-bundle migration/restore scenario. No real messages were sent. The final integrated SHA still needs external acceptance before official clinical use.

### Patient and schedule list access auditing

Patient lists, appointment lists and appointment patient-search results now persist per-record READ events before disclosure, using one atomic insert into the existing append-only clinical access table. Events identify the authenticated actor, organization, unit, patient and optional appointment; they do not store search text or record contents. Audit persistence failure blocks the response. Empty results and denied access produce no patient READ event. No new migration or broader runtime privileges are needed. The final branch HEAD needs external retest, including these list flows.

### Invitation delivery and consent decisions

Account creation and reinvitation now attempt email delivery to the stored holder email. Enable server-only `AUTH_INVITES_ENABLED=true`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM` and a valid HTTPS `AUTH_PUBLIC_ORIGIN` (Preview instead uses its trusted `VERCEL_URL`). Only `feature/allik-patients` Preview has the new enable flag configured by this change; Production is preserved. Provider acceptance, failure and missing configuration are distinguished. No success message claims inbox delivery. Timeout/failure retains the same valid link for the authorized manual fallback; an email might still arrive after an ambiguous failure. Invite expiry remains 72 hours; reinvitation revokes previous pending links and activation is single-use.

By explicit release-owner choice, administrators authorized to manage accounts can see/copy the link and open WhatsApp to select the holder manually. There is no automatic WhatsApp message, recipient verification or delivery confirmation. The link is a secret: send only to its titular user. It is not included in server logs or stored in plaintext in the database. The existing query-token activation format remains; administrator access is an accepted exception, not holder-only secrecy.

Document email and WhatsApp preparation require the patient's existing consent status to be `RECORDED`; `PENDING` and `REVOKED` fail before outgoing delivery. This uses the existing general consent record, not separate per-channel evidence. Prescriptions already populate available canonical CPF/document, birth date and address at finalization; missing data is not fabricated, and later patient changes do not rewrite frozen documents. Recovery was reported working by the release owner; environment and independent inbox evidence still need to be recorded for official rollout.
