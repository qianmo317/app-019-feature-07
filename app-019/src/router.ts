// 轻量 hash 路由（不引入第三方路由库）
import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'editor'; id: string }
  | { name: 'print'; id: string }
  | { name: 'library' }

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '')
  if (h === '/new') return { name: 'new' }
  if (h === '/library') return { name: 'library' }
  const m = h.match(/^\/plan\/([^/]+)\/print$/)
  if (m) return { name: 'print', id: decodeURIComponent(m[1]) }
  const m2 = h.match(/^\/plan\/([^/]+)$/)
  if (m2) return { name: 'editor', id: decodeURIComponent(m2[1]) }
  return { name: 'home' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(path: string): void {
  window.location.hash = path
}
