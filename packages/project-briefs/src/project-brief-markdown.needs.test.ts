import { describe, expect, it } from 'vitest';

import type { ProjectBrief } from './project-brief.js';
import { renderProjectBriefMarkdown } from './project-brief-markdown.js';

const NEED = 'Je veux suivre mon stock sans ressaisir mes commandes.';

/** Sortie du rendu au commit b13ec43 (avant la notion de besoins) pour la fiche ci-dessous. */
const LEGACY_RENDER_WITHOUT_NEEDS = `# Export — p1

> Instantané exporté — modifier cette note ne met pas à jour Jarvis.

- Identifiant : p1
- Nom : Boutique \\*test\\*
- Révision : 7
- Dernière modification : 2026-01-02T00:00:00.000Z

## Sources déclarées

(déclarées par l'utilisateur — jamais vérifiées par Jarvis ni par cet export)

- [src\\-1] Échange oral

## Faits déclarés

(rapportés par l'utilisateur — jamais vérifiés de l'extérieur par cet export)

- [fact\\-1] Un fait — sources : src\\-1
- [fact\\-2] Fait nu — source non renseignée

## Hypothèses

- [hyp\\-1] Une hypothèse — source non renseignée

## Décisions

(une justification relie une décision à des éléments déclarés — elle ne prouve pas sa validité)

- [dec\\-1:validated] Une décision — justifiée par : fact\\-1 — validée le 2026\\-01\\-03T00:00:00\\.000Z
- [dec\\-2:proposed] Autre — aucune justification enregistrée

## Questions ouvertes

- [q\\-1] Question ouverte ?

## Questions résolues

- [q\\-2] Résolue ? — Réponse : Oui

## Prochaine question

[q\\-1] Question ouverte ? (sélection par règle fixe — première question ouverte, ordre d'ajout ; pas un raisonnement)
`;

function brief(overrides: Partial<ProjectBrief> = {}): ProjectBrief {
  return {
    id: 'p1',
    name: 'Projet',
    formatVersion: 3,
    revision: 4,
    sources: [{ id: 'src-1', text: 'Échange oral' }],
    facts: [],
    hypotheses: [],
    needs: [
      { id: 'need-1', text: NEED, sourceIds: ['src-1'] },
      { id: 'need-2', text: 'Un besoin nu' },
    ],
    decisions: [],
    questions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('rendu Markdown des besoins', () => {
  it('section « Besoins déclarés (non vérifiés) » avec sources ou « source non renseignée »', () => {
    const md = renderProjectBriefMarkdown(brief());
    expect(md).toContain('## Besoins déclarés (non vérifiés)');
    expect(md).toContain(
      '[need\\-1] Je veux suivre mon stock sans ressaisir mes commandes\\. — sources : src\\-1',
    );
    expect(md).toContain('[need\\-2] Un besoin nu — source non renseignée');
  });

  it('sans besoin : aucune section « Besoins » ; rendu déterministe', () => {
    const md = renderProjectBriefMarkdown(brief({ needs: [] }));
    expect(md).not.toContain('Besoins');
    expect(renderProjectBriefMarkdown(brief())).toBe(renderProjectBriefMarkdown(brief()));
  });

  it('sans besoin : rendu identique, octet pour octet, à celui d’avant la tranche (référence figée au commit b13ec43)', () => {
    const md = renderProjectBriefMarkdown(
      brief({
        name: 'Boutique *test*',
        formatVersion: 2,
        revision: 7,
        updatedAt: '2026-01-02T00:00:00.000Z',
        sources: [{ id: 'src-1', text: 'Échange oral' }],
        facts: [
          { id: 'fact-1', text: 'Un fait', sourceIds: ['src-1'] },
          { id: 'fact-2', text: 'Fait nu' },
        ],
        hypotheses: [{ id: 'hyp-1', text: 'Une hypothèse' }],
        needs: [],
        decisions: [
          {
            id: 'dec-1',
            text: 'Une décision',
            status: 'validated',
            validatedAt: '2026-01-03T00:00:00.000Z',
            basis: [{ kind: 'fact', id: 'fact-1' }],
          },
          { id: 'dec-2', text: 'Autre', status: 'proposed' },
        ],
        questions: [
          { id: 'q-1', text: 'Question ouverte ?', status: 'open' },
          { id: 'q-2', text: 'Résolue ?', status: 'resolved', answer: 'Oui' },
        ],
      }),
    );
    expect(md).toBe(LEGACY_RENDER_WITHOUT_NEEDS);
  });

  it('avec besoin : la section se place entre les hypothèses et les décisions', () => {
    const md = renderProjectBriefMarkdown(brief());
    expect(md.indexOf('## Hypothèses')).toBeLessThan(md.indexOf('## Besoins déclarés'));
    expect(md.indexOf('## Besoins déclarés')).toBeLessThan(md.indexOf('## Décisions'));
  });

  it('le texte du besoin est échappé (aucun Markdown actif)', () => {
    const md = renderProjectBriefMarkdown(
      brief({ needs: [{ id: 'need-1', text: '[[lien]] <b>x</b>\n# titre' }] }),
    );
    expect(md).not.toContain('[[lien]]');
    expect(md).not.toContain('<b>');
    expect(md).toContain('\\[\\[lien\\]\\]');
  });
});
