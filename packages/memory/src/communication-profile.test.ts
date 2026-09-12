import { describe, expect, it } from 'vitest';

import {
  COMMUNICATION_DIMENSIONS,
  MAX_COMMUNICATION_NOTE_CHARS,
  MAX_COMMUNICATION_VALUE_CHARS,
  createUserCommunicationProfile,
  type CommunicationDimension,
  type CommunicationStyleObservation,
  type CommunicationTrait,
} from './communication-profile.js';
import { DEFAULT_SENSITIVE_PATTERNS } from './memory-promotion.js';

function trait(overrides: Partial<CommunicationTrait> = {}): CommunicationTrait {
  return {
    dimension: 'formality',
    value: 'vouvoiement',
    provenance: { origin: 'user_stated' },
    ...overrides,
  };
}

function observation(
  overrides: Partial<CommunicationStyleObservation> = {},
): CommunicationStyleObservation {
  return {
    dimension: 'formality',
    value: 'vouvoiement',
    provenance: { origin: 'email_extracted', confidence: 0.7 },
    ...overrides,
  };
}

describe('createUserCommunicationProfile', () => {
  it('sans argument → profil vide', () => {
    const profile = createUserCommunicationProfile();
    expect(profile.observations).toEqual([]);
    expect(profile.traits).toEqual([]);
  });

  it('observations seules', () => {
    const profile = createUserCommunicationProfile({ observations: [observation()] });
    expect(profile.observations).toHaveLength(1);
    expect(profile.traits).toEqual([]);
  });

  it('traits seuls', () => {
    const profile = createUserCommunicationProfile({ traits: [trait()] });
    expect(profile.traits).toHaveLength(1);
    expect(profile.observations).toEqual([]);
  });

  it('observations et traits ensemble', () => {
    const profile = createUserCommunicationProfile({
      observations: [observation()],
      traits: [trait()],
    });
    expect(profile.observations).toHaveLength(1);
    expect(profile.traits).toHaveLength(1);
  });

  it('renvoie une copie propre (aucun champ superflu recopié)', () => {
    const profile = createUserCommunicationProfile({
      traits: [trait({ note: 'style détecté sur 3 messages' })],
    });
    expect(profile.traits[0]).toEqual({
      dimension: 'formality',
      value: 'vouvoiement',
      provenance: { origin: 'user_stated' },
      note: 'style détecté sur 3 messages',
    });
  });
});

describe('validation des observations et traits', () => {
  it('une observation invalide fait échouer createUserCommunicationProfile', () => {
    expect(() =>
      createUserCommunicationProfile({ observations: [observation({ value: '' })] }),
    ).toThrow(/value/);
  });

  it('un trait invalide fait échouer createUserCommunicationProfile', () => {
    expect(() => createUserCommunicationProfile({ traits: [trait({ value: '' })] })).toThrow(
      /value/,
    );
  });

  it('withObservation applique la même validation qu’à la construction', () => {
    const profile = createUserCommunicationProfile();
    expect(() => profile.withObservation(observation({ value: '' }))).toThrow(/value/);
  });

  it('withTrait applique la même validation qu’à la construction', () => {
    const profile = createUserCommunicationProfile();
    expect(() => profile.withTrait(trait({ value: '' }))).toThrow(/value/);
  });
});

describe('dimensions invalides', () => {
  it('dimension inconnue rejetée pour un trait', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createUserCommunicationProfile({ traits: [trait({ dimension: 'tone' as any })] }),
    ).toThrow(/dimension/);
  });

  it('dimension inconnue rejetée pour une observation', () => {
    expect(() =>
      createUserCommunicationProfile({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        observations: [observation({ dimension: 'tone' as any })],
      }),
    ).toThrow(/dimension/);
  });

  it('le message énumère les dimensions attendues', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createUserCommunicationProfile({ traits: [trait({ dimension: 'tone' as any })] }),
    ).toThrow(/formality/);
  });
});

