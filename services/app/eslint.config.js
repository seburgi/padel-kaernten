import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// burgstaller-platform standards/quality/typescript-checks.md: recommended
// rules, react-hooks, unused names as errors (a leading _ excepted), and the
// slices kept apart. The generated API types are left out.
export default tseslint.config(
  { ignores: ["dist", "coverage", "src/api/schema.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/courts/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "../invitations/*",
            "../whatsnew/*",
            "../groups/*",
            "../availability/*",
            "../games/*",
          ],
        },
      ],
    },
  },
  {
    files: ["src/invitations/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "../courts/*",
            "../whatsnew/*",
            "../groups/*",
            "../availability/*",
            "../games/*",
          ],
        },
      ],
    },
  },
  {
    files: ["src/whatsnew/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "../courts/*",
            "../invitations/*",
            "../groups/*",
            "../availability/*",
            "../games/*",
          ],
        },
      ],
    },
  },
  {
    files: ["src/groups/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "../courts/*",
            "../invitations/*",
            "../whatsnew/*",
            "../availability/*",
            "../games/*",
          ],
        },
      ],
    },
  },
  {
    files: ["src/availability/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "../courts/*",
            "../invitations/*",
            "../whatsnew/*",
            "../groups/*",
            "../games/*",
          ],
        },
      ],
    },
  },
  {
    files: ["src/games/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "../courts/*",
            "../invitations/*",
            "../whatsnew/*",
            "../groups/*",
            "../availability/*",
          ],
        },
      ],
    },
  },
  {
    files: ["src/sw.ts"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // The agents' browser script (CLAUDE.md): Node, with functions that
    // Playwright runs inside the page.
    files: ["tools/**/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["vite.config.ts", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
);
