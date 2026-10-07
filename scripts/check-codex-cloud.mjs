import { Pool } from "pg";

async function check() {
  const required = [
    "DATABASE_URL",
    "INVENTORY_ENVIRONMENT",
    "INVENTORY_PREVIEW_PASSWORD",
    "INVENTORY_SESSION_SECRET",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Configure no ambiente: ${missing.join(", ")}.`);
    return false;
  }
  if (!["development", "test"].includes(process.env.INVENTORY_ENVIRONMENT)) {
    console.error("Use INVENTORY_ENVIRONMENT=development ou test no Codex Cloud.");
    return false;
  }
  if (
    process.env.INVENTORY_PREVIEW_PASSWORD.length < 12 ||
    process.env.INVENTORY_SESSION_SECRET.length < 32
  ) {
    console.error("A senha precisa de 12 caracteres e o segredo de sessão de 32, no mínimo.");
    return false;
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  try {
    await pool.query("SELECT 1");
    const result = await pool.query("SELECT to_regclass('public.inventory_products') AS products");
    console.log("Conexão PostgreSQL funcionando.");
    if (!result.rows[0].products) {
      console.error(
        "Schema de estoque ausente. Execute db:migrate apenas no banco isolado de desenvolvimento.",
      );
      return false;
    }
    console.log(
      "Tabela de produtos encontrada. Continue com os testes de integração e a validação do estoque.",
    );
    return true;
  } catch {
    console.error(
      "Não foi possível verificar o PostgreSQL. Confira DATABASE_URL e o acesso de rede do ambiente.",
    );
    return false;
  } finally {
    await pool.end();
  }
}

process.exitCode = (await check()) ? 0 : 1;
