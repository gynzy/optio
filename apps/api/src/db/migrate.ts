/**
 * Standalone migration runner — applies all Drizzle migrations to the database
 * specified by DATABASE_URL. Used by CI to validate that migrations apply cleanly
 * to a fresh Postgres instance.
 *
 * Usage:  tsx src/db/migrate.ts
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./client.js";
import { migrateSafe } from "./migrate-safe.js";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "migrations");

try {
  const applied = await migrateSafe(db, migrationsFolder);
  console.log(`Migrations applied successfully (${applied} new).`);
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
}

// Close the connection pool — db.execute uses the shared pool from client.ts
// which doesn't auto-close. Use a dynamic import to access the underlying sql instance.
process.exit(0);
