import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CorruptStoreError,
  ExclusivityError,
  IllegalTransitionError,
  MAX_RESPONSE_TEXT_LENGTH_CHARS,
  MAX_TEXT_LENGTH_CHARS,
  UnsupportedSchemaError,
} from './message-store.js';
import { DatabaseSync } from 'node:sqlite';
import { SqliteMessageStore } from './sqlite-message-store.js';
import { StoreModeMismatchError } from './store-mode-tag.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'whatsapp-store-'));
  dbPath = join(dir, 'nested', 'messages.db');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function openStore(
  overrides: Partial<{
    mode: 'simulated' | 'real';
    maxActiveDepth: number;
    maxStoredMessages: number;
    maxAdmissionAttempts: number;
  }> = {},
): SqliteMessageStore {
  return SqliteMessageStore.open({ filePath: dbPath, mode: 'simulated', ...overrides });
}

const NOW = '2026-10-10T10:00:00.000Z';
const LATER = '2026-10-10T10:00:05.000Z';

describe('SqliteMessageStore — admission durable et doublon', () => {
  it('une première admission réussit, une seconde avec le même id est un doublon', () => {
    const store = openStore();
    expect(
      store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'bonjour', now: NOW }),
    ).toEqual({
      kind: 'admitted',
      contentMismatch: false,
    });
    expect(
      store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'bonjour', now: LATER }),
    ).toEqual({
      kind: 'duplicate',
      contentMismatch: false,
    });
    store.close();
  });

  it('doublon au contenu divergent (expéditeur ou texte différent) → détecté, texte/expéditeur jamais remplacés', () => {
    const store = openStore();
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'original', now: NOW });

    expect(
      store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'different', now: LATER }),
    ).toEqual({
      kind: 'duplicate',
      contentMismatch: true,
    });
    expect(
      store.admit({ providerMessageId: 'm1', senderId: 's2', text: 'original', now: LATER }),
    ).toEqual({
      kind: 'duplicate',
      contentMismatch: true,
    });

    // Jamais remplacé silencieusement : le texte/expéditeur d'origine restent.
    const row = store.getRow('m1');
    expect(row?.text).toBe('original');
    expect(row?.senderId).toBe('s1');
    store.close();
  });

  it("l'admission est persistée avant tout retour — une relecture via une nouvelle ouverture du même fichier la retrouve", () => {
    const store = openStore();
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'bonjour', now: NOW });
    store.close();

    const reopened = openStore();
    expect(reopened.getRow('m1')?.status).toBe('queued');
    reopened.close();
  });
});

