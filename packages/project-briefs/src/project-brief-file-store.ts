import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import {
  CURRENT_PROJECT_BRIEF_FILE_VERSION,
  LEGACY_PROJECT_BRIEF_FILE_VERSION,
  MAX_ANSWER_CHARS,
  MAX_ID_CHARS,
  MAX_ITEM_CHARS,
  MAX_LINKS_PER_ITEM,
  MAX_LIST_ITEMS,
  MAX_NAME_CHARS,
  type Decision,
  type ItemRef,
  type ProjectBrief,
  type Question,
  type SourcedItem,
  isBoundedNonEmptyText,
  isValidProjectId,
  nextStableId,
} from './project-brief.js';
import { ProjectBriefFileError, ProjectBriefStoreError } from './project-brief-errors.js';
import { parseProjectBriefFile, serializeProjectBriefFile } from './project-brief-file-format.js';
import { ProjectBriefLockError, acquireProjectBriefLock } from './project-brief-lock.js';

export interface FileProjectBriefStoreOptions {
  /** Répertoire contenant `<id>.json` (+ `<id>.json.lock` pendant une mutation). Créé à la première écriture. */
  readonly baseDir: string;
}

/**
 * Persistance **un fichier JSON par projet** — convention déjà établie par
 * `FileLegalCaseStore` (`@jarvis/legal-case-store`), reprise **par
 * inspiration**, jamais par import : ce package reste une feuille sans
 * dépendance `@jarvis/*`.
 *
 * À la différence de `FileMemoryStore` (une seule instance par process,
 * état mémoire mis en cache entre appels), **chaque opération relit le
 * fichier depuis le disque sous verrou** avant de muter : une commande CLI
 * est un process séparé à chaque invocation, donc un cache mémoire entre
 * deux appels n'existerait tout simplement jamais — relire est la seule
 * option correcte, pas une optimisation différée.
 */
export class FileProjectBriefStore {
  private readonly baseDir: string;

  constructor(options: FileProjectBriefStoreOptions) {
    this.baseDir = options.baseDir;
  }

  private filePathFor(id: string): string {
    return join(this.baseDir, `${id}.json`);
  }

  get(id: string): ProjectBrief | undefined {
    this.assertValidId(id);
    return this.loadFresh(this.filePathFor(id));
  }

  create(id: string, name: string): ProjectBrief {
    this.assertValidId(id);
    this.assertBoundedText(name, MAX_NAME_CHARS, 'name');
    return this.mutate(id, (current) => {
      if (current !== undefined) {
        throw new ProjectBriefStoreError('already_exists', `Le projet « ${id} » existe déjà.`);
      }
      const now = new Date().toISOString();
      return {
        id,
        name,
        formatVersion: LEGACY_PROJECT_BRIEF_FILE_VERSION,
        revision: 1,
        sources: [],
        facts: [],
        hypotheses: [],
        decisions: [],
        questions: [],
        createdAt: now,
        updatedAt: now,
      };
    });
  }

  addFact(id: string, text: string): ProjectBrief {
    this.assertBoundedText(text, MAX_ITEM_CHARS, 'text');
    return this.mutate(id, (current) => {
      const brief = this.requireExisting(id, current);
      this.assertListRoom(brief.facts, 'facts');
      const item = { id: nextStableId(brief.facts, 'fact'), text };
      return this.touch({ ...brief, facts: [...brief.facts, item] });
    });
  }

  addHypothesis(id: string, text: string): ProjectBrief {
    this.assertBoundedText(text, MAX_ITEM_CHARS, 'text');
    return this.mutate(id, (current) => {
      const brief = this.requireExisting(id, current);
      this.assertListRoom(brief.hypotheses, 'hypotheses');
      const item = { id: nextStableId(brief.hypotheses, 'hyp'), text };
      return this.touch({ ...brief, hypotheses: [...brief.hypotheses, item] });
    });
  }

  addQuestion(id: string, text: string): ProjectBrief {
    this.assertBoundedText(text, MAX_ITEM_CHARS, 'text');
    return this.mutate(id, (current) => {
      const brief = this.requireExisting(id, current);
      this.assertListRoom(brief.questions, 'questions');
      const item: Question = { id: nextStableId(brief.questions, 'q'), text, status: 'open' };
      return this.touch({ ...brief, questions: [...brief.questions, item] });
    });
  }

