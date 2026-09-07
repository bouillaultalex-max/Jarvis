import type { GmailSendInput } from '@jarvis/connectors';

/**
 * Parse les arguments de la sous-commande `send` de `apps/desktop` — M8-B5.
 *
 *   send --to <email> --subject <sujet> --body <corps> [--threadId <id>]
 *
 * Fonction pure : aucune E/S, aucune lecture d'environnement, aucun effet de
 * bord. Structure uniquement l'entrée — la validation de fond (`to` non vide,
 * types, rejet de toute clé inconnue) reste faite par
 * `gmail.send.validateInput` via `ToolExecutor`, inchangé.
 *
 * Discipline des messages d'erreur (convention du dépôt, cf. `gmail-auth.ts`) :
 * ne citer que des **noms d'options**, jamais la valeur fournie par
 * l'utilisateur.
 */

const KNOWN_FLAGS = ['to', 'subject', 'body', 'threadId'] as const;
type KnownFlag = (typeof KNOWN_FLAGS)[number];
const REQUIRED_FLAGS: readonly KnownFlag[] = ['to', 'subject', 'body'];

function isKnownFlag(name: string): name is KnownFlag {
  return (KNOWN_FLAGS as readonly string[]).includes(name);
}

/** Forme d'un nom d'option — sert à ne jamais échoer un token de type valeur. */
const OPTION_NAME_PATTERN = /^[a-z][a-z0-9-]*$/i;

/**
 * Message d'« option inconnue ». N'échoue le nom que s'il a la forme d'un nom
 * d'option ; un token malformé ressemblant à une valeur (ex.
 * `--dest@example.test`) produit un message générique, jamais un écho de son
 * contenu — cf. la discipline de l'en-tête de ce fichier.
 */
function unknownOptionMessage(name: string): string {
  const known = ' (connues : --to, --subject, --body, --threadId).';
  return OPTION_NAME_PATTERN.test(name)
    ? `send : option inconnue « --${name} »${known}`
    : `send : option inconnue${known}`;
}

export function parseGmailSendArgs(argv: readonly string[]): GmailSendInput {
  const values: Partial<Record<KnownFlag, string>> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;

    if (!token.startsWith('--')) {
      throw new Error(
        'send : argument positionnel inattendu (seules les options --to/--subject/--body/--threadId sont acceptées).',
      );
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
        throw new Error(`send : valeur manquante pour l'option « --${name} ».`);
      }
      value = next;
      i += 1;
    }

    if (values[name] !== undefined) {
      throw new Error(`send : option « --${name} » fournie plusieurs fois.`);
    }
    values[name] = value;
  }

  const missing = REQUIRED_FLAGS.filter((flag) => values[flag] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `send : option(s) requise(s) manquante(s) : ${missing.map((flag) => `--${flag}`).join(', ')}.`,
    );
  }

  return {
    to: values.to!,
    subject: values.subject!,
    body: values.body!,
    ...(values.threadId !== undefined ? { threadId: values.threadId } : {}),
  };
}