describe('valeurs vides et limites de longueur', () => {
  it('value vide rejetée', () => {
    expect(() => createUserCommunicationProfile({ traits: [trait({ value: '' })] })).toThrow(
      /value/,
    );
  });

  it('value uniquement composée d’espaces rejetée', () => {
    expect(() => createUserCommunicationProfile({ traits: [trait({ value: '   ' })] })).toThrow(
      /value/,
    );
  });

  it('value de longueur exactement MAX_COMMUNICATION_VALUE_CHARS acceptée', () => {
    // Mots courts espacés : aucun run alphanumérique ne peut atteindre 40+
    // caractères (motif anti-fuite « secret long » de DEFAULT_SENSITIVE_PATTERNS).
    const value = 'lorem '
      .repeat(Math.ceil(MAX_COMMUNICATION_VALUE_CHARS / 6))
      .slice(0, MAX_COMMUNICATION_VALUE_CHARS);
    expect(value).toHaveLength(MAX_COMMUNICATION_VALUE_CHARS);
    const profile = createUserCommunicationProfile({ traits: [trait({ value })] });
    expect(profile.traits[0]?.value).toBe(value);
  });

  it('value dépassant MAX_COMMUNICATION_VALUE_CHARS rejetée', () => {
    const value = 'lorem '
      .repeat(Math.ceil((MAX_COMMUNICATION_VALUE_CHARS + 1) / 6))
      .slice(0, MAX_COMMUNICATION_VALUE_CHARS + 1);
    expect(() => createUserCommunicationProfile({ traits: [trait({ value })] })).toThrow(/value/);
  });
});

describe('notes invalides et limites', () => {
  it('note absente acceptée', () => {
    const profile = createUserCommunicationProfile({ traits: [trait()] });
    expect(profile.traits[0]?.note).toBeUndefined();
  });

  it('note non-chaîne rejetée', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createUserCommunicationProfile({ traits: [trait({ note: 42 as any })] }),
    ).toThrow(/note/);
  });

  it('note de longueur exactement MAX_COMMUNICATION_NOTE_CHARS acceptée', () => {
    // Mots courts espacés : aucun run alphanumérique ne peut atteindre 40+
    // caractères (motif anti-fuite « secret long » de DEFAULT_SENSITIVE_PATTERNS).
    const note = 'lorem '
      .repeat(Math.ceil(MAX_COMMUNICATION_NOTE_CHARS / 6))
      .slice(0, MAX_COMMUNICATION_NOTE_CHARS);
    expect(note).toHaveLength(MAX_COMMUNICATION_NOTE_CHARS);
    const profile = createUserCommunicationProfile({ traits: [trait({ note })] });
    expect(profile.traits[0]?.note).toBe(note);
  });

  it('note dépassant MAX_COMMUNICATION_NOTE_CHARS rejetée', () => {
    const note = 'lorem '
      .repeat(Math.ceil((MAX_COMMUNICATION_NOTE_CHARS + 1) / 6))
      .slice(0, MAX_COMMUNICATION_NOTE_CHARS + 1);
    expect(() => createUserCommunicationProfile({ traits: [trait({ note })] })).toThrow(/note/);
  });
});

describe('provenance invalide', () => {
  it('origine inconnue rejetée', () => {
    expect(() =>
      createUserCommunicationProfile({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        traits: [trait({ provenance: { origin: 'guessed' } as any })],
      }),
    ).toThrow(/origin/);
  });

  it('confidence hors [0,1] rejetée', () => {
    expect(() =>
      createUserCommunicationProfile({
        traits: [trait({ provenance: { origin: 'inferred', confidence: 1.5 } })],
      }),
    ).toThrow(/confidence/);
  });

  it('confidence sur une origine certaine rejetée', () => {
    expect(() =>
      createUserCommunicationProfile({
        traits: [trait({ provenance: { origin: 'user_stated', confidence: 0.9 } })],
      }),
    ).toThrow(/confidence/);
  });
});

describe('anti-fuite avec un motif réel de DEFAULT_SENSITIVE_PATTERNS', () => {
  const SENSITIVE_VALUE = 'Son password est « hunter2 ».';

  it('le motif réutilisé matche bien un motif réel et stable de DEFAULT_SENSITIVE_PATTERNS', () => {
    expect(DEFAULT_SENSITIVE_PATTERNS.some((pattern) => pattern.test(SENSITIVE_VALUE))).toBe(true);
  });

  it('value sensible rejetée', () => {
    expect(() =>
      createUserCommunicationProfile({ traits: [trait({ value: SENSITIVE_VALUE })] }),
    ).toThrow(/sensible/);
  });

  it('note sensible rejetée', () => {
    expect(() =>
      createUserCommunicationProfile({ traits: [trait({ note: SENSITIVE_VALUE })] }),
    ).toThrow(/sensible/);
  });

  it('rejetée aussi côté observation', () => {
    expect(() =>
      createUserCommunicationProfile({
        observations: [observation({ value: SENSITIVE_VALUE })],
      }),
    ).toThrow(/sensible/);
  });
});

