import { describe, expect, it } from 'vitest';

import { InvalidChannelModeError, resolveChannelMode } from './channel-mode.js';

describe('resolveChannelMode — sélection stricte, aucun repli synthétique', () => {
  it("absent ou vide → 'simulated' (défaut explicite)", () => {
    expect(resolveChannelMode({})).toBe('simulated');
    expect(resolveChannelMode({ WHATSAPP_CHANNEL_MODE: '' })).toBe('simulated');
  });

  it("'simulated' et 'real' sont acceptés tels quels", () => {
    expect(resolveChannelMode({ WHATSAPP_CHANNEL_MODE: 'simulated' })).toBe('simulated');
    expect(resolveChannelMode({ WHATSAPP_CHANNEL_MODE: 'real' })).toBe('real');
  });

  it("valeur inconnue (ex. typo 'Real', 'prod') → erreur contrôlée, JAMAIS un repli silencieux vers 'simulated'", () => {
    expect(() => resolveChannelMode({ WHATSAPP_CHANNEL_MODE: 'Real' })).toThrow(
      InvalidChannelModeError,
    );
    expect(() => resolveChannelMode({ WHATSAPP_CHANNEL_MODE: 'prod' })).toThrow(
      InvalidChannelModeError,
    );
  });

  it("le message d'erreur cite la valeur fautive mais jamais une valeur de secret (il n'y en a aucune ici)", () => {
    try {
      resolveChannelMode({ WHATSAPP_CHANNEL_MODE: 'bogus' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidChannelModeError);
      expect((err as InvalidChannelModeError).message).toContain('bogus');
    }
  });
});
