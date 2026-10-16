/**
 * Fixture de test — process séparé qui tente **une seule** mutation réelle
 * (`addFact`) via `FileProjectBriefStore`, et imprime le résultat en JSON
 * sur une ligne, succès ou échec confondus (jamais une exception qui
 * ferait planter le process — le parent doit pouvoir lire un résultat
 * structuré même en cas de verrou déjà détenu par un autre process).
 *
 * Usage : `tsx mutate-once-process.ts <baseDir> <id> <texte>`
 */
import { ProjectBriefStoreError } from '../project-brief-errors.js';
import { FileProjectBriefStore } from '../project-brief-file-store.js';

const [baseDir, id, text] = process.argv.slice(2);
if (baseDir === undefined || id === undefined || text === undefined) {
  process.stderr.write('usage: mutate-once-process <baseDir> <id> <texte>\n');
  process.exit(2);
}

const store = new FileProjectBriefStore({ baseDir });
try {
  const brief = store.addFact(id, text);
  process.stdout.write(
    `${JSON.stringify({ ok: true, revision: brief.revision, factCount: brief.facts.length })}\n`,
  );
} catch (err) {
  if (err instanceof ProjectBriefStoreError) {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: err.reason })}\n`);
  } else {
    process.stdout.write(
      `${JSON.stringify({ ok: false, reason: 'unexpected', message: String(err) })}\n`,
    );
  }
}