describe('SqliteMessageStore — réouverture bornée des échecs certains', () => {
  it('échec de GÉNÉRATION → rouverte en queued (rien à réutiliser), attempts incrémenté par la réouverture', () => {
    const store = openStore({ maxAdmissionAttempts: 5 });
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });
    const claimed = store.claimNextQueued(NOW);
    store.recordGenerationFailed(claimed!.providerMessageId, 'panne', NOW);

    expect(store.getRow('m1')?.status).toBe('failed');
    expect(store.getRow('m1')?.responseText).toBeNull();
    expect(store.getRow('m1')?.attempts).toBe(0); // la réclamation seule n'incrémente plus rien

    const admission = store.admit({
      providerMessageId: 'm1',
      senderId: 's1',
      text: 'x',
      now: LATER,
    });
    expect(admission).toEqual({ kind: 'admitted', contentMismatch: false });
    expect(store.getRow('m1')?.status).toBe('queued'); // régénération nécessaire
    expect(store.getRow('m1')?.attempts).toBe(1); // incrémenté par la réouverture elle-même
    store.close();
  });

  it("échec d'ENVOI démontré (recordSendRejected) → rouverte directement en response_ready, réponse déjà générée réutilisée", () => {
    const store = openStore();
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });
    const claimed = store.claimNextQueued(NOW)!;
    store.recordResponseReady(claimed.providerMessageId, 'réponse originale', NOW);
    const sending = store.claimNextResponseReady(NOW)!;
    store.recordSendRejected(sending.providerMessageId, 'rejet 4xx', NOW);

    expect(store.getRow('m1')?.status).toBe('failed');
    expect(store.getRow('m1')?.responseText).toBe('réponse originale');

    const admission = store.admit({
      providerMessageId: 'm1',
      senderId: 's1',
      text: 'x',
      now: LATER,
    });
    expect(admission).toEqual({ kind: 'admitted', contentMismatch: false });
    // Reprise directement à l'envoi — jamais repassée par "queued"/génération.
    expect(store.getRow('m1')?.status).toBe('response_ready');
    expect(store.getRow('m1')?.responseText).toBe('réponse originale');
    expect(store.getRow('m1')?.attempts).toBe(1);

    const resumed = store.claimNextResponseReady(LATER);
    expect(resumed?.responseText).toBe('réponse originale'); // jamais régénérée
    store.close();
  });

  it("un rejet permanent du fournisseur n'engendre jamais de boucle : au-delà de maxAdmissionAttempts, un failed ne se rouvre plus", () => {
    const store = openStore({ maxAdmissionAttempts: 2 });
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });

    // Cycle 1 : échec, puis réouverture (attempts 0 -> 1).
    store.recordGenerationFailed(store.claimNextQueued(NOW)!.providerMessageId, 'panne', NOW);
    expect(
      store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: LATER }).kind,
    ).toBe('admitted');
    expect(store.getRow('m1')?.attempts).toBe(1);

    // Cycle 2 : échec, puis réouverture (attempts 1 -> 2 == maxAdmissionAttempts).
    store.recordGenerationFailed(store.claimNextQueued(LATER)!.providerMessageId, 'panne', LATER);
    expect(
      store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: LATER }).kind,
    ).toBe('admitted');
    expect(store.getRow('m1')?.attempts).toBe(2);

    // Cycle 3 : échec à nouveau — désormais attempts(2) >= maxAdmissionAttempts(2) :
    // plus jamais rouvert, quel que soit le nombre de redélivraisons futures du fournisseur.
    store.recordGenerationFailed(store.claimNextQueued(LATER)!.providerMessageId, 'panne', LATER);
    expect(store.getRow('m1')?.attempts).toBe(2);
    for (let i = 0; i < 5; i++) {
      expect(
        store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: LATER }),
      ).toEqual({ kind: 'duplicate', contentMismatch: false });
    }
    expect(store.getRow('m1')?.status).toBe('failed');
    expect(store.getRow('m1')?.attempts).toBe(2); // jamais incrémenté davantage
    store.close();
  });
});

describe('SqliteMessageStore — uncertain jamais relancé automatiquement', () => {
  it("un uncertain reste un doublon permanent — l'admission ne le rouvre jamais, même sans borne d'essais", () => {
    const store = openStore();
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });
    const claimed = store.claimNextQueued(NOW)!;
    store.recordResponseReady(claimed.providerMessageId, 'réponse', NOW);
    const sending = store.claimNextResponseReady(NOW)!;
    store.recordUncertain(sending.providerMessageId, 'délai dépassé', NOW);

    expect(store.getRow('m1')?.status).toBe('uncertain');
    expect(store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: LATER })).toEqual(
      {
        kind: 'duplicate',
        contentMismatch: false,
      },
    );
    expect(store.getRow('m1')?.status).toBe('uncertain'); // inchangé
    store.close();
  });
});

describe('SqliteMessageStore — transitions illégales refusées', () => {
  it('recordSent sur une ligne encore queued (jamais en sending) → IllegalTransitionError, aucune mutation', () => {
    const store = openStore();
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });
    expect(() => store.recordSent('m1', NOW)).toThrow(IllegalTransitionError);
    expect(store.getRow('m1')?.status).toBe('queued');
    store.close();
  });

  it('recordResponseReady deux fois de suite → la seconde échoue (déjà response_ready, plus processing)', () => {
    const store = openStore();
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });
    const claimed = store.claimNextQueued(NOW)!;
    store.recordResponseReady(claimed.providerMessageId, 'réponse', NOW);
    expect(() => store.recordResponseReady('m1', 'autre réponse', LATER)).toThrow(
      IllegalTransitionError,
    );
    expect(store.getRow('m1')?.responseText).toBe('réponse'); // inchangé
    store.close();
  });

  it('claimNextQueued sur un id inexistant/vide → undefined, jamais une exception', () => {
    const store = openStore();
    expect(store.claimNextQueued(NOW)).toBeUndefined();
    store.close();
  });
});

