import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  migrations: { prefix: "unix" },
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://optio:optio_dev@localhost:5432/optio",
  },
});
