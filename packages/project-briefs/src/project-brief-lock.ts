import { closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Verrou coopératif par fichier, via création **atomique** exclusive
 * (`O_CREAT|O_EXCL`, drapeau `'wx'`) : deux process qui tentent d'ouvrir le
 * même `<chemin>.lock` en même temps ne peuvent jamais tous les deux
 * réussir — le système de fichiers tranche, pas ce code. C'est le mécanisme
 * réel d'exclusion mutuelle entre deux commandes CLI concurrentes (chacune
 * est un process séparé, sans état partagé en mémoire) ; le compteur
 * `revision` du brief n'est qu'une trace de changement visible, jamais le
 * mécanisme de concurrence lui-même.
 *
 * **Limite assumée, documentée plutôt que masquée** : ce verrou ne porte
 * aucun PID ni TTL. Si un process est tué (SIGKILL, panne) alors qu'il
 * détient le verrou, le fichier `.lock` reste en place indéfiniment et tout
 * appel suivant échoue avec `ProjectBriefLockError`. Aucune récupération
 * automatique n'est tentée ici : deviner qu'un verrou est « périmé » sans
 * savoir si le process qui le détient est vraiment mort rouvrirait
 * exactement le risque de perte silencieuse que ce mécanisme existe pour
 * éviter.
 *
 * **Procédure de récupération manuelle** (jamais automatisée par ce code) :
 * 1. Vérifier qu'aucun process n'est réellement en train d'écrire ce projet
 *    (ex. `ps`/liste des process, ou l'historique des commandes lancées) —
 *    une suppression alors qu'un écrivain est actif rouvrirait exactement
 *    le risque d'écriture concurrente non coordonnée que ce verrou existe
 *    pour éviter.
 * 2. Seulement après cette vérification, supprimer manuellement
 *    `<chemin>.lock`.
 *
 * **Portée** : ce verrou ne protège que les écrivains qui passent par
 * {@link acquireProjectBriefLock}/`FileProjectBriefStore` — un outil ou une
 * édition manuelle qui écrirait directement `<id>.json` sans passer par ce
 * mécanisme n'est pas coordonné et peut toujours perdre une écriture. Ce
 * n'est **pas** une garantie universelle contre toute perte, seulement
 * contre une perte entre écrivains coopératifs.
 */
export class ProjectBriefLockError extends Error {
  constructor(readonly filePath: string) {
    super(
      `ProjectBriefLockError : verrou déjà détenu pour « ${filePath} » — une autre commande est ` +
        `probablement en cours. Si aucun écrivain n'est réellement actif (process interrompu), ` +
        `vérifiez-le explicitement avant toute suppression manuelle de « ${lockPathFor(filePath)} ».`,
    );
    this.name = 'ProjectBriefLockError';
  }
}

function lockPathFor(filePath: string): string {
  return `${filePath}.lock`;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * Acquiert le verrou ou lève `ProjectBriefLockError` ; renvoie la fonction
 * de libération. Répertoire et fichier de verrou créés en mode privé
 * (`0700`/`0600`) — jamais lisibles/inscriptibles par un autre compte local
 * sous WSL, indépendamment de l'umask du process.
 */
export function acquireProjectBriefLock(filePath: string): () => void {
  const lockPath = lockPathFor(filePath);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });

  let fd: number;
  try {
    fd = openSync(lockPath, 'wx', 0o600);
  } catch (err) {
    if (isErrnoException(err) && err.code === 'EEXIST') {
      throw new ProjectBriefLockError(filePath);
    }
    throw err;
  }
  closeSync(fd);

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    try {
      unlinkSync(lockPath);
    } catch {
      // Best effort — même discipline que le nettoyage du fichier temporaire
      // dans `FileLegalCaseStore` : une erreur de nettoyage ne doit jamais
      // masquer le résultat réel de l'opération déjà terminée.
    }
  };
}