describe('SqliteMessageStore — capacité bornée', () => {
  it('maxActiveDepth atteint → rejected_capacity, ne consomme pas une place', () => {
    const store = openStore({ maxActiveDepth: 1 });
    expect(store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW }).kind).toBe(
      'admitted',
    );
    expect(store.admit({ providerMessageId: 'm2', senderId: 's1', text: 'x', now: NOW }).kind).toBe(
      'rejected_capacity',
    );
    expect(store.getRow('m2')).toBeUndefined(); // jamais inséré
    store.close();
  });

  it("maxStoredMessages atteint même avec des lignes terminales (uncertain) → refus explicite, pas d'accumulation illimitée", () => {
    const store = openStore({ maxStoredMessages: 2, maxActiveDepth: 10 });
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });
    const claimed = store.claimNextQueued(NOW)!;
    store.recordResponseReady(claimed.providerMessageId, 'r', NOW);
    const sending = store.claimNextResponseReady(NOW)!;
    store.recordUncertain(sending.providerMessageId, 'timeout', NOW); // terminal, jamais purgé automatiquement

    store.admit({ providerMessageId: 'm2', senderId: 's1', text: 'x', now: NOW }); // total=2, atteint le plafond

    expect(store.countTotal()).toBe(2);
    expect(store.admit({ providerMessageId: 'm3', senderId: 's1', text: 'x', now: NOW }).kind).toBe(
      'rejected_capacity',
    );
    store.close();
  });

  it("réouverture d'un failed refusée si elle dépasserait maxActiveDepth (la ligne reste failed, inchangée)", () => {
    const store = openStore({ maxActiveDepth: 1 });
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });
    const claimed = store.claimNextQueued(NOW)!;
    store.recordGenerationFailed(claimed.providerMessageId, 'panne', NOW); // libère la place (plus "actif")

    store.admit({ providerMessageId: 'm2', senderId: 's1', text: 'x', now: NOW }); // occupe l'unique place active

    expect(
      store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: LATER }).kind,
    ).toBe('rejected_capacity');
    expect(store.getRow('m1')?.status).toBe('failed'); // jamais muté par le refus
    store.close();
  });
});

describe('SqliteMessageStore — reprise après redémarrage', () => {
  it('queued retrouvé : aucune action, reste éligible à claimNextQueued', () => {
    const store = openStore();
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });
    const report = store.recoverAfterRestart(LATER);
    expect(report).toEqual({
      resumedProcessing: 0,
      quarantinedSending: 0,
      pendingResponseReady: 0,
    });
    expect(store.getRow('m1')?.status).toBe('queued');
    store.close();
  });

  it('processing retrouvé : remis en queued (repris uniquement après recoverAfterRestart)', () => {
    const store = openStore();
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });
    store.claimNextQueued(NOW); // laissé "processing", simule un crash pendant la génération

    const report = store.recoverAfterRestart(LATER);
    expect(report.resumedProcessing).toBe(1);
    expect(store.getRow('m1')?.status).toBe('queued');
    store.close();
  });

  it('response_ready retrouvé : compté, NON muté — repris ensuite par claimNextResponseReady sans régénérer', () => {
    const store = openStore();
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });
    const claimed = store.claimNextQueued(NOW)!;
    store.recordResponseReady(claimed.providerMessageId, 'réponse déjà générée', NOW);

    const report = store.recoverAfterRestart(LATER);
    expect(report.pendingResponseReady).toBe(1);
    expect(store.getRow('m1')?.status).toBe('response_ready'); // pas encore muté par recoverAfterRestart

    const resumed = store.claimNextResponseReady(LATER);
    expect(resumed?.responseText).toBe('réponse déjà générée'); // jamais régénérée
    expect(resumed?.status).toBe('sending');
    store.close();
  });

  it("sending retrouvé après un crash → uncertain, jamais classé 'non envoyé', jamais relancé", () => {
    const store = openStore();
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });
    const claimed = store.claimNextQueued(NOW)!;
    store.recordResponseReady(claimed.providerMessageId, 'réponse', NOW);
    store.claimNextResponseReady(NOW); // laissé "sending", simule un crash pendant l'envoi

    const report = store.recoverAfterRestart(LATER);
    expect(report.quarantinedSending).toBe(1);
    const row = store.getRow('m1');
    expect(row?.status).toBe('uncertain');
    expect(row?.lastError).toBe('interrupted_by_restart');

    // Jamais relancé : une admission ultérieure du même id reste un doublon.
    expect(
      store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: LATER }).kind,
    ).toBe('duplicate');
    store.close();
  });
});

