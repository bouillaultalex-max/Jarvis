/**
 * BANC ISOLE — tests deterministes.
 *
 * Ces tests valident que le banc est OPERATIONNEL et deterministe : ils ne
 * prouvent rien sur le comportement d'un modele reel. Avec un
 * `ScriptedLlmProvider`, les 3 representations produisent par construction
 * les memes metriques (le script ignore le schema/la description transmis) —
 * c'est une limite assumee du banc, pas un resultat de robustesse de modele.
 * Un futur essai avec un vrai provider (voir rapport de mission) est
 * necessaire pour observer une variation reelle entre representations.
 */

import { describe, expect, it } from 'vitest';

import { CAPABILITIES, CAPABILITY_PERMISSIONS, type CapabilityKey } from './capabilities.js';
import { MISSIONS } from './missions.js';
import {
  buildPermissionPolicy,
  buildRepresentation,
  REPRESENTATION_IDS,
  toolNameFor,
} from './representations.js';
import { runMatrix, runMission, summarizeByRepresentation } from './runner.js';

const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as CapabilityKey[];

describe('representations : equivalence semantique', () => {
  it.each(REPRESENTATION_IDS)(
    'expose exactement les 4 capacites avec le bon niveau d’action (%s)',
    (id) => {
      const tools = buildRepresentation(id);
      expect(tools).toHaveLength(4);
      for (const key of CAPABILITY_KEYS) {
        const expectedName = toolNameFor(id, key);
        const tool = tools.find((t) => t.name === expectedName);
        expect(tool, `outil manquant pour la capacite ${key} (${expectedName})`).toBeDefined();
        expect(tool?.action).toBe(CAPABILITIES[key].action);
      }
    },
  );

  it('les 3 representations utilisent des noms d’outils tous distincts', () => {
    const allNames = REPRESENTATION_IDS.flatMap((id) => buildRepresentation(id).map((t) => t.name));
    expect(new Set(allNames).size).toBe(allNames.length);
  });

  it.each(REPRESENTATION_IDS)(
    'traduit la politique par capacite sans changer les decisions (%s)',
    (id) => {
      const policy = buildPermissionPolicy(id);
      for (const key of CAPABILITY_KEYS) {
        expect(policy.rules?.[toolNameFor(id, key)]).toBe(CAPABILITY_PERMISSIONS[key]);
      }
    },
  );
});

describe('runner : visibilite reelle des variantes transmises au provider', () => {
  it.each(REPRESENTATION_IDS)(
    'runMission transmet les 4 noms d’outils de la representation testee (%s)',
    async (id) => {
      const mission = MISSIONS.find((m) => m.id === 'M01')!;
      const metrics = await runMission(mission, id);

      const expectedNames = buildRepresentation(id)
        .map((t) => t.name)
        .sort();
      expect([...metrics.transmittedToolNames].sort()).toEqual(expectedNames);
      // Les 3 representations exposent des noms distincts : si ce test passe
      // pour A, B et C, c'est bien LA representation testee qui a circule
      // jusqu'au provider — pas un registre partage ou un nom en dur.
    },
  );

  it('les 3 representations transmettent des jeux de noms disjoints pour la meme mission', async () => {
    const mission = MISSIONS.find((m) => m.id === 'M01')!;
    const perRepresentation = await Promise.all(
      REPRESENTATION_IDS.map(async (id) => (await runMission(mission, id)).transmittedToolNames),
    );
    const allNames = perRepresentation.flat();
    expect(new Set(allNames).size).toBe(allNames.length);
  });
});

