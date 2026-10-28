import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Git worktrees live under .claude/worktrees/ and carry their own full copy
    // of tests/. Vitest's default glob walks them, so every worktree silently
    // adds a duplicate run of a frozen checkout's suite to `npm test`.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