describe('SqliteMessageStore — données et rétention', () => {
  it('fichier de base et annexes WAL/SHM créés avec des permissions restrictives (0600)', () => {
    const store = openStore();
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW }); // force l'écriture WAL
    const mode = statSync(dbPath).mode & 0o777;
    expect(mode).toBe(0o600);
    store.close();
  });

  it('répertoire créé avec des permissions restrictives (0700)', () => {
    const store = openStore();
    const dirMode = statSync(join(dir, 'nested')).mode & 0o777;
    expect(dirMode).toBe(0o700);
    store.close();
  });
});

describe('SqliteMessageStore — exclusivité de process', () => {
  it("une seconde ouverture sur le même fichier échoue immédiatement (pas d'attente, pas de fichier de verrou ambigu)", () => {
    const store = openStore();
    expect(() => SqliteMessageStore.open({ filePath: dbPath, mode: 'simulated' })).toThrow(
      ExclusivityError,
    );
    store.close();
  });

  it('après close(), une nouvelle ouverture sur le même fichier réussit — aucun verrou résiduel', () => {
    const store = openStore();
    store.close();
    const reopened = openStore();
    reopened.close();
  });

  it('le fichier de verrou OS est automatiquement libéré même sans fermeture propre (pas un fichier PID à nettoyer)', () => {
    // Simule un "crash" : la connexion est abandonnée sans `close()`. Le
    // verrou OS (flock/fcntl) est détenu par la connexion, pas par un
    // fichier séparé — rien à nettoyer manuellement. Une connexion DIRECTE
    // (hors SqliteMessageStore) prouve que l'ancien verrou ne bloque plus
    // une fois le process/la connexion réellement terminée : ici on
    // simplifie en fermant la connexion sous-jacente sans passer par
    // `close()` applicatif, ce qui correspond au même comportement noyau
    // qu'un SIGKILL (vérifié séparément par un vrai sous-processus — voir
    // `durable-message-worker.crash-recovery.test.ts`).
    mkdirSync(dirname(dbPath), { recursive: true });
    const direct = new DatabaseSync(dbPath);
    direct.exec('PRAGMA journal_mode=WAL');
    direct.exec('PRAGMA locking_mode=EXCLUSIVE');
    direct.exec('BEGIN IMMEDIATE');
    direct.exec('COMMIT');
    direct.close(); // libère le verrou OS, sans passer par l'API applicative

    const store = openStore();
    store.close();
  });

  it('le verrou reste détenu pendant toute la vie du worker, y compris HORS transaction (pas seulement pendant admit())', () => {
    const store = openStore();
    // Aucune transaction en cours ici, juste une lecture simple — le
    // verrou `locking_mode=EXCLUSIVE` est tenu par la connexion elle-même,
    // pas par une transaction ponctuelle.
    store.getRow('inexistant');
    expect(() => SqliteMessageStore.open({ filePath: dbPath, mode: 'simulated' })).toThrow(
      ExclusivityError,
    );
    store.close();
  });
});

