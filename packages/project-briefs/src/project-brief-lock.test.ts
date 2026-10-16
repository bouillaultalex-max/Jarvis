import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectBriefLockError, acquireProjectBriefLock } from './project-brief-lock.js';

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-project-briefs-lock-'));
  filePath = join(dir, 'p1.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('acquireProjectBriefLock', () => {
  it('crée le fichier de verrou et le supprime à la libération', () => {
    const release = acquireProjectBriefLock(filePath);
    expect(existsSync(`${filePath}.lock`)).toBe(true);
    release();
    expect(existsSync(`${filePath}.lock`)).toBe(false);
  });

  it('une seconde acquisition échoue tant que la première détient le verrou', () => {
    const release = acquireProjectBriefLock(filePath);
    expect(() => acquireProjectBriefLock(filePath)).toThrow(ProjectBriefLockError);
    release();
    expect(() => acquireProjectBriefLock(filePath)).not.toThrow();
  });

  it('la libération est idempotente (un second appel ne lève pas)', () => {
    const release = acquireProjectBriefLock(filePath);
    release();
    expect(() => release()).not.toThrow();
  });
});
