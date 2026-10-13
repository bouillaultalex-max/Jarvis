/**
 * Sélection stricte du mode du canal — **aucun repli synthétique**. Lu une
 * seule fois, au bootstrap (`main.ts`), jamais redécidé en cours de route.
 */
export type ChannelMode = 'simulated' | 'real';

const KNOWN_MODES: readonly ChannelMode[] = ['simulated', 'real'];

/** Valeur de `WHATSAPP_CHANNEL_MODE` ni absente ni reconnue — jamais interprétée comme « simulated » par défaut. */
export class InvalidChannelModeError extends Error {
  constructor(public readonly value: string) {
    super(
      `WHATSAPP_CHANNEL_MODE="${value}" invalide — valeurs acceptées : ` +
        `${KNOWN_MODES.map((m) => `"${m}"`).join(' ou ')}. Aucun repli silencieux vers un mode par défaut.`,
    );
    this.name = 'InvalidChannelModeError';
  }
}

/**
 * `WHATSAPP_CHANNEL_MODE` absent ou vide → `'simulated'` (défaut explicite,
 * documenté, pas un accident). Toute autre valeur non reconnue → échec
 * contrôlé ({@link InvalidChannelModeError}) — jamais un repli silencieux
 * vers `'simulated'` pour une valeur mal orthographiée (ex. `"Real"`,
 * `"prod"`) qui pourrait laisser croire à tort que le mode réel est actif.
 */
export function resolveChannelMode(env: Readonly<Record<string, string | undefined>>): ChannelMode {
  const raw = env.WHATSAPP_CHANNEL_MODE;
  if (raw === undefined || raw === '') {
    return 'simulated';
  }
  if ((KNOWN_MODES as readonly string[]).includes(raw)) {
    return raw as ChannelMode;
  }
  throw new InvalidChannelModeError(raw);
}
