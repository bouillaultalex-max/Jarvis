import type { JarvisMessage } from '@jarvis/types';
import type { JarvisTool } from '@jarvis/tools';

export class JarvisCore {
  private readonly tools: JarvisTool[] = [];

  registerTool(tool: JarvisTool): void {
    this.tools.push(tool);
  }

  async process(message: JarvisMessage): Promise<string> {
    return `J'ai reçu ton message : ${message.content}`;
  }
}