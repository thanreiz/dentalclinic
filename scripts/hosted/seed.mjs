// npm run hosted:seed
// Rebuilds and reseeds the HOSTED (Aiven) database: drops all seven tables, recreates them
// from db/schema.sql, and loads the Chapter 3 sample data. Use the day before and right after the demo.
import { spawnSync } from "node:child_process";
import { loadHostedEnv, scrub } from "./load-env.mjs";

const vars = loadHostedEnv();
if (!vars.SEED_STAFF_PASSWORD) {
  console.error("Set SEED_STAFF_PASSWORD in .env.hosted (12+ characters) first.");
  process.exit(1);
}

const r = spawnSync("npm", ["run", "db:reset", "--", "--yes"], {
  env: { ...process.env, ...vars },
  encoding: "utf8",
});
process.stdout.write(scrub(r.stdout, vars));
process.stderr.write(scrub(r.stderr, vars));
process.exit(r.status ?? 1);
