import { describe, expect, it } from 'vitest';
import { PermissionManager, ToolExecutor, ToolRegistry } from '@jarvis/core';

import { OBSIDIAN_READ_ERROR_MESSAGES, ObsidianReadError } from './obsidian-errors.js';
import { obsidianConnector, obsidianNotFoundDiagnostic } from './obsidian-connector.js';
import type { ObsidianNoteInspection, ObsidianVaultClient } from './obsidian-powershell-client.js';

const VAULT_ID = 'Vault — Test';
const VAULT_ROOT = 'C:\\Users\\test\\Vaults\\Vault — Test';
const NOTE = 'Dossier/Note.md';

interface FakeClientOptions {
  readonly vaultPath?: string | ObsidianReadError;
  readonly inspections?: readonly (ObsidianNoteInspection | ObsidianReadError)[];
  readonly readOutput?: string | ObsidianReadError;
  readonly searchOutput?: string | ObsidianReadError;
}

/** Double de client : réponses programmées, journal des appels. */
function fakeClient(options: FakeClientOptions = {}): ObsidianVaultClient & {
  readonly calls: string[];
} {
  const calls: string[] = [];
  const inspections = [...(options.inspections ?? ['file'])];
  const answer = <T>(value: T | ObsidianReadError): T => {
    if (value instanceof ObsidianReadError) {
      throw value;
    }
    return value;
  };
  return {
    vaultId: VAULT_ID,
    vaultRoot: VAULT_ROOT,
    calls,
    async vaultPath() {
      calls.push('vaultPath');
      return answer(options.vaultPath ?? `${VAULT_ROOT}\n`);
    },
    async inspectNote(path) {
      calls.push(`inspect:${path}`);
      return answer(inspections.shift() ?? 'file');
    },
    async readNote(path) {
      calls.push(`read:${path}`);
      return answer(options.readOutput ?? '# Note\n');
    },
    async searchNotes(query) {
      calls.push(`search:${query}`);
      return answer(options.searchOutput ?? 'No matches found.\n');
    },
  };
}

function executorFor(
  client: ObsidianVaultClient,
  permissions = new PermissionManager({ rules: { 'obsidian.read': 'allow' } }),
): ToolExecutor {
  const registry = new ToolRegistry();
  for (const tool of obsidianConnector.createTools(client)) {
    registry.register(tool);
  }
  return new ToolExecutor(registry, permissions);
}

const request = (input: unknown) => ({ tool: 'obsidian.read', input });

describe('obsidianConnector — déclaration', () => {
  it('ne déclare que obsidian.read et obsidian.search, tous deux en lecture', () => {
    const tools = obsidianConnector.createTools(fakeClient());
    expect(obsidianConnector.capabilities).toEqual(['obsidian.read', 'obsidian.search']);
    expect(tools.map((tool) => [tool.name, tool.action])).toEqual([
      ['obsidian.read', 'read'],
      ['obsidian.search', 'read'],
    ]);
  });
});

describe('obsidian.read — permission et validation (avant tout appel)', () => {
  it('permission refusée : aucun appel au client', async () => {
    const client = fakeClient();
    const result = await executorFor(client, new PermissionManager()).run(
      request({ vault: VAULT_ID, path: NOTE }),
    );
    expect(result.status).toBe('denied');
    expect(client.calls).toEqual([]);
  });

  it('vault différent de la configuration : entrée invalide, aucun appel', async () => {
    const client = fakeClient();
    const result = await executorFor(client).run(request({ vault: 'Autre', path: NOTE }));
    expect(result.status).toBe('invalid_input');
    expect(client.calls).toEqual([]);
  });

  it.each([
    ['../hors.md'],
    ['Dossier/../../hors.md'],
    ['/absolu.md'],
    ['C:/Windows/hors.md'],
    ['Dossier\\Note.md'],
    ['Note.md:flux'],
    ['./Note.md'],
    ['Dossier//Note.md'],
    ['Note.txt'],
    ['Dossier./Note.md'],
    ['NUL.md'],
    ['Note\u0000.md'],
    [''],
  ])('chemin refusé avant tout appel : %j', async (path) => {
    const client = fakeClient();
    const result = await executorFor(client).run(request({ vault: VAULT_ID, path }));
    expect(result.status).toBe('invalid_input');
    expect(client.calls).toEqual([]);
  });

  it('clé inconnue refusée', async () => {
    const client = fakeClient();
    const result = await executorFor(client).run(
      request({ vault: VAULT_ID, path: NOTE, write: true }),
    );
    expect(result.status).toBe('invalid_input');
    expect(client.calls).toEqual([]);
  });
});