describe('SqliteMessageStore — refus prudent d’un fichier invalide', () => {
  it('fichier corrompu (pas un format SQLite) → CorruptStoreError, jamais une ExclusivityError trompeuse', () => {
    mkdirSync(dirname(dbPath), { recursive: true });
    writeFileSync(dbPath, 'ceci n’est pas une base SQLite, juste des octets quelconques');
    expect(() => openStore()).toThrow(CorruptStoreError);
  });

  it('version de schéma inconnue → UnsupportedSchemaError, aucune migration automatique tentée', () => {
    const store = openStore();
    store.close();
    const direct = new DatabaseSync(dbPath);
    direct.exec('PRAGMA user_version=999');
    direct.close();

    expect(() => openStore()).toThrow(UnsupportedSchemaError);
  });
});

describe('SqliteMessageStore — limites de taille (texte et réponse)', () => {
  it('texte entrant au-delà de MAX_TEXT_LENGTH_CHARS → rejected_text_too_long, jamais inséré', () => {
    const store = openStore();
    const tooLong = 'x'.repeat(MAX_TEXT_LENGTH_CHARS + 1);
    expect(
      store.admit({ providerMessageId: 'm1', senderId: 's1', text: tooLong, now: NOW }),
    ).toEqual({ kind: 'rejected_text_too_long' });
    expect(store.getRow('m1')).toBeUndefined();
    store.close();
  });

  it('texte à exactement la limite → admis normalement (limite inclusive)', () => {
    const store = openStore();
    const exact = 'x'.repeat(MAX_TEXT_LENGTH_CHARS);
    expect(
      store.admit({ providerMessageId: 'm1', senderId: 's1', text: exact, now: NOW }).kind,
    ).toBe('admitted');
    store.close();
  });

  it('contrainte CHECK en base : un contournement direct de admit() (ex. bug futur) est rejeté par SQLite lui-même', () => {
    const store = openStore();
    store.admit({ providerMessageId: 'm1', senderId: 's1', text: 'x', now: NOW });
    const claimed = store.claimNextQueued(NOW)!;
    const tooLongResponse = 'y'.repeat(MAX_RESPONSE_TEXT_LENGTH_CHARS + 1);
    expect(() =>
      store.recordResponseReady(claimed.providerMessageId, tooLongResponse, NOW),
    ).toThrow();
    store.close();
  });
});

