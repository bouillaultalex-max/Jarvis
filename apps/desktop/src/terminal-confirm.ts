import { createInterface } from 'node:readline';

import type { ConfirmationRequest } from '@jarvis/connectors';

/**
 * Confirmation utilisateur au terminal pour un envoi Gmail — M8-B5.
 *
 * Produit le callback `confirm` injecté dans `runGmailSend` (M8-B4). Affiche
 * **uniquement** des champs du `ConfirmationRequest` prévus par le contrat
 * (`toolName`/`action`, `account.accountIdentifier`, et le résumé
 * `summary.fields` déjà construit — gelé et sans secret — par
 * `buildGmailSendConfirmationSummary`). Ne sérialise jamais l'objet complet,
 * n'affiche ni `confirmationId`, ni horodatage, ni aucun secret.
 *
 * Accepte l'envoi uniquement sur `y` / `yes` / `oui` (insensible à la casse
 * et aux espaces de bord). Toute autre réponse, une ligne vide, ou EOF valent
 * refus — défaut sûr, cohérent avec « confirmation obligatoire ».
 */

export interface TerminalConfirmIo {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

const ACCEPTED_ANSWERS = new Set(['y', 'yes', 'oui']);

export function createTerminalConfirm(
  io: TerminalConfirmIo = {},
): (request: ConfirmationRequest) => Promise<boolean> {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;

  return async (request: ConfirmationRequest): Promise<boolean> => {
    const lines = [
      `Confirmation requise — ${request.toolName} (${request.action})`,
      `Compte : ${request.account.accountIdentifier}`,
      ...request.summary.fields.map(
        (field) => `${field.label} : ${field.value}${field.truncated === true ? ' […]' : ''}`,
      ),
    ];
    output.write(`${lines.join('\n')}\n`);

    const rl = createInterface({ input, output });
    try {
      const answer = await new Promise<string>((resolve) => {
        rl.question("Confirmer l'envoi ? [y/N] ", (value) => resolve(value));
        // EOF / flux fermé sans ligne → refus.
        rl.once('close', () => resolve(''));
      });
      return ACCEPTED_ANSWERS.has(answer.trim().toLowerCase());
    } finally {
      rl.close();
    }
  };
}
