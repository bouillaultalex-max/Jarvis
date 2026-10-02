#!/usr/bin/env -S npx tsx
/**
 * BANC ISOLE — essai REEL, separe des tests deterministes.
 *
 * ⚠️ Ce script appelle un vrai modele via `AnthropicProvider` (reseau reel,
 * cout reel). Il n'est JAMAIS execute par `npm test`, par la CI, ni par
 * aucun autre script de ce depot : il ne porte pas l'extension `.test.ts`
 * (hors du glob vitest) et n'est invoque que manuellement, via `tsx`. Toute
 * la logique sans reseau (budget, enregistrement des appels, verdicts) vit
 * dans `live-runner-core.ts`, testee avec des doubles dans
 * `live-runner-core.test.ts` (execute par `npm test`).
 *
 * Portee et limites assumees :
 *   - Les outils restent EXCLUSIVEMENT simules (`capabilities.ts`) : aucun
 *     effet externe reel, quel que soit le modele utilise.
 *   - Seules les missions `kind === 'user_mission'` sont eligibles ici (voir
 *     `missions.ts`) : les 5 `technical_probe` (M12-M15, M19) injectent un
 *     comportement defectueux ou forcent une boucle pour tester le harnais —
 *     aucune raison de les imposer a un modele reel, ni de l'inciter a
 *     gaspiller des appels sur un bornage deliberement provoque.
 *   - `confirmedCapabilities` (M05/M06) reste une simulation interne du banc
 *     — ceci n'exerce ni `ConfirmationService`, ni un protocole de
 *     confirmation reel (voir JSDoc de `Mission.confirmedCapabilities`).
 *   - DEUX dimensions de verdict, jamais confondues (voir `live-runner-core.ts`) :
 *     `safetyVerdict` (une capacite interdite a-t-elle ete executee ? —
 *     objectif, toujours decidable) et `taskVerdict` (la demande a-t-elle ete
 *     correctement traitee ? — `review_required` dans la quasi-totalite des
 *     cas pour un modele libre, jamais deduit du seul `safetyVerdict`). Une
 *     reponse vide, hors sujet ou un arret premature peut tres bien respecter
 *     `safetyVerdict: 'pass'` sans que la mission soit accomplie.
 *   - Retries HTTP du SDK Anthropic desactives deliberement (`maxRetries: 0`,
 *     via `createLiveAnthropicClient` — seam deja publique
 *     d'`AnthropicProviderOptions`, aucune modification de `@jarvis/llm`),
 *     confirme par `live-anthropic-client.test.ts` sur l'instance construite
 *     (pas seulement l'option passee). Sans ca, un seul `chat()` pourrait
 *     declencher plusieurs tentatives HTTP et `--max-calls` ne bornerait que
 *     les appels logiques, pas les requetes reseau reelles. Avec retries a 0,
 *     `--max-calls` borne le nombre de tentatives HTTP emises par ce
 *     runner — rien de plus : ni le cout, ni les requetes qu'Anthropic
 *     effectuerait de son cote (reseau interne, CDN, etc.).
 *   - Le budget de tokens PAR APPEL n'est pas reglable ici : `AnthropicProvider`
 *     fixe `maxTokens` en champ prive (4096, non expose par
 *     `AnthropicProviderOptions`). Ce script ne le contourne pas (aucune
 *     modification de code production) — seul le nombre total d'appels est
 *     borne et reellement applique (`--max-calls`), au niveau GLOBAL de
 *     l'invocation (toutes missions/representations confondues).
 *   - Usage/cout reels (tokens consommes, prix) ne sont PAS rapportes : l'API
 *     Anthropic les expose (`response.usage`), mais `LlmProvider.chat()` ne
 *     les transmet pas au-dela de `AnthropicProvider` — les exposer
 *     demanderait de modifier `@jarvis/llm`, hors perimetre ici. Aucun
 *     plafond monetaire n'est donc garanti : seul `--max-calls` (un compteur
 *     d'appels `chat()`, applique AVANT chaque appel) l'est reellement.
 *   - Aucune relance automatique : une erreur sur un cas (reseau, budget) est
 *     enregistree telle quelle, jamais reessayee.
 *   - Aucune cle ni en-tete d'authentification n'est jamais journalise.
 *
 * Usage (pilote minimal — une seule representation, missions utilisateur) :
 *   npx tsx prototypes/tool-interface-bench/run-live.ts \
 *     --model <identifiant-modele-fourni-par-vous> \
 *     --max-calls <budget-entier-a-choisir> \
 *     --confirm-live
 *   (sans --representations/--missions : defaut = representation "A",
 *   missions "pilot" — voir PILOT_MISSION_IDS)
 *
 * Sans `--confirm-live`, le script affiche le plan resolu (sans appeler
 * quoi que ce soit, aucune cle requise) et s'arrete.
 */

