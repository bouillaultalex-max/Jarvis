/**
 * BANC ISOLE (EXP-004) — runner déterministe.
 *
 * Fait transiter CHAQUE étape (préalable, étudiée, ou suivante) par le
 * chemin réel `ToolRegistry → PermissionManager → ToolExecutor`, jamais en
 * appelant `tool.execute()` directement. La politique de permission est
 * explicite (`BENCH_PERMISSION_POLICY`) et appliquée identiquement à tous
 * les cas : aucune permission ni confirmation n'est contournée pour faire
 * passer un composant, factice ou non.
 *
 * ⚠️ Passer `confirmed: true` sur une étape simule une confirmation déjà
 * acquise — exactement comme `tool-interface-bench` le fait pour ses
 * missions M05/M06. Cela exerce la branche de `ToolExecutor` qui accepte
 * une confirmation déjà autorisée ; cela ne teste ni `ConfirmationService`
 * ni son cycle de vie réel.
 */

import {
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  type PermissionPolicy,
  type Tool,
  type ToolExecutionResult,
} from '@jarvis/core';
import type { InMemoryMailClient } from '@jarvis/connectors';

import { snapshot, type Postcondition, type StateSnapshot } from './oracle.js';
import { verify, type VerificationResult } from './verifier.js';

export interface ToolCallSpec {
  readonly toolName: string;
  readonly input: unknown;
  readonly confirmed?: boolean;
}

export type ComponentNature = 'production' | 'fault_double';

export interface BenchCase {
  readonly id: string;
  readonly label: string;
  /** `production` : composant réel de @jarvis/connectors, non modifié. `fault_double` : fabriqué pour ce banc. */
  readonly componentNature: ComponentNature;
  /** Explique ce qu'est le composant et, pour un double, la faute qu'il injecte. */
  readonly componentNote: string;
  /** État initial reproductible : une instance neuve, jamais partagée entre cas. */
  readonly buildClient: () => InMemoryMailClient;
  readonly buildTools: (client: InMemoryMailClient) => readonly Tool[];
  /** Étapes exécutées avant l'observation « before » — non vérifiées en elles-mêmes. */
  readonly priorSteps?: readonly ToolCallSpec[];
  /** L'étape dont la déclaration est confrontée à la postcondition. */
  readonly studiedStep: ToolCallSpec;
  /** Étapes exécutées après l'étape étudiée, avant l'observation « after ». */
  readonly trailingSteps?: readonly ToolCallSpec[];
  /** Calculée depuis l'entrée autorisée de `studiedStep` et l'état « before » — jamais depuis la sortie de l'outil. */
  readonly expectedPostcondition: (input: unknown, before: StateSnapshot) => Postcondition;
}

/**
 * Politique explicite, identique pour tous les cas : lecture/préparation
 * autorisées par défaut, exécution toujours soumise à confirmation. Aucun
 * nom d'outil n'y est codé en dur (cohérent avec `PermissionManager`).
 */
export const BENCH_PERMISSION_POLICY: PermissionPolicy = {
  actionDefaults: { read: 'allow', prepare: 'allow', execute: 'require_confirmation' },
};

export interface CaseTrace {
  readonly caseId: string;
  readonly label: string;
  readonly componentNature: ComponentNature;
  readonly componentNote: string;
  readonly authorizedInput: unknown;
  readonly expectedPostcondition: Postcondition;
  readonly before: StateSnapshot;
  readonly after: StateSnapshot;
  readonly technicalResult: ToolExecutionResult;
  /** Sortie déclarée par l'outil, présente uniquement si `technicalResult.status === 'executed'`. */
  readonly toolDeclaration: unknown;
  readonly verification: VerificationResult;
}

async function runSteps(
  executor: ToolExecutor,
  steps: readonly ToolCallSpec[] | undefined,
): Promise<void> {
  for (const step of steps ?? []) {
    await executor.run({ tool: step.toolName, input: step.input, confirmed: step.confirmed });
  }
}

export async function runCase(testCase: BenchCase): Promise<CaseTrace> {
  const client = testCase.buildClient();
  const registry = new ToolRegistry();
  for (const tool of testCase.buildTools(client)) {
    registry.register(tool);
  }
  const executor = new ToolExecutor(registry, new PermissionManager(BENCH_PERMISSION_POLICY));

  await runSteps(executor, testCase.priorSteps);

  const before = snapshot(client);
  // Figée AVANT toute exécution : un outil qui muterait son entrée en place
  // (au lieu de la reconstruire, comme le fait toujours `validateInput` dans
  // ce dépôt) ne doit jamais pouvoir, après coup, faire apparaître cette
  // trace comme ayant autorisé autre chose que ce qui a réellement été
  // demandé. `structuredClone` casse tout partage de référence avec
  // `testCase.studiedStep.input`.
  const authorizedInput = structuredClone(testCase.studiedStep.input);
  const expectedPostcondition = testCase.expectedPostcondition(authorizedInput, before);

  const technicalResult = await executor.run({
    tool: testCase.studiedStep.toolName,
    input: testCase.studiedStep.input,
    confirmed: testCase.studiedStep.confirmed,
  });

  await runSteps(executor, testCase.trailingSteps);

  const after = snapshot(client);
  const toolDeclaration =
    technicalResult.status === 'executed' ? technicalResult.output : undefined;
  const verification = verify(expectedPostcondition, before, after, technicalResult);

  return {
    caseId: testCase.id,
    label: testCase.label,
    componentNature: testCase.componentNature,
    componentNote: testCase.componentNote,
    authorizedInput,
    expectedPostcondition,
    before,
    after,
    technicalResult,
    toolDeclaration,
    verification,
  };
}

export async function runMatrix(cases: readonly BenchCase[]): Promise<readonly CaseTrace[]> {
  const traces: CaseTrace[] = [];
  for (const testCase of cases) {
    traces.push(await runCase(testCase));
  }
  return traces;
}
