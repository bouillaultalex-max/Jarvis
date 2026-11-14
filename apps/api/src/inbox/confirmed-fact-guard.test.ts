import { describe, expect, it } from 'vitest';

import { checkDraftAgainstConfirmedFacts } from './confirmed-fact-guard.js';

describe('checkDraftAgainstConfirmedFacts', () => {
  it('brouillon sans sujet sensible : toujours ok, faits confirmés ou non', () => {
    expect(
      checkDraftAgainstConfirmedFacts('Votre rendez-vous est confirmé pour mardi 14h.', []),
    ).toEqual({ ok: true });
  });

  it('affirmation de paiement validé sans aucun fait confirmé : violation', () => {
    const result = checkDraftAgainstConfirmedFacts(
      'Nous vous confirmons que le paiement a été validé.',
      [],
    );
    expect(result.ok).toBe(false);
    expect(result.violation).toContain('paiement validé');
  });

  it('affirmation de paiement validé corroborée par un fait confirmé : ok', () => {
    const result = checkDraftAgainstConfirmedFacts(
      'Le paiement a bien été validé le 10 novembre.',
      [
        'Référence DEMO-42 confirmée.',
        'Le paiement de la facture DEMO-42 a été validé le 10 novembre 2026.',
      ],
    );
    expect(result).toEqual({ ok: true });
  });

  it('faits confirmés sans rapport avec le paiement : toujours une violation (pas de corroboration par accident)', () => {
    const result = checkDraftAgainstConfirmedFacts('Le paiement a été reçu.', [
      'Le rendez-vous est confirmé pour mardi 14h.',
      'Référence DEMO-42 confirmée.',
    ]);
    expect(result.ok).toBe(false);
  });

  it('plusieurs formulations déclenchent le même sujet (validé / confirmé / reçu / effectué)', () => {
    for (const verb of ['validé', 'confirmé', 'reçu', 'effectué']) {
      const result = checkDraftAgainstConfirmedFacts(`Le paiement a été ${verb}.`, []);
      expect(result.ok).toBe(false);
    }
  });

  it('limite documentée : une négation explicite est tout de même détectée comme affirmation (faux positif assumé)', () => {
    const result = checkDraftAgainstConfirmedFacts("Le paiement n'a pas encore été validé.", []);
    // Comportement actuel, documenté comme limite : le motif ne distingue pas
    // la négation. Ce test fige ce comportement connu plutôt que de le cacher.
    expect(result.ok).toBe(false);
  });

  describe('limites documentées : formulations qui échappent au contrôle (faux négatifs assumés)', () => {
    // Chaque cas ci-dessous devrait, en toute rigueur, être traité comme la
    // même affirmation sensible que « paiement validé » — mais le motif
    // actuel ne couvre qu'un seul mot-sujet (« paiement ») et un seul ordre
    // des mots. Ces tests figent la portée réelle plutôt que de la supposer :
    // toutes passent « ok » même sans aucun fait confirmé, ce qui est faux.
    it.each([
      ['synonyme sans le mot « paiement »', 'Le règlement a été effectué.'],
      ['autre synonyme, tournure passive', 'La facture est payée.'],
      ['anglais', 'Payment has been validated.'],
      ['ordre des mots inversé (verbe avant « paiement »)', 'Validé, le paiement.'],
      ['synonyme au pluriel, sans « paiement »', 'Nous avons bien été payés pour cette commande.'],
    ])('%s : « %s » — non détecté, donc jamais bloqué même sans fait confirmé', (_label, text) => {
      expect(checkDraftAgainstConfirmedFacts(text, [])).toEqual({ ok: true });
    });
  });
});
