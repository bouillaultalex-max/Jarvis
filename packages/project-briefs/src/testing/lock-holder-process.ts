/**
 * Fixture de test — process séparé qui détient un verrou jusqu'à réception
 * d'une ligne `RELEASE` sur stdin, ou jusqu'à être tué de l'extérieur
 * (test d'arrêt brutal). Jamais importé par le code de production (dossier
 * `testing/`, exclu de `architecture-boundaries.test.ts`).
 *
 * Usage : `tsx lock-holder-process.ts <chemin-fichier>`
 * stdout : `LOCKED` dès l'acquisition, puis `RELEASED` après libération.
 */
import { createInterface } from 'node:readline';

import { acquireProjectBriefLock } from '../project-brief-lock.js';

const filePath = process.argv[2];
if (filePath === undefined) {
  process.stderr.write('usage: lock-holder-process <filePath>\n');
  process.exit(2);
}

const release = acquireProjectBriefLock(filePath);
process.stdout.write('LOCKED\n');

const rl = createInterface({ input: process.stdin });
rl.once('line', (line) => {
  rl.close();
  if (line.trim() === 'RELEASE') {
    release();
    process.stdout.write('RELEASED\n');
  }
  process.exit(0);
});
