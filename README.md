# Estoque Allik Fortaleza

Frontend existente em React/TanStack Start, sincronizado com Lovable. O Milestone 1 adiciona PostgreSQL para o inventário, preservando as telas.

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

GET `/api/v1/inventory/products`, `/products/:id`, `/locations`, `/lots`, `/stock` e `/movements`. Os filtros usam `productId`, `locationId` e `search`. As rotas HTTP e o driver do banco ficam no servidor; as telas usam TanStack Query. Uma sessão assinada do Preview é exigida na API.

Product, Location, Lot e StockMovement persistem no PostgreSQL. StockBalance é uma projeção do ledger, atualizada por trigger na mesma transação. UPDATE/DELETE de movimentações e auditoria são rejeitados; alteração direta de saldo também é rejeitada. A constraint de saldo não negativo protege concorrência. Aplicações continuam identificadas como demonstração, com confirmação desabilitada.

### Compras e recebimento — Milestone 2

`/estoque/recebimento` carrega produtos e locais da API. O formulário envia fornecedor, referência da compra e até 50 itens para POST `/api/v1/inventory/receipts`. Cada item exige produto, lote, validade, quantidade positiva e custo não negativo. Lotes vencidos e produtos/locais inativos são rejeitados. Um lote existente só pode ser reutilizado com os mesmos dados e status disponível.

A migration `0001_lush_mandroid.sql` adiciona o registro de recebimentos. O servidor grava recebimento, lotes e movimentos de entrada em uma transação; os triggers existentes atualizam saldo e auditoria. A UUID do envio e o hash do conteúdo garantem repetição sem duplicação, inclusive em solicitações concorrentes. Reutilizar a mesma chave com outro conteúdo retorna 409. Falhas ambíguas na interface preservam os dados e a chave para nova tentativa enquanto o formulário permanece aberto.

A migration `0002_aromatic_lady_ursula.sql` adiciona fornecedores, pedidos, itens previstos e o vínculo entre item recebido e movimento. Na mesma tela, cadastre um fornecedor, crie um pedido e selecione-o para registrar uma entrega. GET/POST `/api/v1/inventory/suppliers` e `/purchases` exigem a sessão do Preview; gravações exigem a mesma origem. Pedidos não alteram estoque até o recebimento. Referências de pedido e nomes de fornecedores são únicos; a criação aceita repetição idempotente pelo mesmo UUID.

Informe somente a quantidade entregue na remessa. O pedido passa de Aberto a Parcial e depois Recebido conforme seus itens. O recebimento trava o pedido, confere produto e custo previsto e impede ultrapassar o pendente, inclusive em entregas concorrentes. Contadores do pedido, vínculos, movimentos, saldo e auditoria são gravados na mesma transação. Entradas sem pedido continuam disponíveis por referência. Edição/cancelamento de pedidos e alterações de custo após a compra não fazem parte desta etapa.

Os testes de integração cobrem repetição concorrente, rollback, entregas concorrentes, estados do pedido e criação idempotente. O Milestone 2 só deve ser aceito no Preview após aplicar as migrations e validar esse fluxo na Vercel.

### Testes com PostgreSQL descartável no Codex Cloud

Com Docker local disponível, execute `npm run test:integration:local`. O comando cria um PostgreSQL 16 com banco `allik_test` e senha aleatória, aplica migrations pelos testes e remove o contêiner ao terminar. Não usa `DATABASE_URL` externa. O acesso ao socket local do Docker e a processos filhos deve estar permitido; o primeiro uso baixa `postgres:16-alpine`.

Para testar no navegador, instale Chromium com `npx playwright install chromium` e execute `npm run test:e2e:local`. O runner também aplica o seed sintético, inicia o servidor na porta 4317 e remove o servidor/banco ao final. Em ambientes com diretório de usuário restrito, use `PLAYWRIGHT_BROWSERS_PATH=/tmp/oi-browser-cache` tanto na instalação como na execução. A porta 4317 precisa estar livre.

## Preview na Vercel

O projeto usa o adaptador Nitro/Vercel da configuração Lovable, com frontend e API no mesmo deployment. Configure estas variáveis **somente para Preview**:

- `DATABASE_URL`: conexão PostgreSQL de Preview separada de produção.
- `INVENTORY_ENVIRONMENT=preview`.
- `INVENTORY_PREVIEW_PASSWORD`: senha longa exclusiva do Preview.
- `INVENTORY_SESSION_SECRET`: segredo aleatório exclusivo do Preview.

Para branches Neon criadas por deployment, autorize a preparação somente na branch sintética de Preview: `INVENTORY_PREPARE_PREVIEW=true` e `INVENTORY_ALLOW_SEED=true`. O build aplica migrations e seed idempotente antes de compilar, exigindo também `VERCEL_ENV=preview` e `INVENTORY_ENVIRONMENT=preview`. Sem opt-in, o build não acessa o banco; com opt-in em produção, ele falha antes de qualquer migration. O seed sintético nunca deve ser autorizado em bancos com dados reais. PRs simultâneos devem usar branches de banco isoladas. Execute `bun run test:preview-guard` para verificar as proteções.

O acesso por senha compartilhada é exclusivo de demonstração sintética. A API nega esse modo em `INVENTORY_ENVIRONMENT=production`; identidade individual, papéis e escopo de produção devem ser implementados antes de operar com dados reais. Proteção de deployment/rate limiting da Vercel pode complementar o Preview.

## Milestones

1. API + dashboard e produto com dados do PostgreSQL; migrations, ledger e Preview verificado.
2. Recebimento parcial transacional, compra, fornecedor e entrada.
3. Histórico, transferências e ajustes reais.
4. Aplicação transacional com baixa, validade e recomendação FEFO.
5. Rastreabilidade ponta a ponta e validação do fluxo completo.

O Milestone 1 só é encerrado após validar o deployment com PostgreSQL na Vercel. Testes e build locais não substituem esse aceite.

## Sincronização

Projeto Lovable: https://lovable.dev/projects/d9d8071f-e34a-4e1b-8e4d-5b845dc82c23
Não reescreva histórico publicado. A alteração do nome do repositório no GitHub e do projeto/domínio Vercel é independente do nome visível da aplicação.
