import { defineConfig } from "drizzle-kit";

// Used only by `npm run db:generate` to turn schema.ts into SQL migrations.
// No database connection is needed to generate migrations.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/db/schema.ts",
  out: "./drizzle",
  strict: true,
});
