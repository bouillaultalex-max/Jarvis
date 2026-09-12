import { type Tool, type ToolValidationResult, invalid, valid } from '@jarvis/core';

export interface EchoInput {
  readonly text: string;
}

export interface EchoOutput {
  readonly text: string;
}

/**
 * Outil de démonstration : renvoie tel quel le texte fourni.
 *
 * Aucun réseau, aucun accès disque, aucun effet de bord. Sert uniquement à
 * exercer le registre, la validation et les permissions.
 *
 *   input  : { "text": "Bonjour" }
 *   output : { "text": "Bonjour" }
 */
export const echoTool: Tool<EchoInput, EchoOutput> = {
  name: 'echo',
  description: 'Renvoie le texte fourni sans modification (outil de démonstration).',
  action: 'read',

  // `validateInput` exige `text: string` et ignore silencieusement toute autre
  // clé (il ne la rejette pas) → pas d'`additionalProperties: false`.
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Texte à renvoyer tel quel.' },
    },
    required: ['text'],
  },

  validateInput(input: unknown): ToolValidationResult<EchoInput> {
    if (typeof input !== 'object' || input === null) {
      return invalid("echo : l'entrée doit être un objet { text: string }.");
    }
    const { text } = input as Record<string, unknown>;
    if (typeof text !== 'string') {
      return invalid('echo : le champ « text » est requis et doit être une chaîne.');
    }
    return valid({ text });
  },

  async execute(input: EchoInput): Promise<EchoOutput> {
    return { text: input.text };
  },
};
