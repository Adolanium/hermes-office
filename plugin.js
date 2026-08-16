/**
 * Hermes Office — a floor of desks for every Bot Mode agent.
 *
 * Same data as Bot Mode: profiles.list, ui_meta hermes-bots, host.state.busy.
 * Click a desk to open that bot's chat.
 */

import {
  atom,
  cn,
  haptic,
  host,
  PALETTE_AREA,
  profileColor,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
  Tip,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-office'
const ROSTER_KEY = [ID, 'roster']
const META_NS = 'hermes-bots'
const $idleTurn = atom(false)

function useTurnBusy() {
  return Boolean(useValue(host.state.busy || $idleTurn))
}

function useRoster() {
  return useQuery({
    queryKey: ROSTER_KEY,
    queryFn: () => host.request('profiles.list', {}),
    refetchInterval: 5000,
    staleTime: 5000,
    retry: true,
    retryDelay: attempt => Math.min(15000, 1000 * 2 ** attempt)
  })
}

function displayName(bot, meta) {
  if (meta?.title?.trim()) {
    return meta.title.trim()
  }

  if ((bot.name || '').trim().toLowerCase() === 'default' && !bot.title) {
    return 'Hermes'
  }

  const raw = (bot.title || bot.name || '').replace(/[-_]+/g, ' ').trim()
  return raw.replace(/\b\w/g, ch => ch.toUpperCase())
}

function botHandle(name) {
  return (name || '').trim().toLowerCase() === 'default' ? 'hermes' : name
}

function botMeta(bot) {
  const raw = bot?.ui_meta?.[META_NS]
  return raw && typeof raw === 'object' ? raw : {}
}

const $avatars = atom({})
const avatarInflight = new Set()

function pullAvatars(roster) {
  for (const bot of roster || []) {
    if (!bot.has_avatar || $avatars.get()[bot.name] || avatarInflight.has(bot.name)) {
      continue
    }

    avatarInflight.add(bot.name)
    host
      .request('profiles.get_asset', { name: bot.name, asset: 'avatar' })
      .then(res => {
        if (res?.found && res.data) {
          $avatars.set({ ...$avatars.get(), [bot.name]: res.data })
        }
      })
      .catch(() => undefined)
      .finally(() => avatarInflight.delete(bot.name))
  }
}

function botLook(bot) {
  const meta = botMeta(bot)
  const name = bot.name || 'agent'
  const isPrimary = name.trim().toLowerCase() === 'default'
  const color = meta.color || (isPrimary ? '#8b5cf6' : profileColor(name) || '#8b5cf6')
  const cached = $avatars.get()[name]

  return {
    color,
    image: typeof meta.image === 'string' ? meta.image : cached || null,
    title: displayName(bot, meta)
  }
}

/** Think only while this desk is the focused live turn. */
function deskMood({ isActive, turnBusy }) {
  if (isActive && turnBusy) {
    return 'think'
  }

  return 'idle'
}

function previewLine(bot) {
  const text = (bot.last_session?.preview || '').trim()
  if (!text) {
    return 'Waiting for a task'
  }
  return text.length > 72 ? `${text.slice(0, 71)}…` : text
}

async function openBot(bot) {
  haptic('tap')
  const meta = botMeta(bot)
  const chat = meta.chat

  try {
    if (chat && typeof host.openSession === 'function') {
      await host.openSession(chat, { profile: bot.name })
      return
    }
  } catch {
    /* fall through to a fresh chat */
  }

  if (typeof host.newChat === 'function') {
    host.newChat(bot.name)
  }
}

function WorkerFace({ color, image, mood, size = 36, name }) {
  if (image) {
    return jsx('img', {
      src: image,
      alt: '',
      'aria-hidden': true,
      className: cn('office-face', mood === 'think' && 'office-face-think'),
      style: {
        width: size,
        height: size,
        borderRadius: '28%',
        objectFit: 'cover',
        display: 'block'
      }
    })
  }

  return jsxs('svg', {
    viewBox: '0 0 40 40',
    width: size,
    height: size,
    'aria-hidden': true,
    className: cn('office-face', mood === 'think' && 'office-face-think'),
    children: [
      jsx('rect', { x: 3, y: 3, width: 34, height: 34, rx: 11, fill: color }),
      jsx('circle', { cx: 15, cy: 17, r: 2.4, fill: 'rgba(0,0,0,0.82)' }),
      jsx('circle', { cx: 25, cy: 17, r: 2.4, fill: 'rgba(0,0,0,0.82)' }),
      mood === 'think'
        ? jsxs('g', {
            children: [
              jsx('circle', { cx: 16, cy: 36, r: 1.2, fill: color, className: 'office-dot office-dot-0' }),
              jsx('circle', { cx: 20, cy: 36, r: 1.2, fill: color, className: 'office-dot office-dot-1' }),
              jsx('circle', { cx: 24, cy: 36, r: 1.2, fill: color, className: 'office-dot office-dot-2' })
            ]
          })
        : null
    ]
  }, name)
}

function Desk({ bot, isActive, turnBusy, onOpen }) {
  const look = botLook(bot)
  const mood = deskMood({ isActive, turnBusy })
  const thinking = mood === 'think'
  const handle = botHandle(bot.name)

  return jsxs('button', {
    type: 'button',
    className: cn('office-desk', thinking && 'is-think', isActive && 'is-active'),
    onClick: onOpen,
    title: `Open ${look.title}`,
    children: [
      jsx('div', { className: 'office-desk-shadow' }),
      jsxs('div', {
        className: 'office-monitor',
        children: [
          jsx('div', { className: 'office-bezel' }),
          jsx('div', { className: cn('office-screen', thinking && 'is-on') })
        ]
      }),
      jsxs('div', {
        className: 'office-person',
        children: [
          jsx(WorkerFace, {
            color: look.color,
            image: look.image,
            mood,
            size: 42,
            name: bot.name
          }),
          thinking
            ? jsx('span', { className: 'office-status', children: 'thinking' })
            : jsx('span', { className: 'office-status is-idle', children: isActive ? 'here' : 'at desk' })
        ]
      }),
      jsxs('div', {
        className: 'office-plate',
        children: [
          jsx('div', { className: 'office-name', children: look.title }),
          jsx('div', { className: 'office-handle', children: `@${handle}` }),
          jsx('div', { className: 'office-preview', children: previewLine(bot) })
        ]
      })
    ]
  })
}

function OfficeFloor() {
  const { data, error, isLoading } = useRoster()
  const turnBusy = useTurnBusy()
  const activeProfile = (useValue(host.state.profile) || 'default').trim() || 'default'
  useValue($avatars)
  const roster = Array.isArray(data?.profiles) ? data.profiles : []
  const working = roster.filter(bot => deskMood({ isActive: bot.name === activeProfile, turnBusy }) === 'think')

  useEffect(() => {
    pullAvatars(roster)
  }, [roster])

  return jsxs('div', {
    className: 'office-root',
    children: [
      jsxs('header', {
        className: 'office-header',
        children: [
          jsxs('div', {
            children: [
              jsx('div', { className: 'office-kicker', children: 'Office' }),
              jsx('h1', { className: 'office-title', children: 'The floor' })
            ]
          }),
          jsxs('div', {
            className: 'office-count',
            children: [
              jsx('span', { className: cn('office-pulse', working.length && 'is-live') }),
              working.length
                ? `${working.length} thinking`
                : roster.length
                  ? 'All quiet'
                  : 'No desks yet'
            ]
          })
        ]
      }),
      jsxs('div', {
        className: 'office-room',
        children: [
          jsx('div', { className: 'office-wall' }),
          jsx('div', { className: 'office-window' }),
          jsx('div', { className: 'office-plant', 'aria-hidden': true }),
          isLoading
            ? jsx('div', { className: 'office-empty', children: 'Opening the office…' })
            : error
              ? jsx('div', {
                  className: 'office-empty',
                  children: 'Could not load bots. Update Hermes if profiles.list is missing.'
                })
              : roster.length === 0
                ? jsx('div', {
                    className: 'office-empty',
                    children: 'No bots yet. Create one in Bot Mode, then come back.'
                  })
                : jsx('div', {
                    className: 'office-grid',
                    children: roster.map(bot =>
                      jsx(
                        Desk,
                        {
                          bot,
                          isActive: bot.name === activeProfile,
                          turnBusy,
                          onOpen: () => void openBot(bot)
                        },
                        bot.name
                      )
                    )
                  })
        ]
      })
    ]
  })
}

function OfficeChip() {
  const { data } = useRoster()
  const turnBusy = useTurnBusy()
  const activeProfile = (useValue(host.state.profile) || 'default').trim() || 'default'
  const roster = Array.isArray(data?.profiles) ? data.profiles : []
  const thinking = roster.some(bot => deskMood({ isActive: bot.name === activeProfile, turnBusy }) === 'think')

  return jsx(Tip, {
    label: thinking ? 'A bot is thinking on the office floor' : 'Open the office floor',
    children: jsx('button', {
      type: 'button',
      className: cn(
        'px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
        thinking && 'text-foreground'
      ),
      onClick: () => {
        haptic('tap')
        host.navigate('/office')
      },
      children: thinking ? 'office · live' : 'office'
    })
  })
}

function injectOfficeCss() {
  if (typeof document === 'undefined' || document.getElementById('hermes-office-css')) {
    return
  }

  const style = document.createElement('style')
  style.id = 'hermes-office-css'
  style.textContent = `
.office-root { display:flex; flex-direction:column; height:100%; min-height:0; background:var(--ui-bg, transparent); color:var(--ui-text-secondary); }
.office-header { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; padding:16px 18px 10px; }
.office-kicker { font-size:10px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--ui-text-quaternary); }
.office-title { margin:2px 0 0; font-size:20px; font-weight:600; color:var(--ui-text-primary, inherit); }
.office-count { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--ui-text-tertiary); }
.office-pulse { width:8px; height:8px; border-radius:99px; background:var(--ui-text-quaternary); }
.office-pulse.is-live { background:var(--ui-accent); box-shadow:0 0 0 4px color-mix(in srgb, var(--ui-accent) 22%, transparent); }
.office-room { position:relative; flex:1; min-height:0; margin:0 12px 12px; overflow:auto; border:1px solid var(--ui-stroke-secondary); border-radius:12px; background:
  linear-gradient(180deg, color-mix(in srgb, var(--ui-bg) 70%, #8aa) 0 86px, transparent 86px),
  repeating-linear-gradient(90deg, color-mix(in srgb, var(--ui-stroke-secondary) 55%, transparent) 0 1px, transparent 1px 28px),
  repeating-linear-gradient(0deg, color-mix(in srgb, var(--ui-stroke-secondary) 35%, transparent) 0 1px, transparent 1px 28px),
  color-mix(in srgb, var(--ui-bg) 88%, #6b5); }
.office-wall { position:absolute; inset:0 0 auto 0; height:86px; pointer-events:none; background:linear-gradient(180deg, color-mix(in srgb, var(--ui-bg) 40%, #9ab) , transparent); }
.office-window { position:absolute; top:14px; right:22px; width:120px; height:48px; border-radius:6px; pointer-events:none; background:linear-gradient(180deg, #9ec7ff, #e8f1ff); box-shadow:inset 0 0 0 3px color-mix(in srgb, var(--ui-stroke-secondary) 80%, #fff); opacity:.85; }
.office-plant { position:absolute; top:40px; left:18px; width:18px; height:28px; border-radius:40% 40% 20% 20%; background:color-mix(in srgb, #3d8 70%, var(--ui-bg)); pointer-events:none; }
.office-plant:after { content:""; position:absolute; left:6px; bottom:-8px; width:6px; height:12px; background:color-mix(in srgb, #864 70%, var(--ui-bg)); }
.office-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:22px; padding:108px 22px 28px; }
.office-empty { padding:120px 20px 40px; text-align:center; color:var(--ui-text-tertiary); font-size:13px; }
.office-desk { position:relative; display:flex; flex-direction:column; align-items:center; gap:8px; min-height:168px; padding:12px 10px 10px; border:0; background:transparent; color:inherit; cursor:pointer; text-align:center; }
.office-desk-shadow { position:absolute; inset:auto 10px 52px 10px; height:64px; border-radius:8px; background:color-mix(in srgb, #6a4a2a 55%, var(--ui-bg)); box-shadow:0 10px 0 color-mix(in srgb, #000 18%, transparent); }
.office-monitor { position:relative; z-index:1; width:54px; height:36px; }
.office-bezel { position:absolute; inset:0; border-radius:4px 4px 2px 2px; background:#2a2a2e; }
.office-screen { position:absolute; inset:4px 4px 8px; border-radius:2px; background:#1a1a1c; }
.office-screen.is-on { background:linear-gradient(180deg, var(--ui-accent), color-mix(in srgb, var(--ui-accent) 40%, #111)); animation:office-glow 1.1s ease-in-out infinite; }
.office-person { position:relative; z-index:2; margin-top:4px; display:grid; justify-items:center; gap:4px; }
.office-face { display:block; transform-origin:50% 80%; }
.office-face-think { animation:office-think 0.9s ease-in-out infinite; }
.office-status { font-size:10px; letter-spacing:.04em; text-transform:uppercase; color:var(--ui-accent); }
.office-status.is-idle { color:var(--ui-text-quaternary); }
.office-plate { position:relative; z-index:2; width:100%; padding:6px 8px 7px; border-radius:8px; background:color-mix(in srgb, var(--ui-bg) 78%, transparent); }
.office-name { font-size:13px; font-weight:600; color:var(--ui-text-primary, inherit); }
.office-handle { font-size:11px; color:var(--ui-text-quaternary); }
.office-preview { margin-top:4px; font-size:11px; line-height:1.3; color:var(--ui-text-tertiary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.office-desk.is-active .office-plate { outline:1px solid var(--ui-accent); }
.office-desk.is-think .office-desk-shadow { box-shadow:0 10px 0 color-mix(in srgb, var(--ui-accent) 28%, transparent); }
.office-dot { opacity:.25; }
.office-dot-0 { animation:office-dot 1.1s ease-in-out infinite; }
.office-dot-1 { animation:office-dot 1.1s ease-in-out .18s infinite; }
.office-dot-2 { animation:office-dot 1.1s ease-in-out .36s infinite; }
@keyframes office-think { 0%,100% { transform: rotate(-10deg) translateY(0); } 50% { transform: rotate(11deg) translateY(-4px); } }
@keyframes office-glow { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.35); } }
@keyframes office-dot { 0%,100% { opacity:.2; } 50% { opacity:1; } }
`
  document.head.appendChild(style)
}

const plugin = {
  id: ID,
  name: 'Office',
  register(ctx) {
    injectOfficeCss()

    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: '/office' },
      render: () => jsx(OfficeFloor, {})
    })

    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      data: { path: '/office', label: 'Office', codicon: 'organization' }
    })

    ctx.register({
      id: 'palette',
      area: PALETTE_AREA,
      data: {
        id: `${ID}.open`,
        label: 'Open office floor',
        keywords: ['bots', 'desk', 'floor'],
        run: () => host.navigate('/office')
      }
    })

    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      order: 140,
      render: () => jsx(OfficeChip, {})
    })
  }
}

export default plugin

export const __test = { deskMood, displayName, botHandle, previewLine }