  /**
   * Ne promeut jamais la réponse en fait ni en décision validée — ne touche
   * que `questions`. Refuse une question déjà `resolved` (`already_answered`)
   * — vérifié ici, sur la relecture fraîche faite par `mutate` à l'intérieur
   * du verrou, jamais sur un état potentiellement périmé : une résolution
   * concurrente entre la lecture d'un appelant et cet appel est donc
   * toujours détectée, jamais écrasée silencieusement. En cas de refus,
   * aucune écriture n'a lieu : réponse, révision et dates restent
   * inchangées.
   */
  answerQuestion(id: string, questionId: string, answer: string): ProjectBrief {
    this.assertBoundedText(answer, MAX_ANSWER_CHARS, 'answer');
    return this.mutate(id, (current) => {
      const brief = this.requireExisting(id, current);
      const index = brief.questions.findIndex((q) => q.id === questionId);
      if (index === -1) {
        throw new ProjectBriefStoreError(
          'unknown_question',
          `Question « ${questionId} » introuvable.`,
        );
      }
      const question = brief.questions[index]!;
      if (question.status !== 'open') {
        throw new ProjectBriefStoreError(
          'already_answered',
          `Question « ${questionId} » déjà résolue — réponse existante conservée, rien écrasé.`,
        );
      }
      const questions = brief.questions.slice();
      questions[index] = { ...question, status: 'resolved', answer };
      return this.touch({ ...brief, questions });
    });
  }

  addDecision(id: string, text: string): ProjectBrief {
    this.assertBoundedText(text, MAX_ITEM_CHARS, 'text');
    return this.mutate(id, (current) => {
      const brief = this.requireExisting(id, current);
      this.assertListRoom(brief.decisions, 'decisions');
      const item: Decision = { id: nextStableId(brief.decisions, 'dec'), text, status: 'proposed' };
      return this.touch({ ...brief, decisions: [...brief.decisions, item] });
    });
  }

  validateDecision(id: string, decisionId: string): ProjectBrief {
    return this.mutate(id, (current) => {
      const brief = this.requireExisting(id, current);
      const decision = this.requireDecision(brief, decisionId);
      if (decision.status !== 'proposed') {
        throw new ProjectBriefStoreError(
          'invalid_transition',
          decision.status === 'validated'
            ? `Décision « ${decisionId} » déjà validée.`
            : `Décision « ${decisionId} » obsolète : ne peut pas être validée.`,
        );
      }
      // validatedAt est une notion v2 : une fiche v1 passe en v2 à la validation (jamais à la lecture).
      return this.touch(
        asV2(
          this.replaceDecision(brief, decisionId, 'validated', {
            validatedAt: new Date().toISOString(),
          }),
        ),
      );
    });
  }

  obsoleteDecision(id: string, decisionId: string): ProjectBrief {
    return this.mutate(id, (current) => {
      const brief = this.requireExisting(id, current);
      this.requireDecision(brief, decisionId);
      return this.touch(this.replaceDecision(brief, decisionId, 'obsolete'));
    });
  }

  /**
   * Source **déclarée** par l'utilisateur — jamais vérifiée. Première notion
   * v2 : la fiche passe en `formatVersion: 2` et n'en redescend jamais.
   */
  addSource(id: string, text: string): ProjectBrief {
    this.assertBoundedText(text, MAX_ITEM_CHARS, 'text');
    return this.mutate(id, (current) => {
      const brief = this.requireExisting(id, current);
      this.assertListRoom(brief.sources, 'sources');
      const item = { id: nextStableId(brief.sources, 'src'), text };
      return this.touch(asV2({ ...brief, sources: [...brief.sources, item] }));
    });
  }

