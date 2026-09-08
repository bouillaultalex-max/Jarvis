import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // Informatif uniquement — aucun seuil : la baseline réelle est le
      // résultat, pas un objectif à atteindre artificiellement (OUT-05).
    },
  },
});
