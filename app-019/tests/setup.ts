import '@testing-library/jest-dom/vitest'

// Node 26 + jsdom：localStorage 未提供（--localstorage-file），测试环境补齐
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  const ls: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
  Object.defineProperty(globalThis.window, 'localStorage', { value: ls, configurable: true })
}