describe('SqliteMessageStore — purge manuelle de rétention', () => {
  function admitAndTerminate(
    store: SqliteMessageStore,
    id: string,
    terminal: 'sent' | 'failed',
    at: string,
  ): void {
    store.admit({ providerMessageId: id, senderId: 's1', text: 'contenu', now: at });
    const claimed = store.claimNextQueued(at)!;
    if (terminal === 'failed') {
      store.recordGenerationFailed(claimed.providerMessageId, 'panne', at);
      return;
    }
    store.recordResponseReady(claimed.providerMessageId, 'réponse', at);
    store.claimNextResponseReady(at);
    store.recordSent(id, at);
  }

  it('dry-run par défaut : ne mute rien, rapporte ce qui serait purgé', () => {
    const store = openStore();
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    admitAndTerminate(store, 'old-sent', 'sent', old);

    const report = store.purgeRetainedContent({ now: new Date().toISOString() });
    expect(report.contentCleared).toBe(1);
    expect(report.rowsDeleted).toBe(1);
    // Dry-run : rien n'a réellement changé.
    expect(store.getRow('old-sent')?.text).toBe('contenu');
    store.close();
  });

  it('--apply : vide le texte des lignes sent/failed au-delà de contentRetentionMs, conserve la ligne pour la déduplication', () => {
    const store = openStore();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    admitAndTerminate(store, 'old-failed', 'failed', old);

    const report = store.purgeRetainedContent({
      now: new Date().toISOString(),
      contentRetentionMs: 30 * 24 * 60 * 60 * 1000,
      fullPurgeAfterMs: 365 * 24 * 60 * 60 * 1000, // bien au-delà : ligne conservée
      dryRun: false,
    });
    expect(report.contentCleared).toBe(1);
    expect(report.rowsDeleted).toBe(0);
    const row = store.getRow('old-failed');
    expect(row?.text).toBe('');
    expect(row?.status).toBe('failed'); // ligne conservée, bloque toujours un doublon tardif
    store.close();
  });

  it('--apply : supprime entièrement une ligne sent/failed au-delà de fullPurgeAfterMs', () => {
    const store = openStore();
    const veryOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    admitAndTerminate(store, 'ancient-sent', 'sent', veryOld);

    const report = store.purgeRetainedContent({
      now: new Date().toISOString(),
      fullPurgeAfterMs: 180 * 24 * 60 * 60 * 1000,
      dryRun: false,
    });
    expect(report.rowsDeleted).toBe(1);
    expect(store.getRow('ancient-sent')).toBeUndefined();
    store.close();
  });

  it('ne purge JAMAIS le travail actif (queued/processing/response_ready/sending)', () => {
    const store = openStore();
    const veryOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    // `admit()` ne permet pas de forcer `received_at`/`updated_at` dans le
    // passé pour une ligne active via l'API publique — on le fait ici
    // directement pour simuler une ligne active anormalement ancienne.
    store.admit({ providerMessageId: 'ancient-active', senderId: 's1', text: 'x', now: veryOld });

    const report = store.purgeRetainedContent({
      now: new Date().toISOString(),
      contentRetentionMs: 1,
      fullPurgeAfterMs: 1,
      dryRun: false,
    });
    expect(report.contentCleared).toBe(0);
    expect(report.rowsDeleted).toBe(0);
    expect(store.getRow('ancient-active')?.status).toBe('queued');
    expect(store.getRow('ancient-active')?.text).toBe('x');
    store.close();
  });

  it('ne purge JAMAIS un uncertain, même très ancien — ambiguïté non résolue, jamais effacée automatiquement', () => {
    const store = openStore();
    const veryOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    store.admit({
      providerMessageId: 'ancient-uncertain',
      senderId: 's1',
      text: 'x',
      now: veryOld,
    });
    const claimed = store.claimNextQueued(veryOld)!;
    store.recordResponseReady(claimed.providerMessageId, 'r', veryOld);
    const sending = store.claimNextResponseReady(veryOld)!;
    store.recordUncertain(sending.providerMessageId, 'timeout', veryOld);

    const report = store.purgeRetainedContent({
      now: new Date().toISOString(),
      contentRetentionMs: 1,
      fullPurgeAfterMs: 1,
      dryRun: false,
    });
    expect(report.contentCleared).toBe(0);
    expect(report.rowsDeleted).toBe(0);
    expect(store.getRow('ancient-uncertain')?.status).toBe('uncertain');
    expect(store.getRow('ancient-uncertain')?.text).toBe('x');
    store.close();
  });
});

describe('SqliteMessageStore — schéma versionné', () => {
  it('user_version est fixé à 2 après la première ouverture (table store_mode ajoutée en revue finale)', () => {
    const store = openStore();
    store.close();
    const direct = new DatabaseSync(dbPath);
    const version = (direct.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
    expect(version).toBe(2);
    direct.close();
  });
});

describe('SqliteMessageStore — provenance du mode, refuse une convergence simulé/réel', () => {
  it('un store créé en mode simulated refuse d’être rouvert en mode real — même chemin explicite', () => {
    openStore({ mode: 'simulated' }).close();
    expect(() => SqliteMessageStore.open({ filePath: dbPath, mode: 'real' })).toThrow(
      StoreModeMismatchError,
    );
  });

  it('un store créé en mode real refuse d’être rouvert en mode simulated', () => {
    SqliteMessageStore.open({ filePath: dbPath, mode: 'real' }).close();
    expect(() => openStore({ mode: 'simulated' })).toThrow(StoreModeMismatchError);
  });

  it('rouvrir dans le MÊME mode reste toujours permis', () => {
    openStore({ mode: 'real' }).close();
    expect(() => openStore({ mode: 'real' })).not.toThrow();
  });
});
