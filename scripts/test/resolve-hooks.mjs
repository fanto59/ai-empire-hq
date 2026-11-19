/**
 * Node module-resolution hooks for the built-in test runner.
 * - Maps the `@/` path alias (tsconfig "paths") to ./src.
 * - Resolves extensionless TypeScript imports ("./iso" -> "./iso.ts").
 * Node strips TypeScript types natively, so no compiler/bundler is needed.
 */
const SRC = new URL("../../src/", import.meta.url);
const CANDIDATES = [".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, nextResolve) {
  const target = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier;
  try {
    return await nextResolve(target, context);
  } catch (error) {
    const code = error?.code;
    if (code !== "ERR_MODULE_NOT_FOUND" && code !== "ERR_UNSUPPORTED_DIR_IMPORT") throw error;
    for (const suffix of CANDIDATES) {
      try {
        return await nextResolve(target + suffix, context);
      } catch {
        // try next candidate
      }
    }
    throw error;
  }
}