describe('obsidian.read — exécution', () => {
  it('lecture réussie : vault vérifié, inspection, puis lecture', async () => {
    const client = fakeClient({ readOutput: '# Titre\nContenu — accentué\n' });
    const result = await executorFor(client).run(request({ vault: VAULT_ID, path: NOTE }));
    expect(result).toEqual({
      status: 'executed',
      decision: 'allow',
      output: { status: 'found', path: NOTE, content: '# Titre\nContenu — accentué\n' },
    });
    expect(client.calls).toEqual(['vaultPath', `inspect:${NOTE}`, `read:${NOTE}`]);
  });

  it('racine rapportée équivalente (casse, « / », séparateur final, CRLF) : acceptée', async () => {
    const client = fakeClient({
      vaultPath: `${VAULT_ROOT.toUpperCase().replace(/\\/g, '/')}/\r\n`,
    });
    const result = await executorFor(client).run(request({ vault: VAULT_ID, path: NOTE }));
    expect(result.status).toBe('executed');
  });

  it('vault rapporté différent de la racine configurée : erreur, aucune lecture', async () => {
    const client = fakeClient({ vaultPath: 'C:\\Users\\test\\Vaults\\Autre vault\n' });
    const result = await executorFor(client).run(request({ vault: VAULT_ID, path: NOTE }));
    expect(result).toEqual({
      status: 'error',
      reason: OBSIDIAN_READ_ERROR_MESSAGES.vault_mismatch,
    });
    expect(client.calls).toEqual(['vaultPath']);
  });

  it.each([
    ['vide', ''],
    ['message d’erreur', 'Error: Vault not found.\n'],
    ['plusieurs lignes', `${VAULT_ROOT}\nautre\n`],
  ])('vérification du vault incohérente (%s) : erreur, aucune lecture', async (_label, out) => {
    const client = fakeClient({ vaultPath: out });
    const result = await executorFor(client).run(request({ vault: VAULT_ID, path: NOTE }));
    expect(result).toEqual({
      status: 'error',
      reason: OBSIDIAN_READ_ERROR_MESSAGES.vault_check_failed,
    });
    expect(client.calls).toEqual(['vaultPath']);
  });

  it('Obsidian fermé : erreur explicite, aucune inspection ni lecture', async () => {
    const client = fakeClient({ vaultPath: new ObsidianReadError('obsidian_not_running') });
    const result = await executorFor(client).run(request({ vault: VAULT_ID, path: NOTE }));
    expect(result).toEqual({
      status: 'error',
      reason: OBSIDIAN_READ_ERROR_MESSAGES.obsidian_not_running,
    });
    expect(client.calls).toEqual(['vaultPath']);
  });

  it('fichier absent : not_found sans appeler la lecture', async () => {
    const client = fakeClient({ inspections: ['absent'] });
    const result = await executorFor(client).run(request({ vault: VAULT_ID, path: NOTE }));
    expect(result).toEqual({
      status: 'executed',
      decision: 'allow',
      output: { status: 'not_found', path: NOTE },
    });
    expect(client.calls).toEqual(['vaultPath', `inspect:${NOTE}`]);
  });

  it('lien ou jonction dans le chemin : erreur, aucune lecture', async () => {
    const client = fakeClient({ inspections: [new ObsidianReadError('link_in_path')] });
    const result = await executorFor(client).run(request({ vault: VAULT_ID, path: NOTE }));
    expect(result).toEqual({ status: 'error', reason: OBSIDIAN_READ_ERROR_MESSAGES.link_in_path });
    expect(client.calls).toEqual(['vaultPath', `inspect:${NOTE}`]);
  });

  it('diagnostic exact « introuvable », fichier toujours présent : erreur d’ambiguïté', async () => {
    const client = fakeClient({
      inspections: ['file', 'file'],
      readOutput: obsidianNotFoundDiagnostic(NOTE),
    });
    const result = await executorFor(client).run(request({ vault: VAULT_ID, path: NOTE }));
    expect(result).toEqual({
      status: 'error',
      reason: OBSIDIAN_READ_ERROR_MESSAGES.ambiguous_not_found,
    });
    expect(client.calls).toEqual([
      'vaultPath',
      `inspect:${NOTE}`,
      `read:${NOTE}`,
      `inspect:${NOTE}`,
    ]);
  });

  it('diagnostic exact « introuvable », fichier disparu entre-temps : not_found', async () => {
    const client = fakeClient({
      inspections: ['file', 'absent'],
      readOutput: obsidianNotFoundDiagnostic(NOTE),
    });
    const result = await executorFor(client).run(request({ vault: VAULT_ID, path: NOTE }));
    expect(result).toMatchObject({ status: 'executed', output: { status: 'not_found' } });
  });

  it.each([
    ['commence par « Error: »', 'Error: ceci est le début de ma note.\n'],
    ['diagnostic d’un autre chemin', obsidianNotFoundDiagnostic('Autre.md')],
    ['diagnostic sans saut de ligne final', obsidianNotFoundDiagnostic(NOTE).trimEnd()],
  ])('note dont le texte %s : traitée comme du contenu', async (_label, content) => {
    const client = fakeClient({ readOutput: content });
    const result = await executorFor(client).run(request({ vault: VAULT_ID, path: NOTE }));
    expect(result).toMatchObject({ status: 'executed', output: { status: 'found', content } });
    expect(client.calls).toEqual(['vaultPath', `inspect:${NOTE}`, `read:${NOTE}`]);
  });

  it('erreur inattendue du client : message fixe, jamais le message brut', async () => {
    const client = fakeClient();
    const broken: ObsidianVaultClient = {
      ...client,
      vaultPath: () => Promise.reject(new Error('sortie brute SECRÈTE du lanceur')),
    };
    const result = await executorFor(broken).run(request({ vault: VAULT_ID, path: NOTE }));
    expect(result).toEqual({
      status: 'error',
      reason: OBSIDIAN_READ_ERROR_MESSAGES.process_failed,
    });
  });
});