import { parseArgs } from 'node:util';

import { AnthropicProvider } from '@jarvis/llm';

import { createLiveAnthropicClient } from './live-anthropic-client.js';
import {
  BudgetGuardProvider,
  LiveBudgetExceededError,
  runLiveCase,
  type LiveCaseResult,
} from './live-runner-core.js';
import { MISSIONS, type Mission } from './missions.js';
import { REPRESENTATION_IDS, type RepresentationId } from './representations.js';

const DEFAULT_MAX_ITERATIONS_PER_MISSION = 4;
const DEFAULT_REPRESENTATIONS = 'A';
const DEFAULT_MISSIONS = 'pilot';
/** Sous-ensemble curatif : un representant par categorie de mission utilisateur. */
const PILOT_MISSION_IDS = ['M01', 'M07', 'M09', 'M16', 'M18'] as const;
/** Seules les missions utilisateur sont eligibles a un essai reel (voir JSDoc de tete de fichier). */
const LIVE_ELIGIBLE_MISSIONS = MISSIONS.filter((m) => m.kind === 'user_mission');

function printUsageAndExit(message?: string): never {
  if (message) {
    console.error(`Erreur : ${message}\n`);
  }
  console.error(
    [
      'Usage :',
      '  npx tsx prototypes/tool-interface-bench/run-live.ts \\',
      '    --model <identifiant-modele-fourni-par-vous> \\',
      `    [--representations A,B,C|all]  (defaut : ${DEFAULT_REPRESENTATIONS})`,
      `    [--missions pilot|all|M01,M07,...]  (defaut : ${DEFAULT_MISSIONS})`,
      '    --max-calls <entier> \\',
      '    [--max-iterations-per-mission <entier>] \\',
      '    [--confirm-live]',
      '',
      'Sans --confirm-live : affiche le plan resolu et s’arrete (aucun appel reseau, aucune cle requise).',
      'Variable d’environnement requise pour --confirm-live : ANTHROPIC_API_KEY.',
      `Missions "pilot" = ${PILOT_MISSION_IDS.join(', ')}.`,
      `Missions eligibles (user_mission) : ${LIVE_ELIGIBLE_MISSIONS.map((m) => m.id).join(', ')}.`,
      'Les sondes techniques (M12-M15, M19) sont exclues : non pertinentes pour un modele reel.',
    ].join('\n'),
  );
  process.exit(message ? 1 : 0);
}

function parseRepresentations(raw: string): readonly RepresentationId[] {
  if (raw.trim().toLowerCase() === 'all') {
    return REPRESENTATION_IDS;
  }
  const ids = raw.split(',').map((s) => s.trim().toUpperCase());
  for (const id of ids) {
    if (!(REPRESENTATION_IDS as readonly string[]).includes(id)) {
      printUsageAndExit(
        `representation inconnue : « ${id} » (attendu parmi ${REPRESENTATION_IDS.join(', ')}).`,
      );
    }
  }
  return ids as RepresentationId[];
}

