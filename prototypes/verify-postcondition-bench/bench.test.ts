/**
 * BANC ISOLE (EXP-004) — tests déterministes, sans réseau ni LLM.
 *
 * Vérifie le VÉRIFICATEUR EXPÉRIMENTAL de ce banc, pas un mécanisme JARVIS
 * existant (aucun n'existe, voir README.md). Chaque assertion porte sur le
 * verdict produit par `verifier.ts`, jamais sur la déclaration de l'outil.
 */

import {
  InMemoryMailClient,
  inMemoryConnector,
  type InMemorySentMessage,
} from '@jarvis/connectors';
import { valid, type Tool } from '@jarvis/core';
import { describe, expect, it } from 'vitest';

import { CASES } from './cases.js';
import type { FaultySendInput } from './faulty-doubles.js';
import { expectNewSentRecord } from './oracle.js';
import { runCase, runMatrix, type CaseTrace } from './runner.js';

function traceFor(traces: readonly CaseTrace[], caseId: string): CaseTrace {
  const trace = traces.find((t) => t.caseId === caseId);
  if (trace === undefined) {
    throw new Error(`cas introuvable dans les traces : ${caseId}`);
  }
  return trace;
}

describe('EXP-004 — protocole de vérification de postcondition (10 cas)', () => {
  it('produit exactement 10 traces, une par cas déclaré', async () => {
    const traces = await runMatrix(CASES);
    expect(traces).toHaveLength(10);
    expect(new Set(traces.map((t) => t.caseId)).size).toBe(10);
  });

  describe('V1-V5 — succès annoncé et effet réel : verdict pass', () => {
    it.each(['V1', 'V2', 'V3', 'V4'])('%s aboutit à pass', async (caseId) => {
      const traces = await runMatrix(CASES);
      const trace = traceFor(traces, caseId);
      expect(trace.technicalResult.status).toBe('executed');
      expect(trace.verification.verdict).toBe('pass');
    });

    it('V5 : exécuté sur deux instances isolées, chacune ne voit que son propre envoi', async () => {
      const v5 = CASES.find((c) => c.id === 'V5');
      if (v5 === undefined) throw new Error('cas V5 introuvable');

      const traceA = await runCase(v5);
      const traceB = await runCase(v5);

      expect(traceA.verification.verdict).toBe('pass');
      expect(traceB.verification.verdict).toBe('pass');
      // État initial reproductible ET isolé : chaque instance ne contient que
      // son propre envoi, jamais celui de l'autre exécution.
      expect(traceA.after.sent).toHaveLength(1);
      expect(traceB.after.sent).toHaveLength(1);
      expect(traceA.after.sent[0]?.id).toBe(traceB.after.sent[0]?.id);
      expect(traceA.after.sent[0]).not.toBe(traceB.after.sent[0]);
    });
  });

  describe('F1-F5 — succès annoncé sans effet démontré : verdict ≠ pass', () => {
    it('F1 (substitut de internal.fake_execute) : no_evidence — aucun observateur disponible', async () => {
      const traces = await runMatrix(CASES);
      const trace = traceFor(traces, 'F1');
      expect(trace.technicalResult.status).toBe('executed');
      expect(trace.verification.verdict).toBe('no_evidence');
    });

    it('F2 (succès annoncé sans nouvel effet) ne passe pas la vérification', async () => {
      const traces = await runMatrix(CASES);
      const trace = traceFor(traces, 'F2');
      expect(trace.technicalResult.status).toBe('executed');
      expect(trace.verification.verdict).not.toBe('pass');
      expect(trace.verification.verdict).toBe('contradicted');
    });

    it('F3 (mauvais destinataire) ne passe pas la vérification', async () => {
      const traces = await runMatrix(CASES);
      const trace = traceFor(traces, 'F3');
      expect(trace.technicalResult.status).toBe('executed');
      expect(trace.verification.verdict).not.toBe('pass');
      expect(trace.verification.verdict).toBe('contradicted');
    });

    it('F4 (ancien identifiant réutilisé) ne passe pas la vérification', async () => {
      const traces = await runMatrix(CASES);
      const trace = traceFor(traces, 'F4');
      expect(trace.technicalResult.status).toBe('executed');
      expect(trace.verification.verdict).not.toBe('pass');
      expect(trace.verification.verdict).toBe('contradicted');
    });

    it('F5 (champ non observable déclaré en plus) : no_evidence, jamais contradicted sur cette seule base', async () => {
      const traces = await runMatrix(CASES);
      const trace = traceFor(traces, 'F5');
      expect(trace.technicalResult.status).toBe('executed');
      expect(trace.verification.verdict).toBe('no_evidence');
    });
  });

  it('ne transforme jamais un statut technique "executed" en réussite métier automatique', async () => {
    // Les 5 cas F ont tous status === 'executed' (aucune exception levée), et
    // pourtant 4 verdicts sur 5 diffèrent de 'pass' — la preuve que ce banc
    // ne confond jamais "la promesse ne s'est pas rejetée" et "l'effet visé
    // a eu lieu" (voir docs/verified-result-boundaries.md, §11).
    const traces = await runMatrix(CASES);
    const faultTraces = traces.filter((t) => t.caseId.startsWith('F'));
    expect(faultTraces.every((t) => t.technicalResult.status === 'executed')).toBe(true);
    expect(faultTraces.filter((t) => t.verification.verdict === 'pass')).toHaveLength(0);
  });

  it('F1 est bien étiqueté comme un substitut, jamais comme le composant réel apps/api', () => {
    const f1 = CASES.find((c) => c.id === 'F1');
    expect(f1?.componentNature).toBe('fault_double');
    expect(f1?.componentNote).toMatch(/internal\.fake_execute/);
  });

  it('les composants de production restent étiquetés séparément des doubles de faute', () => {
    const productionIds = CASES.filter((c) => c.componentNature === 'production').map((c) => c.id);
    const faultIds = CASES.filter((c) => c.componentNature === 'fault_double').map((c) => c.id);
    expect(productionIds.sort()).toEqual(['V1', 'V2', 'V3', 'V4', 'V5']);
    expect(faultIds.sort()).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
  });
});

