import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "public/**"] },
  {
    files: ["src/**/*.js"],
    languageOptions: { globals: globals.browser, sourceType: "module" },
    rules: {
      ...js.configs.recommended.rules,
      "no-console": "warn",
      "no-unused-vars": ["error", { caughtErrors: "none" }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "tools/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { globals: globals.node, sourceType: "module" },
    rules: js.configs.recommended.rules,
  },
];
