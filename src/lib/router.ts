'use client'
// AMBER — hash router. The platform exposes a single page; all 20 screens are
// hash-routed views inside it (Ch. 7 screen inventory).
import { useEffect, useState, useCallback } from 'react'

export interface Route {
  segs: string[]
  query: URLSearchParams
  raw: string
}

export function parseHash(): Route {
  const raw = typeof window !== 'undefined' ? (window.location.hash.replace(/^#/, '') || '/') : '/'
  const [pathPart, queryPart] = raw.split('?')
  const segs = pathPart.split('/').filter(Boolean)
  return { segs, query: new URLSearchParams(queryPart ?? ''), raw }
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash())
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

export function navigate(path: string) {
  if (typeof window === 'undefined') return
  const target = path.startsWith('#') ? path : `#${path}`
  if (window.location.hash === target) return
  window.location.hash = target
}

export function useNavigate() {
  return useCallback((path: string) => navigate(path), [])
}