describe('resolve et priorité des traits autoritaires', () => {
  it('aucun trait pour la dimension → undefined', () => {
    const profile = createUserCommunicationProfile();
    expect(profile.resolve('formality')).toBeUndefined();
  });

  it('un seul trait autoritaire → sa valeur', () => {
    const profile = createUserCommunicationProfile({
      traits: [trait({ value: 'vouvoiement', provenance: { origin: 'user_stated' } })],
    });
    expect(profile.resolve('formality')?.value).toBe('vouvoiement');
  });

  it('deux traits autoritaires → le dernier ajouté gagne', () => {
    const profile = createUserCommunicationProfile({
      traits: [
        trait({ value: 'vouvoiement', provenance: { origin: 'user_stated' } }),
        trait({ value: 'tutoiement', provenance: { origin: 'user_confirmed' } }),
      ],
    });
    expect(profile.resolve('formality')?.value).toBe('tutoiement');
  });

  it('trait autoritaire gagne même si un trait incertain est ajouté après', () => {
    const profile = createUserCommunicationProfile({
      traits: [
        trait({ value: 'vouvoiement', provenance: { origin: 'user_stated' } }),
        trait({ value: 'tutoiement', provenance: { origin: 'inferred', confidence: 0.9 } }),
      ],
    });
    expect(profile.resolve('formality')?.value).toBe('vouvoiement');
  });

  it('resolve renvoie une provenance nettoyée mais préserve origin/confidence/note du trait gagnant', () => {
    const profile = createUserCommunicationProfile({
      traits: [
        trait({
          provenance: { origin: 'user_stated', note: 'confirmé le 2026-09-08' },
        }),
      ],
    });
    expect(profile.resolve('formality')?.provenance).toEqual({
      origin: 'user_stated',
      note: 'confirmé le 2026-09-08',
    });
  });
});

describe('includeInferred', () => {
  it('par défaut (absent) → un trait incertain seul ne résout rien', () => {
    const profile = createUserCommunicationProfile({
      traits: [trait({ provenance: { origin: 'inferred', confidence: 0.5 } })],
    });
    expect(profile.resolve('formality')).toBeUndefined();
  });

  it('includeInferred:false explicite → même résultat que l’absence de l’option', () => {
    const profile = createUserCommunicationProfile({
      traits: [trait({ provenance: { origin: 'inferred', confidence: 0.5 } })],
    });
    expect(profile.resolve('formality', { includeInferred: false })).toBeUndefined();
  });

  it('includeInferred:true → renvoie la valeur incertaine', () => {
    const profile = createUserCommunicationProfile({
      traits: [trait({ value: 'tutoiement', provenance: { origin: 'inferred', confidence: 0.5 } })],
    });
    expect(profile.resolve('formality', { includeInferred: true })?.value).toBe('tutoiement');
  });

  it('includeInferred:true n’a aucun effet quand un trait autoritaire existe déjà', () => {
    const profile = createUserCommunicationProfile({
      traits: [
        trait({ value: 'vouvoiement', provenance: { origin: 'user_stated' } }),
        trait({ value: 'tutoiement', provenance: { origin: 'inferred', confidence: 0.9 } }),
      ],
    });
    expect(profile.resolve('formality', { includeInferred: true })?.value).toBe('vouvoiement');
  });
});

describe('resolveAll et ordre déterministe', () => {
  it('aucun trait → Map vide', () => {
    const profile = createUserCommunicationProfile();
    expect(profile.resolveAll().size).toBe(0);
  });

  it('ordre des clés = ordre de COMMUNICATION_DIMENSIONS, indépendant de l’ordre d’insertion', () => {
    const profile = createUserCommunicationProfile({
      traits: [
        trait({ dimension: 'language', value: 'fr' }),
        trait({ dimension: 'formality', value: 'vouvoiement' }),
        trait({ dimension: 'length', value: 'court' }),
      ],
    });
    const expectedOrder = COMMUNICATION_DIMENSIONS.filter((d) =>
      (['formality', 'length', 'language'] as CommunicationDimension[]).includes(d),
    );
    expect([...profile.resolveAll().keys()]).toEqual(expectedOrder);
  });

  it('une dimension sans trait n’apparaît pas dans la Map', () => {
    const profile = createUserCommunicationProfile({ traits: [trait({ dimension: 'formality' })] });
    expect(profile.resolveAll().has('emoji')).toBe(false);
  });

  it('transmet includeInferred de façon identique à chaque dimension', () => {
    const profile = createUserCommunicationProfile({
      traits: [
        trait({ dimension: 'formality', provenance: { origin: 'inferred', confidence: 0.5 } }),
        trait({ dimension: 'length', provenance: { origin: 'inferred', confidence: 0.5 } }),
      ],
    });
    expect(profile.resolveAll().size).toBe(0);
    expect(profile.resolveAll({ includeInferred: true }).size).toBe(2);
  });
});