  /**
   * Relie un fait ou une hypothèse à une source existante. Reste permis
   * après validation d'une décision qui s'appuie sur cet élément : ce lien
   * enrichit la fiche, il ne constitue pas un instantané de justification.
   */
  linkSource(id: string, ref: ItemRef, sourceId: string): ProjectBrief {
    return this.mutate(id, (current) => {
      const brief = this.requireExisting(id, current);
      const item = this.requireItem(brief, ref);
      if (!brief.sources.some((s) => s.id === sourceId)) {
        throw new ProjectBriefStoreError('unknown_source', `Source « ${sourceId} » introuvable.`);
      }
      const sourceIds = item.sourceIds ?? [];
      if (sourceIds.includes(sourceId)) {
        throw new ProjectBriefStoreError(
          'already_linked',
          `« ${ref.id} » est déjà relié à la source « ${sourceId} ».`,
        );
      }
      this.assertLinkRoom(sourceIds, ref.id);
      const updated: SourcedItem = { ...item, sourceIds: [...sourceIds, sourceId] };
      const replace = (items: readonly SourcedItem[]): SourcedItem[] =>
        items.map((i) => (i.id === ref.id ? updated : i));
      return this.touch(
        asV2(
          ref.kind === 'fact'
            ? { ...brief, facts: replace(brief.facts) }
            : { ...brief, hypotheses: replace(brief.hypotheses) },
        ),
      );
    });
  }

  /**
   * Ajoute un fait ou une hypothèse à la justification (`basis`) d'une
   * décision **`proposed`** uniquement — refusé (`invalid_transition`) dès
   * qu'elle est validée ou obsolète. Ne change jamais le statut de la
   * décision : justifier n'est pas valider.
   */
  justifyDecision(id: string, decisionId: string, ref: ItemRef): ProjectBrief {
    return this.mutate(id, (current) => {
      const brief = this.requireExisting(id, current);
      const decision = this.requireDecision(brief, decisionId);
      if (decision.status !== 'proposed') {
        throw new ProjectBriefStoreError(
          'invalid_transition',
          `Décision « ${decisionId} » ${decision.status === 'validated' ? 'validée' : 'obsolète'} : ` +
            'sa justification ne peut plus être modifiée.',
        );
      }
      this.requireItem(brief, ref);
      const basis = decision.basis ?? [];
      if (basis.some((r) => r.kind === ref.kind && r.id === ref.id)) {
        throw new ProjectBriefStoreError(
          'already_linked',
          `« ${ref.id} » justifie déjà la décision « ${decisionId} ».`,
        );
      }
      this.assertLinkRoom(basis, decisionId);
      const updated: Decision = { ...decision, basis: [...basis, { kind: ref.kind, id: ref.id }] };
      const decisions = brief.decisions.map((d) => (d.id === decisionId ? updated : d));
      return this.touch(asV2({ ...brief, decisions }));
    });
  }

  // ── aides internes ─────────────────────────────────────────────────────

  private requireItem(brief: ProjectBrief, ref: ItemRef): SourcedItem {
    const items = ref.kind === 'fact' ? brief.facts : brief.hypotheses;
    const item = items.find((i) => i.id === ref.id);
    if (item === undefined) {
      throw new ProjectBriefStoreError(
        'unknown_item',
        `${ref.kind === 'fact' ? 'Fait' : 'Hypothèse'} « ${ref.id} » introuvable.`,
      );
    }
    return item;
  }

  private assertLinkRoom(links: readonly unknown[], itemId: string): void {
    if (links.length >= MAX_LINKS_PER_ITEM) {
      throw new ProjectBriefStoreError(
        'invalid_input',
        `Limite de liens atteinte pour « ${itemId} » (${MAX_LINKS_PER_ITEM} maximum).`,
      );
    }
  }

  private requireDecision(brief: ProjectBrief, decisionId: string): Decision {
    const decision = brief.decisions.find((d) => d.id === decisionId);
    if (decision === undefined) {
      throw new ProjectBriefStoreError(
        'unknown_decision',
        `Décision « ${decisionId} » introuvable.`,
      );
    }
    return decision;
  }

  private replaceDecision(
    brief: ProjectBrief,
    decisionId: string,
    status: Decision['status'],
    extra: Pick<Decision, 'validatedAt'> = {},
  ): ProjectBrief {
    const decisions = brief.decisions.map((d) =>
      d.id === decisionId ? { ...d, status, ...extra } : d,
    );
    return { ...brief, decisions };
  }

