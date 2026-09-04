export interface JarvisTool {
  name: string;
  description: string;
  execute(input: string): Promise<string>;
}