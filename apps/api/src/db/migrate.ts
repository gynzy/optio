/**
 * Standalone migration runner — applies all Drizzle migrations to the database
 * specified by DATABASE_URL. Used by CI to validate that migrations apply cleanly
 * to a fresh Postgres instance.
 *
 * Usage:  tsx src/db/migrate.ts
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://optio:optio_dev@localhost:5432/optio";

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "migrations");

try {
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied successfully.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
