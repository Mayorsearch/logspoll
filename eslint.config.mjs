import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import next from "@next/eslint-plugin-next";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
export default defineConfig([
  js.configs.recommended,
  ...ts.configs.recommended,
  next.configs["core-web-vitals"],
  hooks.configs.flat.recommended,
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "next-env.d.ts",
    "test-results/**",
    "playwright-report/**",
  ]),
]);