describe('verifier — robustesse aux statuts techniques non "executed"', () => {
  it('un statut "awaiting_confirmation" (confirmation omise) produit no_evidence, jamais pass ni contradicted', async () => {
    const traces = await runMatrix([
      {
        id: 'ROBUST-AWAITING-CONFIRMATION',
        label: 'confirmation omise — aucune déclaration de succès à confronter',
        componentNature: 'production',
        componentNote: 'Vérifie le repli du vérificateur, pas un des 10 cas du protocole.',
        buildClient: () => new InMemoryMailClient([]),
        buildTools: (client) => inMemoryConnector.createTools(client),
        studiedStep: {
          toolName: 'inmemory.send',
          input: { to: 'kate@example.test', subject: 'x', body: 'y' },
          // confirmed omis : action 'execute' soumise par défaut à require_confirmation.
        },
        expectedPostcondition: (input) =>
          expectNewSentRecord(input as { to: string; subject: string; body: string }),
      },
    ]);
    expect(traces[0]?.technicalResult.status).toBe('awaiting_confirmation');
    expect(traces[0]?.verification.verdict).toBe('no_evidence');
  });
});

describe('indépendance de l’oracle vis-à-vis de la déclaration de l’outil', () => {
  it(
    'F3 : la demande autorise un envoi à A, le double envoie à B et le déclare honnêtement — ' +
      'verdict contradicted même si déclaration et état concordent entre eux',
    async () => {
      const traces = await runMatrix(CASES);
      const trace = traceFor(traces, 'F3');

      const authorized = trace.authorizedInput as FaultySendInput;
      const declared = trace.toolDeclaration as InMemorySentMessage;
      const observed = trace.after.sent[trace.after.sent.length - 1];

      // Déclaration et état réellement produit concordent entre eux (l’outil
      // ne MENT pas sur ce qu’il a fait)...
      expect(declared.to).toBe(observed?.to);
      // ...mais les deux divergent de la demande autorisée : B, pas A.
      expect(declared.to).not.toBe(authorized.to);
      expect(authorized.to).toBe('henry@example.test');
      expect(declared.to).toBe('mallory@example.test');

      // La postcondition, calculée avant exécution, reste celle de la demande
      // autorisée (A) — jamais redéfinie par ce que l’outil a ensuite déclaré.
      expect(trace.expectedPostcondition).toMatchObject({
        kind: 'expect_new_sent_record',
        to: 'henry@example.test',
      });
      expect(trace.verification.verdict).toBe('contradicted');
    },
  );

  it(
    'une mutation en place de l’entrée après le calcul de la postcondition ne doit jamais ' +
      'altérer rétroactivement la postcondition ni la trace de l’entrée autorisée',
    async () => {
      const client = new InMemoryMailClient([]);
      const authorizedInput: FaultySendInput = {
        to: 'laura@example.test',
        subject: 'Original',
        body: 'Texte original.',
      };

      // Sonde locale, jamais réutilisée dans cases.ts : validation en
      // pass-through DÉLIBÉRÉE (aucune reconstruction), pour exposer un
      // éventuel partage d'objet mutable entre l'entrée autorisée et ce que
      // l'outil reçoit réellement.
      const mutatingProbeTool: Tool<FaultySendInput, InMemorySentMessage> = {
        name: 'probe.mutating_input',
        description: 'SONDE DE ROBUSTESSE — mute son entrée en place avant d’envoyer réellement.',
        action: 'execute',
        inputSchema: { type: 'object', properties: {}, required: [] },
        validateInput(input) {
          return valid(input as FaultySendInput);
        },
        async execute(input) {
          const mutable = input as { to: string; subject: string; body: string };
          mutable.to = 'tampered@example.test';
          return client.send(mutable);
        },
      };

      const trace = await runCase({
        id: 'PROBE-MUTABLE-INPUT',
        label: 'sonde de robustesse — pas un des 10 cas du protocole',
        componentNature: 'fault_double',
        componentNote: 'Sonde locale à ce test, jamais réutilisée dans cases.ts.',
        buildClient: () => client,
        buildTools: () => [mutatingProbeTool],
        studiedStep: { toolName: 'probe.mutating_input', input: authorizedInput, confirmed: true },
        expectedPostcondition: (input) => expectNewSentRecord(input as FaultySendInput),
      });

      // La postcondition et la trace doivent refléter l'entrée AUTORISÉE
      // ('laura'), jamais la valeur mutée en place par l'outil ('tampered').
      expect(trace.expectedPostcondition).toMatchObject({ to: 'laura@example.test' });
      expect(trace.authorizedInput).toMatchObject({ to: 'laura@example.test' });
      // L'effet réel a bien eu lieu vers l'adresse mutée — divergent de la
      // demande autorisée : verdict contradicted, pas pass.
      expect(trace.after.sent[0]?.to).toBe('tampered@example.test');
      expect(trace.verification.verdict).toBe('contradicted');
    },
  );
});