  private requireExisting(id: string, current: ProjectBrief | undefined): ProjectBrief {
    if (current === undefined) {
      throw new ProjectBriefStoreError('not_found', `Le projet « ${id} » n'existe pas.`);
    }
    return current;
  }

  private touch(brief: ProjectBrief): ProjectBrief {
    return { ...brief, revision: brief.revision + 1, updatedAt: new Date().toISOString() };
  }

  private assertValidId(id: string): void {
    if (!isValidProjectId(id)) {
      throw new ProjectBriefStoreError(
        'invalid_id',
        `Identifiant de projet invalide : « ${id} » (attendu : 1 à ${MAX_ID_CHARS} caractères parmi lettres, chiffres, « - », « _ »).`,
      );
    }
  }

  private assertBoundedText(value: string, maxChars: number, field: string): void {
    if (!isBoundedNonEmptyText(value, maxChars)) {
      throw new ProjectBriefStoreError(
        'invalid_input',
        `Champ « ${field} » invalide : texte non vide, ${maxChars} caractères maximum.`,
      );
    }
  }

  private assertListRoom(items: readonly unknown[], field: string): void {
    if (items.length >= MAX_LIST_ITEMS) {
      throw new ProjectBriefStoreError(
        'invalid_input',
        `Limite atteinte pour « ${field} » (${MAX_LIST_ITEMS} éléments maximum).`,
      );
    }
  }

  /**
   * Lit, mute et réécrit sous verrou — relecture fraîche systématique (pas
   * de cache), donc aucune commande concurrente ne peut écraser en silence
   * le résultat d'une autre : la seconde à obtenir le verrou voit toujours
   * l'état écrit par la première.
   */
  private mutate(
    id: string,
    mutator: (current: ProjectBrief | undefined) => ProjectBrief,
  ): ProjectBrief {
    this.assertValidId(id);
    const filePath = this.filePathFor(id);
    let release: () => void;
    try {
      release = acquireProjectBriefLock(filePath);
    } catch (err) {
      if (err instanceof ProjectBriefLockError) {
        throw new ProjectBriefStoreError('locked', err.message);
      }
      throw err;
    }
    try {
      const current = this.loadFresh(filePath);
      const next = mutator(current);
      this.writeAtomic(filePath, next);
      return next;
    } finally {
      release();
    }
  }

  private loadFresh(filePath: string): ProjectBrief | undefined {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }
    if (raw.trim().length === 0) {
      throw new ProjectBriefFileError('empty_file', filePath);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProjectBriefFileError('invalid_json', filePath);
    }
    return parseProjectBriefFile(parsed, filePath);
  }

  /**
   * Répertoire et fichiers créés en mode privé (`0700`/`0600`, jamais lus
   * via l'umask seul) — jamais lisibles/inscriptibles par un autre compte
   * local sous WSL. En cas d'échec (écriture, fsync ou rename), le fichier
   * temporaire **propre à cette opération** (suffixe pid+aléatoire unique)
   * est supprimé au mieux puis l'erreur d'origine est propagée — ni le
   * fichier `filePath` existant, ni le fichier temporaire d'une autre
   * opération en cours ne sont jamais touchés.
   */
  private writeAtomic(filePath: string, brief: ProjectBrief): void {
    const serialized = serializeProjectBriefFile(brief);
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });

    const tempPath = `${filePath}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
    try {
      const handle = openSync(tempPath, 'w', 0o600);
      try {
        writeFileSync(handle, serialized, 'utf-8');
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
      renameSync(tempPath, filePath);
    } catch (err) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Best effort — peut ne pas exister si l'échec est survenu avant
        // l'ouverture ; une erreur de nettoyage ne doit jamais masquer
        // l'erreur réelle, propagée ci-dessous.
      }
      throw err;
    }
  }
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/** Passage v1 → v2 à la première notion v2 ; idempotent, jamais l'inverse. */
function asV2(brief: ProjectBrief): ProjectBrief {
  return { ...brief, formatVersion: CURRENT_PROJECT_BRIEF_FILE_VERSION };
}
