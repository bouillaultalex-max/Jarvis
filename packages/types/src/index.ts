export interface JarvisMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}