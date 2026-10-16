import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileProjectBriefStore } from '@jarvis/project-briefs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { describeProjectResult, projectExitCode, runProjectFlow } from './run-project-flow.js';

let dir: string;
let store: FileProjectBriefStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jarvis-run-project-flow-'));
  store = new FileProjectBriefStore({ baseDir: dir });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runProjectFlow', () => {
  it('create → ok, exitCode 0', () => {
    const result = runProjectFlow({ op: 'create', id: 'p1', name: 'Boutique' }, { store });
    expect(result.status).toBe('ok');
    expect(projectExitCode(result)).toBe(0);
    expect(describeProjectResult(result).join('\n')).toContain('Boutique');
  });

  it('show sur un projet absent → not-found, exitCode non nul', () => {
    const result = runProjectFlow({ op: 'show', id: 'absent' }, { store });
    expect(result).toEqual({ status: 'not-found', id: 'absent' });
    expect(projectExitCode(result)).toBe(1);
    expect(describeProjectResult(result).join('\n')).toContain('introuvable');
  });

  it('une erreur de store (déjà existant) devient un résultat contrôlé, pas une exception', () => {
    runProjectFlow({ op: 'create', id: 'p1', name: 'Boutique' }, { store });
    const result = runProjectFlow({ op: 'create', id: 'p1', name: 'Autre' }, { store });
    expect(result).toMatchObject({ status: 'error', reason: 'already_exists' });
    expect(projectExitCode(result)).toBe(1);
  });

  it('next-question : sélectionnée puis "aucune", toujours présentée comme règle fixe', () => {
    runProjectFlow({ op: 'create', id: 'p1', name: 'Boutique' }, { store });
    runProjectFlow({ op: 'add-question', id: 'p1', text: 'Quels produits ?' }, { store });

    const selected = runProjectFlow({ op: 'next-question', id: 'p1' }, { store });
    expect(describeProjectResult(selected).join('\n')).toMatch(/règle fixe/);
    expect(describeProjectResult(selected).join('\n')).toContain('Quels produits ?');
    expect(projectExitCode(selected)).toBe(0);

    const brief = store.get('p1')!;
    store.answerQuestion('p1', brief.questions[0]!.id, 'réponse');
    const none = runProjectFlow({ op: 'next-question', id: 'p1' }, { store });
    expect(describeProjectResult(none).join('\n')).toMatch(/règle fixe/);
    expect(describeProjectResult(none).join('\n')).toMatch(/[Aa]ucune question/);
  });

  it("répondre à une question n'ajoute ni fait ni décision", () => {
    runProjectFlow({ op: 'create', id: 'p1', name: 'Boutique' }, { store });
    runProjectFlow({ op: 'add-question', id: 'p1', text: 'Q' }, { store });
    const questionId = store.get('p1')!.questions[0]!.id;
    const result = runProjectFlow(
      { op: 'answer-question', id: 'p1', questionId, answer: 'R' },
      { store },
    );
    expect(result.status).toBe('ok');
    const brief = (result as { status: 'ok'; brief: ReturnType<FileProjectBriefStore['get']> })
      .brief!;
    expect(brief.facts).toHaveLength(0);
    expect(brief.decisions).toHaveLength(0);
  });
});
