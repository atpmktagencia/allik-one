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

Product, Location, Lot e StockMovement persistem no PostgreSQL. StockBalance é uma projeção do ledger, atualizada por trigger na mesma transação. UPDATE/DELETE de movimentações e auditoria são rejeitados; alteração direta de saldo também é rejeitada. A constraint de saldo não negativo protege concorrência. Aplicações e recebimentos continuam identificados como demonstração, com confirmação desabilitada, até seus milestones.

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
