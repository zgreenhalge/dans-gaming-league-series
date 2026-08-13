import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/api/**/*.{ts,js}"],
    rules: {
      // getAdminClient() must be called inside a route handler, not bound at module scope: ES
      // module imports are hoisted, so a module-scope call resolves before a route.test.ts's
      // __setTestAdminClient() override can ever run, leaving the route bound to the real client.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program > VariableDeclaration > VariableDeclarator[init.callee.name='getAdminClient']",
          message: "Call getAdminClient() inside the route handler body, not at module scope (see src/lib/supabase-admin.ts).",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
