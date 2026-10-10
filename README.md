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
  Deployment Protection da Vercel ativa. O login por senha permanece implementado e volta a ser
  exigido ao remover ou definir esta variável como `false`.

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

Projeto Lovable: https://lovable.dev/projects/d9d8071f-e34a-4e1b-8e4d-5b845dc82c23
Não reescreva histórico publicado. A alteração do nome do repositório no GitHub e do projeto/domínio Vercel é independente do nome visível da aplicação.
