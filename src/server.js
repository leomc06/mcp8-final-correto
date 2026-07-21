import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pg from "pg";
import { z } from "zod";

const { Pool } = pg;

const requiredVariables = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "MCP_READER_PASSWORD"];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    console.error(`Variável obrigatória ausente: ${variable}`);
    process.exit(1);
  }
}

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.MCP_READER_PASSWORD,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  application_name: "mcp-postgres-local",
});

const server = new McpServer({ name: "postgres-local", version: "1.0.0" });

function success(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function failure(error) {
  console.error("Erro na ferramenta MCP:", error);
  const code = error?.code ? ` Código: ${error.code}.` : "";
  return {
    content: [{ type: "text", text: `Não foi possível consultar o PostgreSQL.${code}` }],
    isError: true,
  };
}

server.registerTool(
  "status_banco",
  {
    title: "Status do PostgreSQL",
    description: "Verifica a conexão com o banco PostgreSQL.",
    inputSchema: {},
  },
  async () => {
    try {
      const result = await pool.query(`
        SELECT current_database() AS banco, current_user AS usuario, NOW() AS horario
      `);
      return success({ conectado: true, ...result.rows[0] });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "listar_clientes",
  {
    title: "Listar clientes",
    description: "Lista clientes cadastrados no PostgreSQL.",
    inputSchema: {
      limite: z.number().int().min(1).max(100).default(20),
      somenteAtivos: z.boolean().default(true),
    },
  },
  async ({ limite, somenteAtivos }) => {
    try {
      const result = await pool.query(
        `
          SELECT id, nome, email, ativo, criado_em
          FROM clientes
          WHERE ($1::boolean = FALSE OR ativo = TRUE)
          ORDER BY id
          LIMIT $2
        `,
        [somenteAtivos, limite],
      );
      return success({ quantidade: result.rowCount, clientes: result.rows });
    } catch (error) {
      return failure(error);
    }
  },
);

server.registerTool(
  "buscar_cliente_por_email",
  {
    title: "Buscar cliente por e-mail",
    description: "Procura um cliente pelo e-mail exato.",
    inputSchema: { email: z.string().email() },
  },
  async ({ email }) => {
    try {
      const result = await pool.query(
        `SELECT id, nome, email, ativo, criado_em FROM clientes WHERE email = $1`,
        [email],
      );
      return success({ encontrado: result.rowCount > 0, cliente: result.rows[0] ?? null });
    } catch (error) {
      return failure(error);
    }
  },
);

async function shutdown() {
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await pool.query("SELECT 1");
} catch (error) {
  console.error("Não foi possível conectar ao PostgreSQL:", error?.code ?? error);
  await pool.end().catch(() => {});
  process.exit(1);
}

const transport = new StdioServerTransport();
await server.connect(transport);
