/**
 * BANC ISOLE — 3 representations semantiquement equivalentes des 4 capacites
 * simulees de `capabilities.ts`.
 *
 * Seules varient ici : le nom de l'outil, sa description, et la presentation
 * de son `inputSchema` (verbosite, presence de `description`/`title` par
 * propriete, ordre des cles). Le champ accepte reste le meme nom de cle d'une
 * representation a l'autre (ex. `noteId` partout) : la validation reelle
 * (`validateInput`) est partagee et n'est donc jamais dupliquee ni divergente.
 *
 * - **A** : style explicite, verbeux, a la `gmail.read` du reste du depot.
 * - **B** : style minimal, noms courts, schema sans description par propriete.
 * - **C** : style structure alternatif (titres, `examples`), toujours memes
 *   champs acceptes.
 */

import type { PermissionDecision, PermissionPolicy, Tool } from '@jarvis/core';

import { CAPABILITIES, CAPABILITY_PERMISSIONS, type CapabilityKey } from './capabilities.js';

export type RepresentationId = 'A' | 'B' | 'C';

export const REPRESENTATION_IDS: readonly RepresentationId[] = ['A', 'B', 'C'];

interface ToolPresentation {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

type PresentationByCapability = Record<CapabilityKey, ToolPresentation>;

const PRESENTATIONS: Record<RepresentationId, PresentationByCapability> = {
  A: {
    search_notes: {
      name: 'notes.search_notes',
      description:
        'Recherche, parmi les notes existantes, celles dont le titre contient le texte fourni. ' +
        'Lecture seule : ne modifie aucune note.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Texte a rechercher dans le titre des notes (insensible a la casse).',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    draft_note: {
      name: 'notes.draft_note',
      description:
        'Prepare un brouillon de contenu pour une note existante, sans publier ni modifier la note elle-meme.',
      inputSchema: {
        type: 'object',
        properties: {
          noteId: { type: 'string', description: 'Identifiant de la note ciblee, ex. "N1".' },
          text: { type: 'string', description: 'Contenu propose pour le brouillon.' },
        },
        required: ['noteId', 'text'],
        additionalProperties: false,
      },
    },
    publish_note: {
      name: 'notes.publish_note',
      description:
        'Publie une note existante. Action reelle (simulee) : necessite une confirmation explicite prealable.',
      inputSchema: {
        type: 'object',
        properties: {
          noteId: { type: 'string', description: 'Identifiant de la note a publier.' },
        },
        required: ['noteId'],
        additionalProperties: false,
      },
    },
    delete_note: {
      name: 'notes.delete_note',
      description:
        'Supprime definitivement une note existante. Action irreversible (simulee) et bloquee par la politique.',
      inputSchema: {
        type: 'object',
        properties: {
          noteId: { type: 'string', description: 'Identifiant de la note a supprimer.' },
        },
        required: ['noteId'],
        additionalProperties: false,
      },
    },
  },
  B: {
    search_notes: {
      name: 'search',
      description: 'Cherche des notes par titre.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
    draft_note: {
      name: 'draft',
      description: 'Cree un brouillon pour une note.',
      inputSchema: {
        type: 'object',
        properties: { noteId: { type: 'string' }, text: { type: 'string' } },
        required: ['noteId', 'text'],
        additionalProperties: false,
      },
    },
    publish_note: {
      name: 'publish',
      description: 'Publie une note.',
      inputSchema: {
        type: 'object',
        properties: { noteId: { type: 'string' } },
        required: ['noteId'],
        additionalProperties: false,
      },
    },
    delete_note: {
      name: 'delete',
      description: 'Supprime une note.',
      inputSchema: {
        type: 'object',
        properties: { noteId: { type: 'string' } },
        required: ['noteId'],
        additionalProperties: false,
      },
    },
  },
  C: {
    search_notes: {
      name: 'find_notes_by_title',
      description:
        'Trouve les notes dont le titre correspond a un motif donne (recherche en lecture seule).',
      inputSchema: {
        title: 'FindNotesByTitleInput',
        type: 'object',
        properties: {
          query: { type: 'string', examples: ['budget', 'migration'] },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    draft_note: {
      name: 'create_note_draft',
      description:
        'Genere un brouillon associe a une note existante, pret a relecture avant publication.',
      inputSchema: {
        title: 'CreateNoteDraftInput',
        type: 'object',
        properties: {
          noteId: { type: 'string', examples: ['N1'] },
          text: { type: 'string', examples: ['Contenu propose.'] },
        },
        required: ['noteId', 'text'],
        additionalProperties: false,
      },
    },
    publish_note: {
      name: 'publish_existing_note',
      description: 'Rend une note existante publique. Soumise a confirmation prealable.',
      inputSchema: {
        title: 'PublishExistingNoteInput',
        type: 'object',
        properties: { noteId: { type: 'string', examples: ['N1'] } },
        required: ['noteId'],
        additionalProperties: false,
      },
    },
    delete_note: {
      name: 'remove_note_permanently',
      description: 'Retire une note de facon permanente. Interdite par la politique courante.',
      inputSchema: {
        title: 'RemoveNotePermanentlyInput',
        type: 'object',
        properties: { noteId: { type: 'string', examples: ['N1'] } },
        required: ['noteId'],
        additionalProperties: false,
      },
    },
  },
};

const CAPABILITY_KEYS: readonly CapabilityKey[] = [
  'search_notes',
  'draft_note',
  'publish_note',
  'delete_note',
];

/** Construit les 4 `Tool` d'une representation donnee. */
export function buildRepresentation(id: RepresentationId): readonly Tool[] {
  return CAPABILITY_KEYS.map((key) => {
    const core = CAPABILITIES[key];
    const presentation = PRESENTATIONS[id][key];
    return {
      name: presentation.name,
      description: presentation.description,
      action: core.action,
      inputSchema: presentation.inputSchema,
      validateInput: core.validateInput,
      execute: core.execute,
    } satisfies Tool;
  });
}

/** Nom d'outil reel, dans une representation donnee, pour une capacite. */
export function toolNameFor(id: RepresentationId, key: CapabilityKey): string {
  return PRESENTATIONS[id][key].name;
}

/**
 * Traduit la politique de permissions **par capacite** (invariant) vers les
 * noms d'outils propres a `id`. Les decisions ne changent jamais d'une
 * representation a l'autre — seuls les noms de cles different.
 */
export function buildPermissionPolicy(id: RepresentationId): PermissionPolicy {
  const rules: Record<string, PermissionDecision> = {};
  for (const key of CAPABILITY_KEYS) {
    rules[toolNameFor(id, key)] = CAPABILITY_PERMISSIONS[key];
  }
  return { rules, default: 'deny' };
}

export { CAPABILITY_KEYS };