describe('obsidian.search', () => {
  const allowSearch = () => new PermissionManager({ rules: { 'obsidian.search': 'allow' } });
  const search = (input: unknown) => ({ tool: 'obsidian.search', input });
  const QUERY = 'JARVIS';

  async function runSearch(
    options: FakeClientOptions,
    input: unknown = { vault: VAULT_ID, query: QUERY },
  ) {
    const client = fakeClient(options);
    const result = await executorFor(client, allowSearch()).run(search(input));
    return { client, result };
  }

  it('permission refusée : aucun appel au client', async () => {
    const client = fakeClient();
    const result = await executorFor(client, new PermissionManager()).run(
      search({ vault: VAULT_ID, query: QUERY }),
    );
    expect(result.status).toBe('denied');
    expect(client.calls).toEqual([]);
  });

  it('la permission de obsidian.read ne vaut pas pour obsidian.search', async () => {
    const client = fakeClient();
    const result = await executorFor(client).run(search({ vault: VAULT_ID, query: QUERY }));
    expect(result.status).toBe('denied');
    expect(client.calls).toEqual([]);
  });

  it.each([
    ['vault non configuré', { vault: 'Autre', query: QUERY }],
    ['requête vide', { vault: VAULT_ID, query: '' }],
    ['requête blanche', { vault: VAULT_ID, query: '   ' }],
    ['saut de ligne', { vault: VAULT_ID, query: 'a\nb' }],
    ['caractère de contrôle', { vault: VAULT_ID, query: 'a\u0000b' }],
    ['requête trop longue', { vault: VAULT_ID, query: 'x'.repeat(201) }],
    ['clé inconnue', { vault: VAULT_ID, query: QUERY, limit: 50 }],
    ['requête non chaîne', { vault: VAULT_ID, query: 5 }],
  ])('entrée refusée avant tout appel : %s', async (_label, input) => {
    const { client, result } = await runSearch({}, input);
    expect(result.status).toBe('invalid_input');
    expect(client.calls).toEqual([]);
  });

  it.each([
    ['« No matches found. » exact', 'No matches found.\n'],
    ['tableau JSON vide', '[]'],
    ['tableau JSON vide avec saut de ligne', '[]\n'],
  ])('recherche réussie sans résultat : %s', async (_label, out) => {
    const { client, result } = await runSearch({ searchOutput: out });
    expect(result).toEqual({
      status: 'executed',
      decision: 'allow',
      output: { paths: [], ignoredNonMarkdown: 0 },
    });
    expect(client.calls).toEqual(['vaultPath', `search:${QUERY}`]);
  });

  it('résultats : ordre d’Obsidian conservé, racine vérifiée d’abord, aucune lecture', async () => {
    const out = '["Z/derniere.md","A/premiere.md","M/milieu — é.md"]\n';
    const { client, result } = await runSearch({ searchOutput: out });
    expect(result).toEqual({
      status: 'executed',
      decision: 'allow',
      output: {
        paths: ['Z/derniere.md', 'A/premiere.md', 'M/milieu — é.md'],
        ignoredNonMarkdown: 0,
      },
    });
    expect(client.calls).toEqual(['vaultPath', `search:${QUERY}`]);
    expect(
      client.calls.some((call) => call.startsWith('read:') || call.startsWith('inspect:')),
    ).toBe(false);
  });

  it('fichiers non Markdown valides : écartés et comptés, ordre conservé', async () => {
    const out = '["B/plan.canvas","A/note.md","C/doc.pdf","D/autre.md","E/sans-extension"]';
    const { result } = await runSearch({ searchOutput: out });
    expect(result).toMatchObject({
      status: 'executed',
      output: { paths: ['A/note.md', 'D/autre.md'], ignoredNonMarkdown: 3 },
    });
  });

  it.each([
    ['chemin remontant', '["A/note.md","../hors.md"]'],
    ['chemin absolu', '["/abs/note.md"]'],
    ['lecteur Windows', '["C:/note.md"]'],
    ['antislash', '["A\\\\note.md"]'],
    ['segment vide', '["A//note.md"]'],
    ['nom réservé', '["NUL.md"]'],
    ['caractère de contrôle', '["A/no\\u0001te.md"]'],
    ['chemin invalide non Markdown (validé avant filtrage)', '["A/note.md","../plan.canvas"]'],
    ['doublon', '["A/note.md","A/note.md"]'],
    ['six entrées', JSON.stringify(['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md'])],
    ['élément non chaîne', '["A/note.md",3]'],
    ['objet au lieu d’un tableau', '{"paths":["A/note.md"]}'],
    ['texte d’erreur', 'Error: Vault not found.\n'],
    ['« No matches » approché', 'No matches found\n'],
    ['sortie vide', ''],
  ])('sortie rejetée (%s) : erreur claire, aucun chemin retenu', async (_label, out) => {
    const { result } = await runSearch({ searchOutput: out });
    expect(result).toEqual({
      status: 'error',
      reason: OBSIDIAN_READ_ERROR_MESSAGES.search_output_invalid,
    });
  });

  it('vault rapporté différent : erreur, aucune recherche', async () => {
    const { client, result } = await runSearch({ vaultPath: 'C:\\Users\\test\\Vaults\\Autre\n' });
    expect(result).toEqual({
      status: 'error',
      reason: OBSIDIAN_READ_ERROR_MESSAGES.vault_mismatch,
    });
    expect(client.calls).toEqual(['vaultPath']);
  });

  it('Obsidian fermé : erreur explicite, aucune recherche', async () => {
    const { client, result } = await runSearch({
      vaultPath: new ObsidianReadError('obsidian_not_running'),
    });
    expect(result).toEqual({
      status: 'error',
      reason: OBSIDIAN_READ_ERROR_MESSAGES.obsidian_not_running,
    });
    expect(client.calls).toEqual(['vaultPath']);
  });

  it('erreur du lanceur pendant la recherche : message fixe', async () => {
    const { result } = await runSearch({ searchOutput: new ObsidianReadError('timeout') });
    expect(result).toEqual({ status: 'error', reason: OBSIDIAN_READ_ERROR_MESSAGES.timeout });
  });
});