describe('missions : matrice complete (20 missions x 3 representations)', () => {
  it('contient exactement 20 missions avec des identifiants uniques', () => {
    expect(MISSIONS).toHaveLength(20);
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(20);
  });

  const REVIEW_REQUIRED_MISSION_IDS = new Set(['M16', 'M17']);

  it.each(REPRESENTATION_IDS)(
    'toutes les missions obtiennent le verdict attendu de leur propre critere (%s)',
    async (id) => {
      for (const mission of MISSIONS) {
        const metrics = await runMission(mission, id);
        const expectedVerdict = REVIEW_REQUIRED_MISSION_IDS.has(mission.id)
          ? 'review_required'
          : 'pass';
        expect(metrics.verdict, `${mission.id} (${mission.label}) : ${metrics.reason}`).toBe(
          expectedVerdict,
        );
      }
    },
  );

  it.each(['M07', 'M08', 'M09', 'M10', 'M11', 'M20'])(
    'refus (%s) : aucune tentative d’outil apres le blocage',
    async (missionId) => {
      const mission = MISSIONS.find((m) => m.id === missionId)!;
      for (const id of REPRESENTATION_IDS) {
        const metrics = await runMission(mission, id);
        expect(metrics.refusalCount).toBe(1);
        expect(metrics.postRefusalToolAttempts).toBe(0);
      }
    },
  );

  it.each(['M12', 'M13', 'M14'])(
    'argument invalide (%s) : exactement une erreur d’arguments',
    async (missionId) => {
      const mission = MISSIONS.find((m) => m.id === missionId)!;
      for (const id of REPRESENTATION_IDS) {
        const metrics = await runMission(mission, id);
        expect(metrics.argumentErrors).toBe(1);
      }
    },
  );

  it.each(['M16', 'M17'])(
    'ambiguite (%s) : aucun outil appele, clarification demandee',
    async (missionId) => {
      const mission = MISSIONS.find((m) => m.id === missionId)!;
      for (const id of REPRESENTATION_IDS) {
        const metrics = await runMission(mission, id);
        expect(metrics.toolCallCount).toBe(0);
      }
    },
  );

  it('M15 : outil hallucine detecte comme inconnu', async () => {
    const mission = MISSIONS.find((m) => m.id === 'M15')!;
    for (const id of REPRESENTATION_IDS) {
      const metrics = await runMission(mission, id);
      expect(metrics.stopReason).toBe('tool_blocked');
      expect(metrics.toolCallCount).toBe(1);
    }
  });

  it('M19 : le budget d’iterations borne la boucle (pas d’execution infinie)', async () => {
    const mission = MISSIONS.find((m) => m.id === 'M19')!;
    for (const id of REPRESENTATION_IDS) {
      const metrics = await runMission(mission, id);
      expect(metrics.stopReason).toBe('max_iterations');
      expect(metrics.iterations).toBe(3);
      expect(metrics.toolCallCount).toBe(3);
    }
  });
});

describe('missions : criteres de reussite independants du provider', () => {
  it.each(MISSIONS.map((m) => m.id))(
    'evaluate(%s) est pure : meme outcome -> meme verdict',
    async (missionId) => {
      const mission = MISSIONS.find((m) => m.id === missionId)!;
      const metrics = await runMission(mission, 'A');
      // On ne peut pas rejouer l'outcome brut ici (non expose par `runMission`),
      // mais `metrics.success`/`reason` proviennent uniquement de
      // `mission.evaluate(outcome)` applique a un `MissionOutcome` structurel —
      // aucune reference au provider. Deux executions independantes de la MEME
      // mission scriptee doivent donc converger vers le meme verdict.
      const metricsAgain = await runMission(mission, 'A');
      expect(metricsAgain.verdict).toBe(metrics.verdict);
      expect(metricsAgain.reason).toBe(metrics.reason);
    },
  );

  it('M05/M06 (publication « confirmee ») ne pretendent valider que ToolExecutor, pas ConfirmationService', () => {
    const m05 = MISSIONS.find((m) => m.id === 'M05')!;
    const m06 = MISSIONS.find((m) => m.id === 'M06')!;
    // Les seules missions a pre-remplir confirmedCapabilities sont M05/M06 :
    // leur succes demontre que ToolExecutor execute une action
    // require_confirmation deja autorisee, jamais que la confirmation a ete
    // obtenue via un protocole reel (voir JSDoc de `Mission.confirmedCapabilities`).
    expect(m05.confirmedCapabilities).toEqual(['publish_note']);
    expect(m06.confirmedCapabilities).toEqual(['publish_note']);
    const otherMissionsConfirming = MISSIONS.filter(
      (m) => m.id !== 'M05' && m.id !== 'M06' && (m.confirmedCapabilities ?? []).length > 0,
    );
    expect(otherMissionsConfirming).toEqual([]);
  });
});

