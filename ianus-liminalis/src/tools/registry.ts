import type { ToolRegistration } from './types.js';

class ToolRegistry {
  private tools = new Map<string, ToolRegistration>();

  register(def: ToolRegistration): void {
    if (this.tools.has(def.name)) {
      throw new Error(`Tool "${def.name}" is already registered`);
    }
    this.tools.set(def.name, def);
  }

  getAll(): ToolRegistration[] {
    return Array.from(this.tools.values());
  }

  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name);
  }
}

export const toolRegistry = new ToolRegistry();