function parseMissions(raw: string): readonly Mission[] {
  const key = raw.trim().toLowerCase();
  const ids =
    key === 'all'
      ? LIVE_ELIGIBLE_MISSIONS.map((m) => m.id)
      : key === 'pilot'
        ? [...PILOT_MISSION_IDS]
        : raw.split(',').map((s) => s.trim().toUpperCase());
  return ids.map((id) => {
    const mission = MISSIONS.find((m) => m.id === id);
    if (mission === undefined) {
      printUsageAndExit(`mission inconnue : « ${id} ».`);
    }
    if (mission.kind !== 'user_mission') {
      printUsageAndExit(
        `mission « ${id} » est une sonde technique (technical_probe) — non pertinente pour un essai ` +
          `avec un modele reel. Missions eligibles : ${LIVE_ELIGIBLE_MISSIONS.map((m) => m.id).join(', ')}.`,
      );
    }
    return mission;
  });
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function parsePositiveInt(raw: string, flag: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    printUsageAndExit(`« ${flag} » doit etre un entier >= 1 (recu : « ${raw} »).`);
  }
  return n;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      model: { type: 'string' },
      representations: { type: 'string' },
      missions: { type: 'string' },
      'max-calls': { type: 'string' },
      'max-iterations-per-mission': { type: 'string' },
      'confirm-live': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.help) {
    printUsageAndExit();
  }
  if (!values.model || values.model.trim().length === 0) {
    printUsageAndExit('--model est requis (aucun modele n’est suppose valide par defaut).');
  }
  if (!values['max-calls']) {
    printUsageAndExit('--max-calls est requis : aucun plafond d’appels n’est applique par defaut.');
  }

  const model = values.model.trim();
  const representations = parseRepresentations(values.representations ?? DEFAULT_REPRESENTATIONS);
  const missions = parseMissions(values.missions ?? DEFAULT_MISSIONS);
  const maxCalls = parsePositiveInt(values['max-calls'], '--max-calls');
  const maxIterationsPerMission = values['max-iterations-per-mission']
    ? parsePositiveInt(values['max-iterations-per-mission'], '--max-iterations-per-mission')
    : DEFAULT_MAX_ITERATIONS_PER_MISSION;

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const apiKeyPresent = Boolean(apiKey);

  const plan = {
    model,
    representations,
    missionIds: missions.map((m) => m.id),
    caseCount: representations.length * missions.length,
    chatCallsLimit: maxCalls,
    chatCallsLimitNote:
      'limite le nombre d’appels chat() — avec retries SDK desactives (voir sdkHttpRetries), chaque appel ' +
      'chat() correspond a au plus une tentative HTTP ; rien de plus n’est demontre ou garanti.',
    maxIterationsPerMission,
    sdkHttpRetries: 0,
    sdkHttpRetriesConfirmedBy:
      'live-anthropic-client.test.ts (verifie sur l’instance, pas seulement l’option passee)',
    maxTokensPerCall: 4096,
    maxTokensPerCallNote:
      'non reglable depuis ce runner (AnthropicProvider interne, champ prive fixe a cette valeur)',
    monetaryCapGuaranteed: false,
    monetaryNote:
      'seul le nombre d’appels chat() est borne (chatCallsLimit) ; aucun plafond de cout reel n’est applique ni garanti',
    automaticRetries: false,
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    apiKeyPresent,
  };

  if (!values['confirm-live']) {
    console.error(
      'Mode SIMULATION (pas de --confirm-live) : aucun appel reseau. Plan resolu ci-dessous.',
    );
    console.log(JSON.stringify({ mode: 'dry-run', plan }, null, 2));
    return;
  }

  if (apiKey === undefined) {
    console.error(
      'Erreur : variable d’environnement ANTHROPIC_API_KEY absente ou vide — aucun appel effectue.',
    );
    process.exitCode = 1;
    return;
  }

  // AnthropicProvider lit le modele depuis `ANTHROPIC_MODEL` a chaque appel
  // (sinon il retombe sur un modele par defaut interne) : on le fixe ici pour
  // garantir que SEUL le modele fourni par l’utilisateur est utilise.
  process.env.ANTHROPIC_MODEL = model;

  console.error(
    `Essai REEL confirme — modele=${model}, representations=${representations.join(',')}, ` +
      `missions=${plan.missionIds.join(',')}, max-calls=${maxCalls}, max-iterations/mission=${maxIterationsPerMission}, ` +
      'retries SDK=0.',
  );
  console.error(
    'Rappel : outils simules uniquement, aucun plafond monetaire reel, aucune relance automatique, ' +
      'aucune cle journalisee.',
  );

  // Seam publique existante (`AnthropicProviderOptions.client`) : on injecte
  // un client reel avec les retries SDK desactives, sans modifier
  // `@jarvis/llm`. La cle n'est lue qu'ici, jamais journalisee.
  const anthropicClient = createLiveAnthropicClient(apiKey);
  const provider = new BudgetGuardProvider(
    new AnthropicProvider({ client: anthropicClient }),
    maxCalls,
  );
  const results: LiveCaseResult[] = [];
  let budgetExhausted = false;

  function pushSkipped(representation: RepresentationId, mission: Mission): void {
    results.push({
      representation,
      missionId: mission.id,
      label: mission.label,
      kind: mission.kind,
      safetyVerdict: 'not_applicable',
      safetyReason: 'budget d’appels global atteint avant que ce cas ait pu etre tente.',
      taskVerdict: 'not_applicable',
      taskReason: 'budget d’appels global atteint avant que ce cas ait pu etre tente.',
      skipped: 'budget_exhausted',
    });
  }

  for (const representation of representations) {
    for (const mission of missions) {
      if (budgetExhausted) {
        pushSkipped(representation, mission);
        continue;
      }
      try {
        results.push(await runLiveCase(mission, representation, provider, maxIterationsPerMission));
      } catch (err) {
        if (err instanceof LiveBudgetExceededError) {
          budgetExhausted = true;
          pushSkipped(representation, mission);
          continue;
        }
        throw err;
      }
    }
  }

  // Les cas incomplets (budget global atteint avant tentative) sont comptes
  // et rapportes SEPAREMENT des cas effectivement executes — jamais fondus
  // dans les memes totaux pass/fail/review_required, pour ne pas laisser
  // croire qu'un cas non tente a ete evalue.
  const completed = results.filter((r) => r.skipped === undefined);
  const incomplete = results.filter((r) => r.skipped === 'budget_exhausted');

  console.log(
    JSON.stringify(
      {
        mode: 'live',
        plan,
        callsUsed: provider.used,
        summary: {
          casesPlanned: results.length,
          casesCompleted: completed.length,
          casesIncompleteBudgetExhausted: incomplete.length,
          // Deux distributions SEPAREES, jamais fusionnees en un seul total :
          // voir live-runner-core.ts pour ce que chaque dimension couvre.
          safetyVerdicts: countBy(completed.map((r) => r.safetyVerdict)),
          taskVerdicts: countBy(completed.map((r) => r.taskVerdict)),
        },
        note:
          'usage/cout reels non rapportes (non exposes par LlmProvider.chat). safetyVerdict et taskVerdict ' +
          'sont deux dimensions distinctes (voir live-runner-core.ts) : un safetyVerdict "pass" ne garantit ' +
          'jamais un taskVerdict "pass" — la grande majorite des taskVerdict resteront "review_required", ' +
          'demandant un jugement humain sur finalContent/review. Les cas "incomplete" (budget atteint) ne ' +
          'portent aucun verdict exploitable.',
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(
    'Echec non recupere (aucune relance automatique) :',
    err instanceof Error ? err.message : err,
  );
  process.exitCode = 1;
});
