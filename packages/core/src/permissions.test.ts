import { describe, expect, it } from 'vitest';

import { PermissionManager, SAFE_DEFAULT_DECISION } from './permissions.js';

describe('PermissionManager', () => {
  it('applique une règle « allow »', () => {
    const pm = new PermissionManager({ rules: { 'gmail.read': 'allow' } });
    expect(pm.decide('gmail.read')).toBe('allow');
  });

  it('applique une règle « deny »', () => {
    const pm = new PermissionManager({ rules: { 'gmail.delete': 'deny' } });
    expect(pm.decide('gmail.delete')).toBe('deny');
  });

  it('applique une règle « require_confirmation »', () => {
    const pm = new PermissionManager({ rules: { 'gmail.send': 'require_confirmation' } });
    expect(pm.decide('gmail.send')).toBe('require_confirmation');
  });

  it('refuse par défaut une action non listée (politique sûre)', () => {
    const pm = new PermissionManager({ rules: { 'gmail.read': 'allow' } });

    expect(pm.decide('outil.inconnu')).toBe('deny');
    expect(SAFE_DEFAULT_DECISION).toBe('deny');
  });

  it('n’est pas un système « allow everything » même sans aucune règle', () => {
    const pm = new PermissionManager();
    expect(pm.decide('quoi.que.ce.soit')).toBe('deny');
  });

  it('permet de choisir une politique par défaut explicite', () => {
    const pm = new PermissionManager({ default: 'require_confirmation' });
    expect(pm.decide('nouvel.outil')).toBe('require_confirmation');
  });

  it('setRule / clearRule modifient la décision', () => {
    const pm = new PermissionManager();

    pm.setRule('discord.send', 'allow');
    expect(pm.decide('discord.send')).toBe('allow');

    pm.clearRule('discord.send');
    expect(pm.decide('discord.send')).toBe('deny');
  });
});
