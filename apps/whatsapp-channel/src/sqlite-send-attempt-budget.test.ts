import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BudgetNotReservedError } from './send-attempt-budget.js';
import { SqliteSendAttemptBudget } from './sqlite-send-attempt-budget.js';
import { StoreModeMismatchError } from './store-mode-tag.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'whatsapp-budget-'));
  dbPath = join(dir, 'send-attempt-budget.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NOW = '2026-10-10T10:00:00.000Z';

describe('SqliteSendAttemptBudget — une seule tentative, jamais deux', () => {
  it('la première réservation réussit', () => {
    const budget = SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'simulated' });
    expect(budget.reserve(NOW)).toBe('reserved');
    expect(budget.getState()).toEqual({ status: 'reserved', reservedAt: NOW });
    budget.close();
  });

  it('une seconde réservation échoue toujours — concurrente (même tick) ou séquentielle', () => {
    const budget = SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'simulated' });
    const [first, second] = [budget.reserve(NOW), budget.reserve(NOW)];
    // `reserve()` est synchrone : deux appels "concurrents" (sans await
    // entre eux) ne peuvent jamais tous les deux réussir — aucune fenêtre
    // d'interleaving possible en Node mono-thread.
    expect([first, second].sort()).toEqual(['already_consumed', 'reserved']);
    budget.close();
  });

  it('deux appelants réellement asynchrones (Promise.all) : un seul obtient "reserved"', async () => {
    const budget = SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'simulated' });
    const attempt = async (): Promise<ReturnType<typeof budget.reserve>> => budget.reserve(NOW);
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.filter((r) => r === 'reserved')).toHaveLength(1);
    expect(results.filter((r) => r === 'already_consumed')).toHaveLength(1);
    budget.close();
  });

  it('recordOutcome exige une réservation active — sinon BudgetNotReservedError', () => {
    const budget = SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'simulated' });
    expect(() => budget.recordOutcome('sent', undefined, NOW)).toThrow(BudgetNotReservedError);
    budget.close();
  });

  it.each(['sent', 'error', 'uncertain'] as const)(
    'une issue "%s" consomme la tentative de la même façon — aucune différence de traitement',
    (outcome) => {
      const budget = SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'simulated' });
      budget.reserve(NOW);
      budget.recordOutcome(outcome, outcome === 'sent' ? undefined : 'motif synthétique', NOW);
      expect(budget.getState()).toEqual({
        status: outcome,
        reservedAt: NOW,
        resolvedAt: NOW,
        reason: outcome === 'sent' ? undefined : 'motif synthétique',
      });
      expect(budget.reserve(NOW)).toBe('already_consumed');
      budget.close();
    },
  );
});

describe('SqliteSendAttemptBudget — aucun reset implicite au redémarrage', () => {
  it('une réservation consommée (issue "error") reste consommée après fermeture puis réouverture du même fichier', () => {
    const budget = SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'simulated' });
    budget.reserve(NOW);
    budget.recordOutcome('error', 'rejet 4xx synthétique', NOW);
    budget.close();

    const reopened = SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'simulated' });
    expect(reopened.reserve('2026-10-10T11:00:00.000Z')).toBe('already_consumed');
    expect(reopened.getState()?.status).toBe('error');
    reopened.close();
  });

  it("une réservation restée 'reserved' (simule un crash avant recordOutcome) reste bloquée après redémarrage — jamais reprise comme libre", () => {
    const budget = SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'simulated' });
    budget.reserve(NOW); // jamais résolue — simule un crash avant recordOutcome
    budget.close();

    const reopened = SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'simulated' });
    expect(reopened.reserve('2026-10-10T11:00:00.000Z')).toBe('already_consumed');
    expect(reopened.getState()).toEqual({ status: 'reserved', reservedAt: NOW });
    reopened.close();
  });
});

describe('SqliteSendAttemptBudget — provenance du mode, protège contre un reset involontaire', () => {
  it('un budget créé en mode simulated refuse d’être rouvert en mode real — même chemin explicite (ex. override mal réutilisé)', () => {
    SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'simulated' }).close();
    expect(() => SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'real' })).toThrow(
      StoreModeMismatchError,
    );
  });

  it('un budget créé en mode real refuse d’être rouvert en mode simulated', () => {
    SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'real' }).close();
    expect(() => SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'simulated' })).toThrow(
      StoreModeMismatchError,
    );
  });

  it('une tentative déjà consommée en mode real reste bloquée — le mismatch de mode est détecté AVANT toute lecture de la réservation', () => {
    const budget = SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'real' });
    budget.reserve(NOW);
    budget.recordOutcome('sent', undefined, NOW);
    budget.close();

    // Rouvrir au mauvais mode échoue — le code appelant ne peut donc
    // jamais arriver à lire cette consommation depuis le mauvais mode et
    // la confondre avec un budget simulé neuf.
    expect(() => SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'simulated' })).toThrow(
      StoreModeMismatchError,
    );
  });
});

describe('SqliteSendAttemptBudget — permissions privées', () => {
  it('fichier et répertoire (créé par open(), pas hérité de mkdtemp) en permissions restrictives', () => {
    // Sous-répertoire volontairement NEUF — `mkdtempSync` crée déjà `dir`
    // en 0700 par lui-même, ce qui masquerait un défaut si `open()` ne
    // positionnait jamais rien explicitement. `nested/` ici est créé par
    // `SqliteSendAttemptBudget.open()` lui-même.
    const nestedPath = join(dir, 'nested', 'send-attempt-budget.db');
    const budget = SqliteSendAttemptBudget.open({ filePath: nestedPath, mode: 'real' });
    budget.reserve(NOW); // force l'écriture WAL
    expect(statSync(nestedPath).mode & 0o777).toBe(0o600);
    expect(statSync(`${nestedPath}-wal`).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'nested')).mode & 0o777).toBe(0o700);
    budget.close();
  });
});
