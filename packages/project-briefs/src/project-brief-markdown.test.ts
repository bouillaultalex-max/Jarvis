import { describe, expect, it } from 'vitest';

import { parseProjectBriefFile } from './project-brief-file-format.js';
import { escapeMarkdownText, renderProjectBriefMarkdown } from './project-brief-markdown.js';
import type { ProjectBrief } from './project-brief.js';

function brief(overrides: Partial<ProjectBrief> = {}): ProjectBrief {
  return {
    id: 'p1',
    name: 'Projet',
    formatVersion: 1,
    revision: 1,
    sources: [],
    facts: [],
    hypotheses: [],
    decisions: [],
    questions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('escapeMarkdownText', () => {
  it('échappe les sigils Markdown/HTML, jamais de structure active', () => {
    expect(escapeMarkdownText('[[lien]]')).toBe('\\[\\[lien\\]\\]');
    expect(escapeMarkdownText('# titre')).toBe('\\# titre');
    expect(escapeMarkdownText('> citation')).toBe('\\> citation');
    expect(escapeMarkdownText('```js\ncode\n```')).not.toContain('```');
    expect(escapeMarkdownText('<script>alert(1)</script>')).toBe(
      '\\<script\\>alert\\(1\\)\\</script\\>',
    );
    expect(escapeMarkdownText('---')).toBe('\\-\\-\\-');
    expect(escapeMarkdownText('*gras* _italique_')).toBe('\\*gras\\* \\_italique\\_');
  });

  it('aplatit les retours à la ligne (jamais un nouveau bloc Markdown caché)', () => {
    expect(escapeMarkdownText('ligne 1\nligne 2')).toBe('ligne 1 ligne 2');
    expect(escapeMarkdownText('a\n# faux titre')).toBe('a \\# faux titre');
    expect(escapeMarkdownText('a\r\nb\rc')).toBe('a b c');
  });

  it('échappe le backslash sans double-échappement du résultat', () => {
    expect(escapeMarkdownText('a\\b')).toBe('a\\\\b');
  });
});

describe('renderProjectBriefMarkdown', () => {
  it('avertissement, identifiant, nom, révision et date toujours présents', () => {
    const md = renderProjectBriefMarkdown(brief({ id: 'p1', name: 'Boutique', revision: 11 }));
    expect(md).toContain('Instantané exporté — modifier cette note ne met pas à jour Jarvis.');
    expect(md).toContain('Identifiant : p1');
    expect(md).toContain('Boutique');
    expect(md).toContain('Révision : 11');
    expect(md).toContain('2026-01-01T00:00:00.000Z');
  });

  it('absence d’éléments : chaque section annonce explicitement "aucun(e)"', () => {
    const md = renderProjectBriefMarkdown(brief());
    expect(md).toContain('(aucun)'); // faits
    expect(md).toContain('(aucune)'); // hypothèses/décisions/questions
    expect(md).toContain('Aucune question ouverte restante');
  });

  it('toutes les catégories et tous les statuts apparaissent, avec ids stables', () => {
    const md = renderProjectBriefMarkdown(
      brief({
        facts: [{ id: 'fact-1', text: 'Un fait' }],
        hypotheses: [{ id: 'hyp-1', text: 'Une hypothèse' }],
        decisions: [
          { id: 'dec-1', text: 'Proposée', status: 'proposed' },
          { id: 'dec-2', text: 'Validée', status: 'validated' },
          { id: 'dec-3', text: 'Obsolète', status: 'obsolete' },
        ],
        questions: [
          { id: 'q-1', text: 'Résolue', status: 'resolved', answer: 'Réponse' },
          { id: 'q-2', text: 'Ouverte', status: 'open' },
        ],
      }),
    );
    expect(md).toContain('[fact\\-1] Un fait');
    expect(md).toContain('[hyp\\-1] Une hypothèse');
    expect(md).toContain('[dec\\-1:proposed] Proposée');
    expect(md).toContain('[dec\\-2:validated] Validée');
    expect(md).toContain('[dec\\-3:obsolete] Obsolète');
    expect(md).toContain('[q\\-1] Résolue — Réponse : Réponse');
    expect(md).toContain('[q\\-2] Ouverte');
    // La question résolue n'apparaît jamais dans la section "ouvertes".
    const openSection = md.slice(
      md.indexOf('## Questions ouvertes'),
      md.indexOf('## Questions résolues'),
    );
    expect(openSection).not.toContain('q\\-1');
    expect(md).toContain('[q\\-2] Ouverte (sélection par règle fixe');
  });

  it('jamais vérifiés de l’extérieur : la section des faits le précise explicitement', () => {
    const md = renderProjectBriefMarkdown(brief({ facts: [{ id: 'fact-1', text: 'X' }] }));
    expect(md).toContain("jamais vérifiés de l'extérieur");
  });

  it('textes spéciaux et retours à la ligne : jamais de structure active dans le rendu final', () => {
    const md = renderProjectBriefMarkdown(
      brief({
        facts: [{ id: 'fact-1', text: '[[Lien]] # Titre\n```js\nalert(1)\n```\n---\nkey: value' }],
      }),
    );
    expect(md).not.toMatch(/\n```/);
    expect(md).not.toContain('[[Lien]]');
    // Une seule ligne porte le fait (le retour à la ligne a été aplati) ;
    // tout `#`/```` ``` ````/`[[` qu'elle contient y est échappé, jamais actif.
    const factLine = md.split('\n').find((line) => line.startsWith('- [fact\\-1]'));
    expect(factLine).toBeDefined();
    expect(factLine).not.toMatch(/(?<!\\)#/);
    expect(factLine).not.toContain('[[Lien]]');
    expect(factLine).not.toContain('```');
  });

  it('rendu déterministe : même entrée → même sortie', () => {
    const b = brief({ facts: [{ id: 'fact-1', text: 'Un fait' }] });
    expect(renderProjectBriefMarkdown(b)).toBe(renderProjectBriefMarkdown(b));
  });
});

describe('renderProjectBriefMarkdown — sources et justifications', () => {
  it('fiche sans source : absence affichée explicitement, jamais inventée', () => {
    const md = renderProjectBriefMarkdown(
      brief({
        facts: [{ id: 'fact-1', text: 'Un fait' }],
        decisions: [
          { id: 'dec-1', text: 'Proposée', status: 'proposed' },
          { id: 'dec-2', text: 'Validée', status: 'validated' },
        ],
      }),
    );
    expect(md).toContain('## Sources déclarées');
    expect(md).toContain('[fact\\-1] Un fait — source non renseignée');
    expect(md).toContain('[dec\\-1:proposed] Proposée — aucune justification enregistrée');
    expect(md).toContain('[dec\\-2:validated] Validée — validée sans justification enregistrée');
  });

  it('sources, liens et justifications rendus, avec avertissements de non-vérification', () => {
    const md = renderProjectBriefMarkdown(
      brief({
        formatVersion: 2,
        sources: [{ id: 'src-1', text: 'Échange oral' }],
        facts: [{ id: 'fact-1', text: 'Un fait', sourceIds: ['src-1'] }],
        hypotheses: [{ id: 'hyp-1', text: 'Une hypothèse' }],
        decisions: [
          {
            id: 'dec-1',
            text: 'Décision',
            status: 'proposed',
            basis: [
              { kind: 'fact', id: 'fact-1' },
              { kind: 'hypothesis', id: 'hyp-1' },
            ],
          },
        ],
      }),
    );
    expect(md).toContain('jamais vérifiées par Jarvis ni par cet export');
    expect(md).toContain('[src\\-1] Échange oral');
    expect(md).toContain('[fact\\-1] Un fait — sources : src\\-1');
    expect(md).toContain('[hyp\\-1] Une hypothèse — source non renseignée');
    expect(md).toContain('[dec\\-1:proposed] Décision — justifiée par : fact\\-1, hyp\\-1');
    expect(md).toContain('elle ne prouve pas sa validité');
  });

  it('texte de source échappé : jamais de structure active', () => {
    const md = renderProjectBriefMarkdown(
      brief({
        formatVersion: 2,
        sources: [{ id: 'src-1', text: '[[Lien]] <script>x</script>\n# Titre\n```' }],
      }),
    );
    const line = md.split('\n').find((l) => l.startsWith('- [src\\-1]'));
    expect(line).toBeDefined();
    expect(line).not.toContain('[[Lien]]');
    expect(line).not.toContain('<script>');
    expect(line).not.toMatch(/(?<!\\)#/);
    expect(md).not.toMatch(/\n```/);
  });
});

describe('renderProjectBriefMarkdown — identifiants échappés (régression)', () => {
  it('ids acceptés par le format mais porteurs de Markdown/HTML/wikiliens : jamais actifs', () => {
    // Fiche syntaxiquement acceptée par `parseProjectBriefFile` : le format
    // n'exige qu'une chaîne non vide pour un id — il n'est pas durci ici.
    const raw = {
      id: 'p`1',
      name: 'Projet',
      formatVersion: 2,
      revision: 1,
      sources: [{ id: '[[src]]', text: 'Source' }],
      facts: [{ id: '<b>f</b>', text: 'Fait', sourceIds: ['[[src]]'] }],
      hypotheses: [],
      decisions: [
        {
          id: '](http://x)',
          text: 'Décision',
          status: 'proposed',
          basis: [{ kind: 'fact', id: '<b>f</b>' }],
        },
      ],
      questions: [{ id: '# q', text: 'Question ?', status: 'open' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const parsed = parseProjectBriefFile(raw, 'f.json');
    const md = renderProjectBriefMarkdown(parsed);

    expect(md).not.toContain('[[src]]');
    expect(md).not.toContain('<b>');
    expect(md).not.toContain('](http://x)');
    expect(md).not.toMatch(/(?<!\\)`/);
    expect(md).toContain('- [\\# q] Question ?');
    expect(md).not.toContain('[# q]');
    expect(md).toContain('\\[\\[src\\]\\]');
    expect(md).toContain('justifiée par : \\<b\\>f\\</b\\>');
    // La valeur stockée n'est jamais modifiée par le rendu.
    expect(parsed.sources[0]!.id).toBe('[[src]]');
    expect(parsed.decisions[0]!.basis).toEqual([{ kind: 'fact', id: '<b>f</b>' }]);
  });
});
