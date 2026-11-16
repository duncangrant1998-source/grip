/**
 * Sets (or rotates) the password on the restricted `grip_app` role.
 *
 * Migration 0001 creates `grip_app` with LOGIN but no password — baking a
 * password into a checked-in SQL file would put it in git history. This runs
 * on the OWNER connection, after migrations, as a build step, reading the
 * password from an environment variable that is never committed.
 */
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const ownerUrl = process.env.DATABASE_URL_OWNER;
  if (!ownerUrl) throw new Error("DATABASE_URL_OWNER is not set");

  const password = process.env.GRIP_APP_DB_PASSWORD;
  if (!password) {
    console.log("GRIP_APP_DB_PASSWORD not set — skipping (grip_app password left as-is).");
    return;
  }

  const sql = postgres(ownerUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.unsafe(`ALTER ROLE grip_app WITH PASSWORD '${password.replace(/'/g, "''")}'`);
    console.log("grip_app password set.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\nSetting grip_app password failed:", err.message ?? err);
  process.exit(1);
});
