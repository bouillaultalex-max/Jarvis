import { closeSync, fsyncSync, openSync, unlinkSync, writeFileSync } from 'node:fs';

import { type FileProjectBriefStore, renderProjectBriefMarkdown } from '@jarvis/project-briefs';

/**
 * Écriture de fichier de la couche desktop, au-dessus du rendu **pur**
 * `renderProjectBriefMarkdown` (`@jarvis/project-briefs`, qui ne fait
 * aucune I/O). Lecture seule côté fiche JSON (`store.get`, jamais une
 * mutation) : la révision et le fichier source ne sont jamais modifiés par
 * un export.
 *
 * Création **exclusive** (`O_CREAT|O_EXCL`, drapeau `'wx'`) — même
 * technique que le verrou (`project-brief-lock.ts`) : un fichier
 * destination déjà existant ne peut jamais être écrasé, même si deux
 * exports visaient le même chemin en même temps — le système de fichiers
 * tranche, pas ce code.
 */
export interface ExportMarkdownInput {
  readonly id: string;
  readonly outputPath: string;
}

export interface ExportMarkdownDeps {
  readonly store: FileProjectBriefStore;
}

export type ExportMarkdownResult =
  | { readonly status: 'exported'; readonly outputPath: string; readonly revision: number }
  | { readonly status: 'not-found'; readonly id: string }
  | { readonly status: 'already-exists'; readonly outputPath: string }
  | { readonly status: 'write-error'; readonly message: string };

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

function describeFsError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function runExportMarkdownFlow(
  input: ExportMarkdownInput,
  deps: ExportMarkdownDeps,
): ExportMarkdownResult {
  const brief = deps.store.get(input.id);
  if (brief === undefined) {
    return { status: 'not-found', id: input.id };
  }
  const markdown = renderProjectBriefMarkdown(brief);

  let fd: number;
  try {
    fd = openSync(input.outputPath, 'wx', 0o600);
  } catch (err) {
    if (isErrnoException(err) && err.code === 'EEXIST') {
      return { status: 'already-exists', outputPath: input.outputPath };
    }
    return { status: 'write-error', message: describeFsError(err) };
  }

  try {
    try {
      writeFileSync(fd, markdown, 'utf-8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    // Le fichier a bien été créé (exclusivement) mais son écriture a
    // échoué : nettoyage au mieux pour ne jamais laisser un export
    // partiel au chemin demandé — jamais le fichier d'une autre opération.
    try {
      unlinkSync(input.outputPath);
    } catch {
      // Best effort — une erreur de nettoyage ne doit jamais masquer
      // l'erreur réelle, déjà capturée ci-dessous.
    }
    return { status: 'write-error', message: describeFsError(err) };
  }

  return { status: 'exported', outputPath: input.outputPath, revision: brief.revision };
}

export function describeExportMarkdownResult(result: ExportMarkdownResult): string[] {
  switch (result.status) {
    case 'exported':
      return [
        `Export écrit : ${result.outputPath} (révision ${result.revision} — fichier JSON source inchangé).`,
      ];
    case 'not-found':
      return [`Projet « ${result.id} » introuvable — aucun export créé.`];
    case 'already-exists':
      return [
        `Le fichier « ${result.outputPath} » existe déjà — aucun écrasement, aucun export créé.`,
      ];
    case 'write-error':
      return [`Erreur d'écriture : ${result.message}`];
  }
}

export function exportMarkdownExitCode(result: ExportMarkdownResult): number {
  return result.status === 'exported' ? 0 : 1;
}
