import { readFile } from "node:fs/promises";
import js from "@eslint/js";
import { Linter } from "eslint";
import globals from "globals";

const html = await readFile("index.html", "utf8");
const scripts = [
  ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
];
if (!scripts.length) throw new Error("index.html has no inline script to lint");

const linter = new Linter({ configType: "flat" });
let failed = false;
for (const [index, match] of scripts.entries()) {
  const messages = linter.verify(match[1], {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: globals.browser,
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { caughtErrors: "none" }],
    },
  });
  for (const message of messages) {
    failed = true;
    console.error(
      `index.html inline script ${index + 1}:${message.line}:${message.column} ${message.message} (${message.ruleId ?? "parse"})`,
    );
  }
}
if (failed) process.exit(1);
console.log(
  `Linted ${scripts.length} inline script${scripts.length === 1 ? "" : "s"}.`,
);
