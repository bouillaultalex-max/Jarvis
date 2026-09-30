/**
 * Parse les arguments de la sous-commande `legal-search` de `apps/desktop`.
 *
 *   legal-search --asOf <YYYY-MM-DD> "<texte de recherche>"
 *
 * Fonction pure : aucune E/S, aucune lecture d'environnement, aucun accès
 * aux credentials ni au fournisseur, aucun effet de bord — la validation de
 * forme (texte non vide, date calendaire réelle) est entièrement locale et
 * s'exécute avant toute résolution de secrets ou construction de client.
 * Discipline des options nommées identique à {@link parseGmailSendArgs}/
 * {@link parsePrepareReplyArgs} (`gmail-send-args.ts`/`prepare-reply-args.ts`) ;
 * l'unique argument positionnel (le texte de recherche) suit la même
 * discipline que `parseReadNaturalArgs` (`main.ts`).
 *
 * Discipline des messages d'erreur (convention du dépôt) : ne citer que des
 * **noms d'options**, jamais une valeur fournie par l'utilisateur.
 */

export interface LegalSearchInput {
  readonly text: string;
  /** Date calendaire ISO (YYYY-MM-DD), déjà vérifiée réelle — voir {@link isRealCalendarDate}. */
  readonly asOf: string;
}

const KNOWN_FLAGS = ['asOf'] as const;
type KnownFlag = (typeof KNOWN_FLAGS)[number];

function isKnownFlag(name: string): name is KnownFlag {
  return (KNOWN_FLAGS as readonly string[]).includes(name);
}

/** Forme d'un nom d'option — sert à ne jamais échoer un token de type valeur. */
const OPTION_NAME_PATTERN = /^[a-z][a-z0-9-]*$/i;

function unknownOptionMessage(name: string): string {
  const known = ' (connue : --asOf).';
  return OPTION_NAME_PATTERN.test(name)
    ? `legal-search : option inconnue « --${name} »${known}`
    : `legal-search : option inconnue${known}`;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Date calendaire **réelle** (rejette `2026-02-30`, mois `13`, etc.) — jamais
 * un simple test de forme `\d{4}-\d{2}-\d{2}`. Round-trip UTC : une date
 * invalide se normalise silencieusement (ex. 30 février → 2 mars) et le
 * round-trip ne correspond alors plus aux composants d'origine.
 */
function isRealCalendarDate(raw: string): boolean {
  const match = DATE_PATTERN.exec(raw);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function parseLegalSearchArgs(argv: readonly string[]): LegalSearchInput {
  const values: Partial<Record<KnownFlag, string>> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const eq = token.indexOf('=');
    const name = eq !== -1 ? token.slice(2, eq) : token.slice(2);

    // Valider le nom AVANT de lire une valeur : les messages qui suivent ne
    // citent donc `name` que lorsqu'il est garanti être l'un des KNOWN_FLAGS.
    if (!isKnownFlag(name)) {
      throw new Error(unknownOptionMessage(name));
    }

    let value: string;
    if (eq !== -1) {
      value = token.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`legal-search : valeur manquante pour l'option « --${name} ».`);
      }
      value = next;
      i += 1;
    }

    if (values[name] !== undefined) {
      throw new Error(`legal-search : option « --${name} » fournie plusieurs fois.`);
    }
    values[name] = value;
  }

  if (positionals.length === 0) {
    throw new Error(
      'legal-search : texte de recherche manquant (ex. legal-search --asOf 2026-01-01 "préavis licenciement").',
    );
  }
  if (positionals.length > 1) {
    throw new Error(
      'legal-search : un seul argument texte attendu, entre guillemets (plusieurs arguments positionnels reçus).',
    );
  }
  const [text] = positionals;
  if (text === undefined || text.length === 0) {
    throw new Error('legal-search : le texte de recherche est vide.');
  }

  if (values.asOf === undefined) {
    throw new Error('legal-search : option requise manquante : --asOf.');
  }
  if (!isRealCalendarDate(values.asOf)) {
    throw new Error(
      'legal-search : « --asOf » doit être une date calendaire réelle au format YYYY-MM-DD.',
    );
  }

  return { text, asOf: values.asOf };
}
