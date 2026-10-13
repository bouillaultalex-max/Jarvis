/**
 * Harnais de test **uniquement** — un vrai sous-processus qui ouvre un
 * {@link SqliteSendAttemptBudget} déjà existant (créé au préalable par le
 * test appelant, pour ne jamais faire concourir deux process sur la
 * *création* du schéma — hors périmètre, protégé en pratique par
 * l'exclusivité du `MessageStore` qui empêche deux vrais process réels de
 * coexister) et tente `reserve()` une seule fois, imprime le résultat sur
 * stdout, sort.
 */
import { SqliteSendAttemptBudget } from '../sqlite-send-attempt-budget.js';

const [, , dbPath] = process.argv;
if (dbPath === undefined) {
  console.error('usage: budget-reserve-harness.ts <dbPath>');
  process.exit(2);
}

const budget = SqliteSendAttemptBudget.open({ filePath: dbPath, mode: 'real' });
const result = budget.reserve(new Date().toISOString());
console.log(`RESERVE_RESULT:${result}`);
budget.close();
process.exit(0);
