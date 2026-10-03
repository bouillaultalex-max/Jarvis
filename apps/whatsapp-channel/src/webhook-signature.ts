/**
 * Vérification de signature générique, calquée sur le motif confirmé en
 * source primaire (`developers.facebook.com/docs/graph-api/webhooks/getting-started`) :
 * HMAC-SHA256 sur les octets bruts du corps, avec le secret d'application,
 * exposé en en-tête `X-Hub-Signature-256: sha256=<hex>`. Primitive Node
 * native uniquement (`node:crypto`) — aucun SDK supplémentaire.
 *
 * Repris à l'identique de `prototypes/whatsapp-channel/webhook-signature.ts`
 * (implémentation de référence désormais ici — voir `channel-ports.ts`).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { SignatureVerificationResult, SignatureVerifier } from './channel-ports.js';

const SIGNATURE_PREFIX = 'sha256=';

/**
 * Calcule la signature HMAC-SHA256 attendue pour `rawBody` avec `appSecret`.
 * Exporté séparément pour que les fixtures de test puissent construire des
 * corps signés valides sans dupliquer la logique de vérification.
 */
export function computeSignature(rawBody: Buffer, appSecret: string): string {
  const digest = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return `${SIGNATURE_PREFIX}${digest}`;
}

/**
 * Vérificateur générique "X-Hub-Signature-256". La comparaison utilise
 * `timingSafeEqual` (résistante aux attaques temporelles) et vérifie
 * d'abord l'égalité des longueurs — `timingSafeEqual` lève sur des buffers
 * de longueurs différentes, ce qui romprait la vérification sur toute
 * signature malformée si non gardé explicitement.
 */
export class HmacSha256SignatureVerifier implements SignatureVerifier {
  constructor(private readonly appSecret: string) {}

  verify(rawBody: Buffer, signatureHeader: string | undefined): SignatureVerificationResult {
    if (signatureHeader === undefined) {
      return { status: 'invalid', reason: 'En-tête de signature absent.' };
    }
    if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
      return { status: 'invalid', reason: 'Préfixe de signature inattendu (« sha256= » requis).' };
    }

    const expected = computeSignature(rawBody, this.appSecret);
    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(signatureHeader, 'utf8');

    if (expectedBuf.length !== actualBuf.length) {
      return { status: 'invalid', reason: 'Signature de longueur inattendue.' };
    }
    if (!timingSafeEqual(expectedBuf, actualBuf)) {
      return { status: 'invalid', reason: 'Signature invalide.' };
    }
    return { status: 'valid' };
  }
}
