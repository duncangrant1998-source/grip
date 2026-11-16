/**
 * Applies the SQL files in ./migrations in filename order, once each.
 *
 * Runs on the OWNER connection, which bypasses row-level security — that is
 * the point: migrations must be able to touch every tenant. The application
 * never uses this connection.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

async function main() {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set");

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sql`CREATE SCHEMA IF NOT EXISTS grip`;
    await sql`
      CREATE TABLE IF NOT EXISTS grip.schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`;

    const applied = new Set(
      (await sql<{ filename: string }[]>`SELECT filename FROM grip.schema_migrations`)
        .map((r) => r.filename),
    );

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file}`);
        continue;
      }
      const body = readFileSync(join(migrationsDir, file), "utf8");
      process.stdout.write(`  apply ${file} ... `);
      // Each migration is one transaction: it lands whole or not at all.
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO grip.schema_migrations (filename) VALUES (${file})`;
      });
      console.log("ok");
      ran++;
    }

    console.log(ran === 0 ? "Already up to date." : `Applied ${ran} migration(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message ?? err);
  process.exit(1);
});