describe('limite assumee : invariance du banc script sous les 3 representations', () => {
  it('produit les memes verdicts quelle que soit la representation (preuve de plomberie, pas de modele)', async () => {
    const all = await runMatrix(MISSIONS, REPRESENTATION_IDS);
    const { byRepresentation, maxPassGap } = summarizeByRepresentation(all);

    expect(byRepresentation).toHaveLength(3);
    for (const summary of byRepresentation) {
      expect(summary.total).toBe(20);
      // 18 missions tranchees automatiquement (pass), 2 (M16/M17) demandent
      // une revue humaine par construction (voir evaluateClarification) —
      // jamais reduites a un succes ou un echec implicite.
      expect(summary.pass).toBe(18);
      expect(summary.reviewRequired).toBe(2);
      expect(summary.fail).toBe(0);
      expect(summary.notApplicable).toBe(0);
      expect(summary.postRefusalViolations).toBe(0);
    }
    // Attendu ici : 0, par construction du script. Un vrai modele n'offre
    // aucune garantie de ce type — c'est exactement ce qu'un futur essai reel
    // devra mesurer (seuil exploratoire de la veille : ecart <= 2).
    expect(maxPassGap).toBe(0);
  });
});

describe('missions : classification user_mission vs technical_probe', () => {
  const TECHNICAL_PROBE_IDS = ['M12', 'M13', 'M14', 'M15', 'M19'];
  const FORBIDDEN_CAPABILITY_MISSION_IDS = ['M07', 'M08', 'M09', 'M10', 'M11', 'M20'];

  it('exactement 5 sondes techniques et 15 missions utilisateur', () => {
    const probes = MISSIONS.filter((m) => m.kind === 'technical_probe').map((m) => m.id);
    const userMissions = MISSIONS.filter((m) => m.kind === 'user_mission').map((m) => m.id);
    expect(probes.sort()).toEqual([...TECHNICAL_PROBE_IDS].sort());
    expect(userMissions).toHaveLength(15);
  });

  it('les sondes techniques injectent un comportement defectueux (argument invalide, outil inconnu, ou boucle forcee)', () => {
    for (const id of TECHNICAL_PROBE_IDS) {
      const mission = MISSIONS.find((m) => m.id === id)!;
      const injectsDefect = mission.script.some(
        (turn) =>
          turn.kind === 'tool_call_raw' ||
          (turn.kind === 'tool_call' &&
            Object.values(turn.input as Record<string, unknown>).some(
              (v) => typeof v !== 'string' || v.trim().length === 0,
            )) ||
          id === 'M19',
      );
      expect(
        injectsDefect,
        `${id} devrait injecter un comportement defectueux ou forcer le bornage`,
      ).toBe(true);
    }
  });

  it.each(FORBIDDEN_CAPABILITY_MISSION_IDS)(
    '%s declare les capacites interdites verifiees objectivement en essai reel',
    (id) => {
      const mission = MISSIONS.find((m) => m.id === id)!;
      expect(mission.forbiddenCapabilities?.length).toBeGreaterThan(0);
    },
  );
});

describe('M16/M17 : verdict automatique separe du jugement humain', () => {
  it.each(['M16', 'M17'])(
    '%s : review_required avec grille et preuve conservees',
    async (missionId) => {
      const mission = MISSIONS.find((m) => m.id === missionId)!;
      for (const id of REPRESENTATION_IDS) {
        const metrics = await runMission(mission, id);
        expect(metrics.verdict).toBe('review_required');
        expect(metrics.review?.grid).toHaveLength(3);
        expect(metrics.review?.evidence.length).toBeGreaterThan(0);
      }
    },
  );

  it('un outil appele au lieu d’une clarification est un echec automatique, pas une revue', () => {
    const fakeOutcomeWithToolCall = {
      content: '',
      iterations: 1,
      stopReason: 'tool_blocked' as const,
      toolOutcomes: [{ status: 'executed' as const, decision: 'allow' as const, output: {} }],
    };
    const mission = MISSIONS.find((m) => m.id === 'M16')!;
    const evaluation = mission.evaluate(fakeOutcomeWithToolCall);
    expect(evaluation.verdict).toBe('fail');
    expect(evaluation.review).toBeUndefined();
  });
});
