import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Architecture guard: frontend code must never import backend, agent
  // runtime, or infrastructure modules directly (they may hold secrets).
  // Shared contracts live in src/domain and src/agents/events.
  {
    files: ["src/frontend/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/backend/*", "@/infrastructure/*", "@/agents/providers/*"],
              message:
                "Frontend code may not import backend, infrastructure, or provider modules. Use src/domain or src/agents/events contracts instead.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
