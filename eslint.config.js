// @ts-check
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '.claude/**',
      '.claude-flow/**',
      '.swarm/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // Le dépôt utilise déjà `unknown` + validation explicite aux frontières
      // (voir Tool.validateInput) plutôt que des types stricts partout ;
      // ne pas forcer une réécriture pour ça dans cette passe d'outillage.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // --- OUT-04 : frontières architecturales entre workspaces --------------
  // Transforme en check automatisé les invariants de dépendances déjà
  // vérifiés dans le code (voir étude OUT-04) : chaque bloc n'autorise que
  // les imports `@jarvis/*` réellement observés pour ce workspace, et
  // interdit explicitement les autres. `@typescript-eslint/no-restricted-imports`
  // (déjà fourni par `typescript-eslint`, aucune dépendance ajoutée) est
  // utilisé plutôt que la règle ESLint de base afin de pouvoir distinguer
  // un import runtime (interdit) d'un `import type`/`export type` (autorisé
  // via `allowTypeImports: true` sur les entrées qui l'exigent).

  {
    // packages/types : feuille pure, ne doit dépendre d'aucun autre @jarvis/*.
    files: ['packages/types/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@jarvis/*'],
              message:
                '@jarvis/types est une feuille : aucune dépendance vers un autre package @jarvis/*.',
            },
          ],
        },
      ],
    },
  },

  {
    // packages/llm : abstraction LLM, feuille pure (comme @jarvis/types).
    files: ['packages/llm/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@jarvis/*'],
              message:
                '@jarvis/llm est une feuille : aucune dépendance vers un autre package @jarvis/*.',
            },
          ],
        },
      ],
    },
  },

  {
    // packages/memory : fondation mémoire contrôlée, feuille pure (comme @jarvis/types
    // et @jarvis/llm) ; consommée par @jarvis/core, jamais l'inverse.
    files: ['packages/memory/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@jarvis/*'],
              message:
                '@jarvis/memory est une feuille : aucune dépendance vers un autre package @jarvis/*.',
            },
          ],
        },
      ],
    },
  },

  {
    // packages/core : moteur générique (Tool/PermissionManager/ToolExecutor/AgentLoop) ;
    // ne connaît jamais les connecteurs ni la logique métier (PROJECT_STATE.md).
    // @jarvis/llm est référencé uniquement en `import type`/`export type`
    // (aucune dépendance d'exécution sur @anthropic-ai/sdk) : autorisé via allowTypeImports.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@jarvis/connectors',
              message: '@jarvis/core ne doit jamais connaître les connecteurs.',
            },
            {
              name: '@jarvis/tools',
              message: '@jarvis/core ne doit jamais dépendre de @jarvis/tools.',
            },
            {
              name: '@jarvis/classification',
              message: '@jarvis/core ne doit jamais dépendre de la logique métier.',
            },
            {
              name: '@jarvis/inbox',
              message: '@jarvis/core ne doit jamais dépendre de @jarvis/inbox.',
            },
            { name: '@jarvis/api', message: "@jarvis/core ne doit jamais dépendre d'une app." },
            { name: '@jarvis/desktop', message: "@jarvis/core ne doit jamais dépendre d'une app." },
            {
              name: '@jarvis/llm',
              message:
                "@jarvis/core ne peut référencer @jarvis/llm qu'en `import type`/`export type` (aucune dépendance d'exécution).",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },

  {
    // packages/connectors : infra générique (Gmail, AccountStore, SecretStore) ;
    // ne doit pas connaître la logique métier ni les apps.
    files: ['packages/connectors/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@jarvis/classification',
              message: '@jarvis/connectors ne doit pas dépendre de la logique métier.',
            },
            {
              name: '@jarvis/inbox',
              message: '@jarvis/connectors ne doit pas dépendre de @jarvis/inbox.',
            },
            {
              name: '@jarvis/tools',
              message: '@jarvis/connectors ne doit pas dépendre de @jarvis/tools.',
            },
            { name: '@jarvis/api', message: "@jarvis/connectors ne doit pas dépendre d'une app." },
            {
              name: '@jarvis/desktop',
              message: "@jarvis/connectors ne doit pas dépendre d'une app.",
            },
          ],
        },
      ],
    },
  },

  {
    // packages/tools : outils génériques, sibling de connectors (pas un consommateur).
    files: ['packages/tools/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@jarvis/connectors',
              message: '@jarvis/tools ne doit pas dépendre de @jarvis/connectors.',
            },
            {
              name: '@jarvis/classification',
              message: '@jarvis/tools ne doit pas dépendre de la logique métier.',
            },
            {
              name: '@jarvis/inbox',
              message: '@jarvis/tools ne doit pas dépendre de @jarvis/inbox.',
            },
            { name: '@jarvis/api', message: "@jarvis/tools ne doit pas dépendre d'une app." },
            { name: '@jarvis/desktop', message: "@jarvis/tools ne doit pas dépendre d'une app." },
          ],
        },
      ],
    },
  },

  {
    // packages/classification : logique métier pure, aucune dépendance d'exécution
    // sur @anthropic-ai/sdk (llm) ni sur @jarvis/types au-delà du typage.
    files: ['packages/classification/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@jarvis/core',
              message: '@jarvis/classification ne doit pas dépendre de @jarvis/core.',
            },
            {
              name: '@jarvis/connectors',
              message: '@jarvis/classification ne doit pas dépendre de @jarvis/connectors.',
            },
            {
              name: '@jarvis/tools',
              message: '@jarvis/classification ne doit pas dépendre de @jarvis/tools.',
            },
            {
              name: '@jarvis/inbox',
              message: '@jarvis/classification ne doit pas dépendre de @jarvis/inbox.',
            },
            {
              name: '@jarvis/api',
              message: "@jarvis/classification ne doit pas dépendre d'une app.",
            },
            {
              name: '@jarvis/desktop',
              message: "@jarvis/classification ne doit pas dépendre d'une app.",
            },
            {
              name: '@jarvis/llm',
              message:
                "@jarvis/classification ne peut référencer @jarvis/llm qu'en `import type` (aucune dépendance d'exécution).",
              allowTypeImports: true,
            },
            {
              name: '@jarvis/types',
              message:
                "@jarvis/classification ne peut référencer @jarvis/types qu'en `import type`.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },

  {
    // packages/inbox (production) : orchestration connector-agnostique ; @jarvis/connectors
    // n'est qu'une devDependency de test (voir bloc *.test.ts ci-dessous), jamais en prod.
    files: ['packages/inbox/src/**/*.ts'],
    ignores: ['packages/inbox/src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@jarvis/api', message: "@jarvis/inbox ne doit pas dépendre d'une app." },
            { name: '@jarvis/desktop', message: "@jarvis/inbox ne doit pas dépendre d'une app." },
            {
              name: '@jarvis/connectors',
              message:
                '@jarvis/connectors est une devDependency de test pour @jarvis/inbox : interdit en dehors des fichiers *.test.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    // packages/inbox (tests) : @jarvis/connectors autorisé (devDependency) pour prouver
    // l'intégration avec un connecteur réel ; les apps restent interdites.
    files: ['packages/inbox/src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@jarvis/api', message: "@jarvis/inbox ne doit pas dépendre d'une app." },
            { name: '@jarvis/desktop', message: "@jarvis/inbox ne doit pas dépendre d'une app." },
          ],
        },
      ],
    },
  },

  {
    // apps/api et apps/desktop : apps terminales indépendantes, jamais l'une de l'autre.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@jarvis/desktop',
              message: 'apps/api ne doit jamais dépendre de apps/desktop.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/desktop/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@jarvis/api', message: 'apps/desktop ne doit jamais dépendre de apps/api.' },
          ],
        },
      ],
    },
  },
);
