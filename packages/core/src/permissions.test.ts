import { describe, expect, it } from 'vitest';

import { PermissionManager, SAFE_DEFAULT_DECISION } from './permissions.js';

describe('PermissionManager', () => {
  it('applique une règle « allow » (par nom d’outil)', () => {
    const pm = new PermissionManager({ rules: { 'gmail.read': 'allow' } });
    expect(pm.decide('gmail.read', 'read')).toBe('allow');
  });

  it('applique une règle « deny »', () => {
    const pm = new PermissionManager({ rules: { 'gmail.delete': 'deny' } });
    expect(pm.decide('gmail.delete', 'execute')).toBe('deny');
  });

  it('applique une règle « require_confirmation »', () => {
    const pm = new PermissionManager({ rules: { 'gmail.send': 'require_confirmation' } });
    expect(pm.decide('gmail.send', 'execute')).toBe('require_confirmation');
  });

  it('refuse par défaut une action non listée (politique sûre)', () => {
    const pm = new PermissionManager({ rules: { 'gmail.read': 'allow' } });

    expect(pm.decide('outil.inconnu', 'execute')).toBe('deny');
    expect(SAFE_DEFAULT_DECISION).toBe('deny');
  });

  it('n’est pas un système « allow everything » même sans aucune règle', () => {
    const pm = new PermissionManager();
    expect(pm.decide('quoi.que.ce.soit', 'read')).toBe('deny');
    expect(pm.decide('quoi.que.ce.soit', 'prepare')).toBe('deny');
    expect(pm.decide('quoi.que.ce.soit', 'execute')).toBe('deny');
  });

  it('applique un défaut par niveau d’action', () => {
    const pm = new PermissionManager({
      actionDefaults: { read: 'allow', prepare: 'allow', execute: 'require_confirmation' },
    });

    expect(pm.decide('n.importe.quoi.read', 'read')).toBe('allow');
    expect(pm.decide('n.importe.quoi.draft', 'prepare')).toBe('allow');
    expect(pm.decide('n.importe.quoi.send', 'execute')).toBe('require_confirmation');
  });

  it('une règle explicite d’outil l’emporte sur le défaut de niveau d’action', () => {
    const pm = new PermissionManager({
      rules: { 'gmail.read': 'deny' },
      actionDefaults: { read: 'allow' },
    });

    expect(pm.decide('gmail.read', 'read')).toBe('deny');
    expect(pm.decide('calendar.read', 'read')).toBe('allow');
  });

  it('permet de choisir une politique par défaut globale explicite', () => {
    const pm = new PermissionManager({ default: 'require_confirmation' });
    expect(pm.decide('nouvel.outil', 'execute')).toBe('require_confirmation');
  });

  it('setRule / clearRule modifient la décision', () => {
    const pm = new PermissionManager();

    pm.setRule('discord.send', 'allow');
    expect(pm.decide('discord.send', 'execute')).toBe('allow');

    pm.clearRule('discord.send');
    expect(pm.decide('discord.send', 'execute')).toBe('deny');
  });
});
