import type { GmailPrepareReplyInput } from '@jarvis/connectors';

/**
 * Parse les arguments de la sous-commande `prepare-reply` de `apps/desktop`.
 *
 *   prepare-reply --messageId <id> --body <corps>
 *
 * Fonction pure : aucune E/S, aucune lecture d'environnement, aucun effet de
 * bord. Structure uniquement l'entrée — la validation de fond (`messageId` et
 * `body` non vides, rejet de toute clé inconnue) reste faite par
 * `gmail.prepare_reply.validateInput` via `ToolExecutor` (`packages/connectors`,
 * inchangé). Même discipline que {@link parseGmailSendArgs} (`gmail-send-args.ts`).
 *
 * Discipline des messages d'erreur (convention du dépôt, cf. `gmail-auth.ts` /
 * `gmail-send-args.ts`) : ne citer que des **noms d'options**, jamais la
 * valeur fournie par l'utilisateur.
 */

const KNOWN_FLAGS = ['messageId', 'body'] as const;
type KnownFlag = (typeof KNOWN_FLAGS)[number];
const REQUIRED_FLAGS: readonly KnownFlag[] = ['messageId', 'body'];

function isKnownFlag(name: string): name is KnownFlag {
  return (KNOWN_FLAGS as readonly string[]).includes(name);
}

/** Forme d'un nom d'option — sert à ne jamais échoer un token de type valeur. */
const OPTION_NAME_PATTERN = /^[a-z][a-z0-9-]*$/i;

/**
 * Message d'« option inconnue ». N'échoue le nom que s'il a la forme d'un nom
 * d'option ; un token malformé ressemblant à une valeur produit un message
 * générique, jamais un écho de son contenu.
 */
function unknownOptionMessage(name: string): string {
  const known = ' (connues : --messageId, --body).';
  return OPTION_NAME_PATTERN.test(name)
    ? `prepare-reply : option inconnue « --${name} »${known}`
    : `prepare-reply : option inconnue${known}`;
}

export function parsePrepareReplyArgs(argv: readonly string[]): GmailPrepareReplyInput {
  const values: Partial<Record<KnownFlag, string>> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;

    if (!token.startsWith('--')) {
      throw new Error(
        'prepare-reply : argument positionnel inattendu (seules les options --messageId/--body sont acceptées).',
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
        throw new Error(`prepare-reply : valeur manquante pour l'option « --${name} ».`);
      }
      value = next;
      i += 1;
    }

    if (values[name] !== undefined) {
      throw new Error(`prepare-reply : option « --${name} » fournie plusieurs fois.`);
    }
    values[name] = value;
  }

  const missing = REQUIRED_FLAGS.filter((flag) => values[flag] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `prepare-reply : option(s) requise(s) manquante(s) : ${missing.map((flag) => `--${flag}`).join(', ')}.`,
    );
  }

  return { messageId: values.messageId!, body: values.body! };
}
