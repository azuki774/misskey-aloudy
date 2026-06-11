import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import astroeslint from "eslint-plugin-astro";

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...astroeslint.configs.recommended,
  {
    ignores: ["dist/", "node_modules/", ".astro/", ".worktrees/"],
  },
  {
    files: ["astro.config.mjs", "tailwind.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly",
      },
    },
  },
];
