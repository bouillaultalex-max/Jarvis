// @ts-check
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

/**
 * packages/legal-case-engine (LEGAL-04.1) — règles de frontières, décision D1 : la SEULE
 * dépendance est `@jarvis/legal-core`, par son point d'entrée public. ESLint ne fusionne pas
 * les options d'une même règle entre deux blocs qui visent le même fichier (le dernier
 * l'emporte) : chaque bloc de profondeur reçoit donc la liste complète, construite ici.
 *
 * @param {string} escapeRegex import relatif qui SORT de `src/` pour cette profondeur de fichier
 */
function legalCaseEngineBoundaryRules(escapeRegex) {
  return {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@jarvis/*', '!@jarvis/legal-core'],
            message:
              '@jarvis/legal-case-engine ne dépend que de @jarvis/legal-core (décision D1 de LEGAL-04) : aucun autre package @jarvis/*.',
          },
          {
            group: ['@jarvis/legal-core/*', '@jarvis/legal-core/**'],
            message:
              "Import profond interdit : @jarvis/legal-case-engine n'utilise que le point d'entrée public de @jarvis/legal-core (aucun sous-chemin, aucune fixture de test).",
          },
          {
            regex: escapeRegex,
            message:
              "Import relatif sortant interdit : le code d'@jarvis/legal-case-engine n'importe que depuis src/ (aucun contournement de D1 par un chemin relatif vers un autre package).",
          },
        ],
      },
    ],
    // Un chargement dynamique échappe à l'analyse statique des frontières : le moteur n'en a
    // aucun besoin (import(), require, `import x = require()`, types `import('…')`).
    'no-restricted-syntax': [
      'error',
      {
        selector: 'ImportExpression',
        message:
          'Import dynamique interdit dans @jarvis/legal-case-engine (contournerait les règles de frontières).',
      },
      {
        selector: "CallExpression[callee.name='require']",
        message:
          'require() interdit dans @jarvis/legal-case-engine (imports statiques uniquement).',
      },
      {
        selector: 'TSExternalModuleReference',
        message:
          '`import x = require(...)` interdit dans @jarvis/legal-case-engine (imports statiques uniquement).',
      },
      {
        selector: 'TSImportType',
        message:
          "Type `import('…')` interdit dans @jarvis/legal-case-engine : utiliser `import type` (analysable).",
      },
    ],
  };
}

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
            {
              name: '@jarvis/legal-core',
              message:
                'LEGAL-02B.2 : LegifranceConnector reste un connecteur technique — jamais de dépendance vers le modèle juridique (LegalCase/LegalSource/LegalCitation). Cette transformation appartient au futur LegalSourceProvider.',
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
    // packages/connectors/src/legifrance : LegifranceConnector (LEGAL-02B.2) ne doit jamais
    // manipuler SecretStore/credentials directement — l'authentification appartient
    // entièrement à @jarvis/legifrance-client (AccessTokenProvider), reçue déjà résolue via
    // le `LegifranceHttpClient` injecté dans `createTools(client)`.
    files: ['packages/connectors/src/legifrance/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/secret-store.js', '**/secret-store'],
              message:
                'LegifranceConnector ne doit jamais accéder à SecretStore directement — voir @jarvis/legifrance-client.',
            },
          ],
        },
      ],
    },
  },

  {
    // packages/legal-core : modèle juridique pur, feuille (comme @jarvis/types/@jarvis/llm/@jarvis/memory) —
    // jamais de réseau, jamais de connaissance de Légifrance/PISTE (voir legal-case.ts, en-tête de fichier).
    files: ['packages/legal-core/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@jarvis/*'],
              message:
                '@jarvis/legal-core est une feuille : aucune dépendance vers un autre package @jarvis/*, en particulier @jarvis/connectors et @jarvis/legifrance-client (aucun réseau, aucun OAuth dans le modèle juridique).',
            },
          ],
        },
      ],
    },
  },

  {
    // packages/legal-case-engine : moteur de faits et de dossiers (LEGAL-04.1) — au-dessus de
    // @jarvis/legal-core, dont il est le SEUL @jarvis/* autorisé (décision D1) : ni llm, ni memory,
    // ni core, ni connectors, ni legal-research, ni application. Fichiers de `src/` (profondeur 0) :
    // tout `../` sort de `src/`.
    files: ['packages/legal-case-engine/src/*.ts'],
    rules: legalCaseEngineBoundaryRules('^\\.\\./'),
  },
  {
    // Même règle pour les sous-dossiers de `src/` (aujourd'hui `testing/`, profondeur 1) :
    // `../` reste dans `src/` (ex. `../engine-context.js`), `../../` en sort.
    files: ['packages/legal-case-engine/src/*/**/*.ts'],
    rules: legalCaseEngineBoundaryRules('^\\.\\./\\.\\./'),
  },

  {
    // packages/legal-research : Provider juridique au-dessus du Connector (LEGAL-02B.3) —
    // ne dépend que de @jarvis/core (ToolExecutor, injecté — jamais contourné) et
    // @jarvis/legal-core (LegalSource/LegalCitation). Ne connaît ni SecretStore, ni
    // LegifranceHttpClient/AccessTokenProvider, ni ConnectorRegistry, ni le réseau — même
    // le typage de la sortie du Tool reste `unknown`, validé sur place (voir
    // legifrance-source-mapping.ts).
    files: ['packages/legal-research/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@jarvis/legifrance-client',
              message:
                '@jarvis/legal-research ne doit jamais contourner ToolExecutor/le Connector pour parler directement à Légifrance.',
            },
            {
              name: '@jarvis/connectors',
              message:
                '@jarvis/legal-research ne doit jamais dépendre de @jarvis/connectors (SecretStore, ConnectorRegistry) — seul ToolExecutor (@jarvis/core) est autorisé pour exécuter une action.',
            },
            {
              name: '@jarvis/classification',
              message: '@jarvis/legal-research ne doit pas dépendre de la logique métier générale.',
            },
            {
              name: '@jarvis/inbox',
              message: '@jarvis/legal-research ne doit pas dépendre de @jarvis/inbox.',
            },
            {
              name: '@jarvis/tools',
              message: '@jarvis/legal-research ne doit pas dépendre de @jarvis/tools.',
            },
            {
              name: '@jarvis/memory',
              message:
                '@jarvis/legal-research ne doit pas dépendre de @jarvis/memory (mémoire générale, étanche du juridique).',
            },
            {
              name: '@jarvis/api',
              message: "@jarvis/legal-research ne doit pas dépendre d'une app.",
            },
            {
              name: '@jarvis/desktop',
              message: "@jarvis/legal-research ne doit pas dépendre d'une app.",
            },
          ],
        },
      ],
    },
  },

  {
    // packages/legifrance-client : couche transport/authentification PISTE (LEGAL-02B.1) —
    // ne dépend que de @jarvis/connectors (SecretStore/AccessTokenProvider), jamais de la
    // logique métier juridique ni d'une app.
    files: ['packages/legifrance-client/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@jarvis/legal-core',
              message:
                '@jarvis/legifrance-client reste transport/auth pur : aucune connaissance du modèle juridique.',
            },
            {
              name: '@jarvis/core',
              message: '@jarvis/legifrance-client ne doit pas dépendre de @jarvis/core.',
            },
            {
              name: '@jarvis/classification',
              message: '@jarvis/legifrance-client ne doit pas dépendre de la logique métier.',
            },
            {
              name: '@jarvis/inbox',
              message: '@jarvis/legifrance-client ne doit pas dépendre de @jarvis/inbox.',
            },
            {
              name: '@jarvis/tools',
              message: '@jarvis/legifrance-client ne doit pas dépendre de @jarvis/tools.',
            },
            {
              name: '@jarvis/api',
              message: "@jarvis/legifrance-client ne doit pas dépendre d'une app.",
            },
            {
              name: '@jarvis/desktop',
              message: "@jarvis/legifrance-client ne doit pas dépendre d'une app.",
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
