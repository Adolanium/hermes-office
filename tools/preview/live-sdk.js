import { useEffect, useState, useSyncExternalStore } from 'react'
export function atom(initial) {
  let value = initial
  const listeners = new Set()
  return { get: () => value, set: next => { value = next; listeners.forEach(fn => fn()) }, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
}
export const useValue = state => useSyncExternalStore(state.subscribe, state.get)
export const cn = (...bits) => bits.filter(Boolean).join(' ')
export const haptic = () => {}
export const profileColor = name => ({ scout: '#dfa15d', arke: '#83b0a0', scribe: '#cf8d79', default: '#a5aacb' })[name] || '#dfa15d'
export const Tip = ({ children }) => children
export const PALETTE_AREA = 'palette', ROUTES_AREA = 'route', SIDEBAR_NAV_AREA = 'nav', STATUSBAR_AREAS = { right: 'right' }
const listeners = new Set()
const inflight = new Set()
export const profiles = ['default', 'scout', 'arke', 'scribe'].map(name => ({ name, ui_meta: { 'hermes-bots': { color: profileColor(name) } } }))
export const host = {
  state: { busy: atom(false), profile: atom('default') },
  request: async (method) => method === 'profiles.list' ? { profiles } : {},
  requestProfile: async (name, method, params) => {
    const id = `preview-${name}`
    if (method === 'session.list') return { sessions: [{ id, title: 'Bot Chat' }] }
    if (method === 'session.resume') return { session_id: id, session_key: id }
    if (method === 'session.state') return { session_id: id, running: inflight.has(id), status: inflight.has(id) ? 'running' : 'idle' }
    if (method === 'prompt.submit') {
      inflight.add(id)
      setTimeout(() => {
        inflight.delete(id)
        listeners.forEach(fn => fn({ session_id: id, type: 'message.complete', payload: { status: 'ok' } }))
      }, 6000)
    }
    return {}
  },
  onEvent: (_, fn) => { listeners.add(fn); return () => listeners.delete(fn) },
  openSession: async id => { document.querySelector('#preview-note').textContent = `Opened ${id}. This preview uses simulated tasks.` },
  notifyError: error => { document.querySelector('#preview-note').textContent = String(error) },
  navigate: () => {}
}
export function useQuery({ queryFn }) {
  const [data, setData] = useState(null)
  useEffect(() => { queryFn().then(setData) }, [])
  return { data, isLoading: !data, error: null, refetch: () => queryFn().then(setData) }
}