describe('immutabilité de withObservation et withTrait', () => {
  it('withTrait ne modifie pas le profil d’origine', () => {
    const original = createUserCommunicationProfile();
    const updated = original.withTrait(trait());
    expect(original.traits).toEqual([]);
    expect(updated.traits).toHaveLength(1);
    expect(original).not.toBe(updated);
    expect(original.traits).not.toBe(updated.traits);
  });

  it('withObservation ne modifie pas le profil d’origine', () => {
    const original = createUserCommunicationProfile();
    const updated = original.withObservation(observation());
    expect(original.observations).toEqual([]);
    expect(updated.observations).toHaveLength(1);
    expect(original).not.toBe(updated);
  });

  it('un appel invalide à withTrait ne modifie pas le profil d’origine', () => {
    const original = createUserCommunicationProfile({ traits: [trait()] });
    expect(() => original.withTrait(trait({ value: '' }))).toThrow();
    expect(original.traits).toHaveLength(1);
    expect(original.traits[0]?.value).toBe('vouvoiement');
  });

  it('un appel invalide à withObservation ne modifie pas le profil d’origine', () => {
    const original = createUserCommunicationProfile({ observations: [observation()] });
    expect(() => original.withObservation(observation({ value: '' }))).toThrow();
    expect(original.observations).toHaveLength(1);
  });

  it('withTrait empile sans écraser : l’ancien trait reste dans traits (traçabilité)', () => {
    const p0 = createUserCommunicationProfile({
      traits: [trait({ value: 'vouvoiement', provenance: { origin: 'user_stated' } })],
    });
    const p1 = p0.withTrait(
      trait({ value: 'tutoiement', provenance: { origin: 'user_confirmed' } }),
    );
    expect(p1.traits).toHaveLength(2);
    expect(p1.traits[0]?.value).toBe('vouvoiement');
    expect(p1.resolve('formality')?.value).toBe('tutoiement');
  });
});

describe('Object.freeze', () => {
  it('le profil renvoyé par createUserCommunicationProfile est gelé', () => {
    const profile = createUserCommunicationProfile();
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it('observations et traits sont des tableaux gelés', () => {
    const profile = createUserCommunicationProfile({
      observations: [observation()],
      traits: [trait()],
    });
    expect(Object.isFrozen(profile.observations)).toBe(true);
    expect(Object.isFrozen(profile.traits)).toBe(true);
    expect(() => (profile.traits as CommunicationTrait[]).push(trait())).toThrow(TypeError);
  });

  it('le profil renvoyé par withTrait/withObservation est également gelé', () => {
    const profile = createUserCommunicationProfile()
      .withTrait(trait())
      .withObservation(observation());
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.traits)).toBe(true);
  });
});

describe('déterminisme', () => {
  it('la même séquence de withTrait/withObservation rejouée deux fois → resolveAll identique', () => {
    function build() {
      return createUserCommunicationProfile()
        .withTrait(trait({ dimension: 'formality', value: 'vouvoiement' }))
        .withTrait(
          trait({
            dimension: 'length',
            value: 'court',
            provenance: { origin: 'inferred', confidence: 0.4 },
          }),
        )
        .withObservation(observation({ dimension: 'emoji', value: 'aucun' }));
    }

    const a = build().resolveAll();
    const b = build().resolveAll();
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('resolve rejoué plusieurs fois sur le même profil renvoie toujours la même valeur', () => {
    const profile = createUserCommunicationProfile({ traits: [trait()] });
    const first = profile.resolve('formality');
    for (let i = 0; i < 10; i += 1) {
      expect(profile.resolve('formality')).toEqual(first);
    }
  });
});

describe('export et ordre des 14 dimensions', () => {
  it('contient exactement 14 dimensions', () => {
    expect(COMMUNICATION_DIMENSIONS).toHaveLength(14);
  });

  it('aucun doublon', () => {
    expect(new Set(COMMUNICATION_DIMENSIONS).size).toBe(COMMUNICATION_DIMENSIONS.length);
  });

  it('ordre exact déclaré', () => {
    expect(COMMUNICATION_DIMENSIONS).toEqual([
      'formality',
      'address_form',
      'length',
      'structure',
      'greeting',
      'signature',
      'emoji',
      'punctuation',
      'vocabulary',
      'warmth',
      'register',
      'preferred_phrases',
      'phrases_to_avoid',
      'language',
    ]);
  });
});
