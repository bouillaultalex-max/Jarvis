export interface JarvisMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

/**
 * Modèle d'email indépendant de tout fournisseur (Gmail, Outlook…). Un futur
 * connecteur produit ce type ; le moteur de classification ne connaît que
 * lui. Ne contient volontairement aucun credential ni token OAuth, et
 * aucune donnée brute spécifique à un fournisseur (payload API, labels
 * internes…).
 */
export interface EmailMessage {
  readonly id: string;
  /** Identifiant de fil de discussion, si le fournisseur en expose un. */
  readonly threadId?: string;
  readonly sender: string;
  readonly recipients: readonly string[];
  readonly subject: string;
  readonly body: string;
  /** Date de réception, ISO 8601 — même convention que `JarvisMessage.timestamp`. */
  readonly receivedAt: string;
}