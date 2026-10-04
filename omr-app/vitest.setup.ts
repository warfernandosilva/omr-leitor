import { beforeEach } from 'vitest';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

// No ambiente jsdom do vitest, `window === globalThis`. O Node >= 22 instala
// ali um `localStorage` experimental que, sem `--localstorage-file`, resolve
// para `undefined` e sombreia o Storage do jsdom — aí todo setItem estoura e
// toda leitura volta vazia. Trocamos por uma implementação em memória: mesma
// API, mesmo comportamento nos testes, independente da versão do Node.
const g = globalThis as unknown as Record<string, unknown>;

g.Storage = MemoryStorage;
g.localStorage = new MemoryStorage();
g.sessionStorage = new MemoryStorage();

beforeEach(() => {
  (g.localStorage as MemoryStorage).clear();
  (g.sessionStorage as MemoryStorage).clear();
});
