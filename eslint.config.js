// The tools get the type-aware rules: they parse files a person wrote, so an
// `any` that leaks out of JSON.parse is a real bug there. The tests get the
// plain recommended rules, since they poke at those same values on purpose.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["device-apps/", "device/.pio/", "tools/lib/gfx-font-data.ts"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ["tools/**/*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  { files: ["tools/sim-panel/**/*.js"], languageOptions: { globals: globals.browser } },
);
