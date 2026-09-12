import { describe, expect, it } from 'vitest';

import { echoTool } from './echo.js';

describe('echoTool', () => {
  it('a les métadonnées attendues', () => {
    expect(echoTool.name).toBe('echo');
    expect(echoTool.action).toBe('read');
    expect(typeof echoTool.description).toBe('string');
  });

  it('expose un inputSchema JSON Schema cohérent avec validateInput', () => {
    const schema = echoTool.inputSchema;

    expect(typeof schema).toBe('object');
    expect(schema).not.toBeNull();
    expect(schema.type).toBe('object');

    // validateInput exige `text: string`, et rien d'autre.
    expect(Object.keys(schema.properties as object)).toEqual(['text']);
    expect((schema.properties as Record<string, Record<string, unknown>>).text.type).toBe('string');
    expect(schema.required).toEqual(['text']);

    // validateInput ignore (ne rejette pas) les clés inconnues → pas de verrou.
    expect(schema.additionalProperties).not.toBe(false);

    // Aucun champ sensible / interne.
    expect(JSON.stringify(schema)).not.toMatch(/account|token|secret|credential|oauth|api[_-]?key/);
  });

  it('valide et normalise une entrée correcte', () => {
    const result = echoTool.validateInput({ text: 'Bonjour', extra: 'ignoré' });

    expect(result).toEqual({ ok: true, value: { text: 'Bonjour' } });
  });

  it('rejette une entrée non-objet', () => {
    expect(echoTool.validateInput('Bonjour').ok).toBe(false);
    expect(echoTool.validateInput(null).ok).toBe(false);
    expect(echoTool.validateInput(42).ok).toBe(false);
  });

  it('rejette une entrée sans champ « text » valide', () => {
    expect(echoTool.validateInput({}).ok).toBe(false);
    expect(echoTool.validateInput({ text: 123 }).ok).toBe(false);
  });

  it('exécute en renvoyant le texte tel quel', async () => {
    const output = await echoTool.execute({ text: 'Bonjour' });
    expect(output).toEqual({ text: 'Bonjour' });
  });
});
