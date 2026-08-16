/**
 * Hermes Office — a floor of desks for every Bot Mode agent.
 *
 * Same data as Bot Mode: profiles.list, ui_meta hermes-bots, host.state.busy.
 * Click a nameplate to give them a task. That task lands in the same
 * Bot Chat session Bot Mode already uses. Hover, pet, and drag the face.
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
import { Fragment, useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-office'
const ROSTER_KEY = [ID, 'roster']
const META_NS = 'hermes-bots'
const DRAG_PX = 8
const SLEEP_HOLD_MS = 1200
const $idleTurn = atom(false)
const $seats = atom({})
const $drag = atom(null)
const $fx = atom({})
const $peekUntil = atom(0)
const $walk = atom(null)
const $roam = atom({})
const $clockKind = atom('digital')
const $clockPos = atom(null)
const $selected = atom(null)
const $focusTask = atom(0)
const $jobs = atom({})
const BOT_CHAT_TITLE = 'Bot Chat'
const chatCreates = new Map()
const jobPollers = new Map()
let pluginCtx = null

function useTurnBusy() {
  return Boolean(useValue(host.state.busy || $idleTurn))
}

function usePulse(ms = 200) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let id = 0
    let live = true

    if (ms <= 32 && typeof requestAnimationFrame === 'function') {
      const tick = () => {
        if (!live) {
          return
        }

        setNow(Date.now())
        id = requestAnimationFrame(tick)
      }

      id = requestAnimationFrame(tick)
      return () => {
        live = false
        cancelAnimationFrame(id)
      }
    }

    id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])

  return now
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

function deskMood({ isActive, turnBusy, tasked }) {
  if (tasked || (isActive && turnBusy)) {
    return 'think'
  }

  return 'idle'
}

function faceMood({ held, asleep, pet, clap, stretch, shy, peek, think }) {
  if (held && asleep) {
    return 'sleep'
  }

  if (held) {
    return 'held'
  }

  if (asleep) {
    return 'sleep'
  }

  if (pet) {
    return 'pet'
  }

  if (clap) {
    return 'clap'
  }

  if (stretch) {
    return 'stretch'
  }

  if (shy) {
    return 'shy'
  }

  if (peek) {
    return 'peek'
  }

  if (think) {
    return 'think'
  }

  return 'idle'
}

function movedEnough(a, b) {
  if (!a || !b) {
    return false
  }

  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy >= DRAG_PX * DRAG_PX
}

function near(a, b, r) {
  if (!a || !b) {
    return false
  }

  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy <= r * r
}

function isNightHour(date = new Date()) {
  const hour = date.getHours()
  return hour >= 19 || hour < 7
}

function clockLabel(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

function clockHands(date = new Date()) {
  const h = date.getHours()
  const m = date.getMinutes()
  return {
    hour: (h % 12) * 30 + m * 0.5,
    minute: m * 6
  }
}

function nextClockKind(kind) {
  return kind === 'digital' ? 'analog' : 'digital'
}

function pickBotChatRow(rows, pinned) {
  const list = Array.isArray(rows) ? rows : []

  if (pinned && list.some(row => row && row.id === pinned)) {
    return pinned
  }

  const titled = list.find(row => (row?.title || '').trim() === BOT_CHAT_TITLE)

  if (titled?.id) {
    return titled.id
  }

  return list[0]?.id || null
}

function savePref(key, value) {
  try {
    Promise.resolve(pluginCtx?.storage?.set?.(key, value)).catch(() => undefined)
  } catch {
    /* no storage */
  }
}

function previewLine(bot) {
  const text = (bot.last_session?.preview || '').trim()
  if (!text) {
    return 'Waiting for a task'
  }
  return text.length > 72 ? `${text.slice(0, 71)}…` : text
}

function stickyText(bot) {
  const text = (bot.last_session?.preview || '').trim()
  if (!text) {
    return ''
  }
  return text.length > 20 ? `${text.slice(0, 19)}…` : text
}

function easeInOut(t) {
  const x = Math.max(0, Math.min(1, t))
  return x < 0.5 ? 2 * x * x : 1 - (2 - 2 * x) * (2 - 2 * x) / 2
}

function roamMs(from, to) {
  if (!from || !to) {
    return 2000
  }

  const dx = to.x - from.x
  const dy = to.y - from.y
  return Math.max(1400, Math.min(4200, Math.sqrt(dx * dx + dy * dy) * 18))
}

function roamBox(roomEl) {
  if (!roomEl) {
    return { x0: 12, y0: 92, x1: 360, y1: 280 }
  }

  const box = roomEl.getBoundingClientRect()
  return {
    x0: 12,
    y0: 92,
    x1: Math.max(80, box.width - 52),
    y1: Math.max(160, box.height - 52)
  }
}

function roamPoint(roomEl, avoid) {
  const box = roamBox(roomEl)
  const pick = () => ({
    x: box.x0 + Math.random() * (box.x1 - box.x0),
    y: box.y0 + Math.random() * (box.y1 - box.y0)
  })
  let next = pick()

  if (avoid && near(next, avoid, 48)) {
    next = pick()
  }

  return next
}

function setRoam(name, from, roomEl) {
  const to = roamPoint(roomEl, from)
  $roam.set({
    ...$roam.get(),
    [name]: { from, to, t0: Date.now(), ms: roamMs(from, to), rest: 500 + Math.random() * 700 }
  })
}

function clearRoam(name) {
  const next = { ...$roam.get() }

  if (!(name in next)) {
    return
  }

  delete next[name]
  $roam.set(next)
}

function tickRoam(now, roomEl) {
  if (!roomEl) {
    return
  }

  const seats = $seats.get()
  const drag = $drag.get()
  const walk = $walk.get()
  const roam = $roam.get()
  const nextRoam = { ...roam }
  let seatsDirty = false
  let roamDirty = false

  for (const name of Object.keys(seats)) {
    if (drag?.name === name || walk?.name === name) {
      continue
    }

    const leg = roam[name]

    if (leg && now - leg.t0 < leg.ms + (leg.rest || 0)) {
      continue
    }

    const from = leg ? leg.to : seats[name]
    const to = roamPoint(roomEl, from)
    nextRoam[name] = { from, to, t0: now, ms: roamMs(from, to), rest: 500 + Math.random() * 700 }
    roamDirty = true

    if (leg && seats[name] !== from) {
      seats[name] = from
      seatsDirty = true
    }
  }

  for (const name of Object.keys(nextRoam)) {
    if (!seats[name] && drag?.name !== name) {
      delete nextRoam[name]
      roamDirty = true
    }
  }

  if (roamDirty) {
    $roam.set(nextRoam)
  }

  if (seatsDirty) {
    saveSeats({ ...seats })
  }
}

function pointInRoom(roomEl, clientX, clientY) {
  if (!roomEl) {
    return { x: clientX, y: clientY }
  }

  const box = roomEl.getBoundingClientRect()
  return {
    x: Math.max(12, Math.min(box.width - 52, clientX - box.left - 21)),
    y: Math.max(92, Math.min(box.height - 52, clientY - box.top - 24))
  }
}

function pointOnWall(roomEl, clientX, clientY) {
  if (!roomEl) {
    return { x: clientX, y: clientY }
  }

  const box = roomEl.getBoundingClientRect()
  return {
    x: Math.max(8, Math.min(box.width - 72, clientX - box.left - 26)),
    y: Math.max(8, Math.min(box.height - 52, clientY - box.top - 18))
  }
}

function saveSeats(next) {
  $seats.set(next)

  try {
    Promise.resolve(pluginCtx?.storage?.set?.('seats', next)).catch(() => undefined)
  } catch {
    /* no storage on this shell */
  }
}

function patchFx(name, patch) {
  $fx.set({ ...$fx.get(), [name]: { ...($fx.get()[name] || {}), ...patch } })
}

function readFx(name, now) {
  const row = $fx.get()[name] || {}
  return {
    nap: Boolean(row.nap),
    clap: (row.clapUntil || 0) > now,
    stretch: (row.stretchUntil || 0) > now,
    closer: (row.closerUntil || 0) > now,
    whisper: (row.whisperUntil || 0) > now
  }
}

function tap() {
  try {
    haptic('tap')
  } catch {
    /* older shell */
  }
}

function pickBot(name) {
  $selected.set(name)
  $focusTask.set(Date.now())

  try {
    if (typeof host.warmProfile === 'function') {
      host.warmProfile(name)
    }
  } catch {
    /* older shell */
  }
}

function saveChatPin(bot, chat) {
  const meta = { ...botMeta(bot) }

  if (chat) {
    meta.chat = chat
  } else {
    delete meta.chat
  }

  const { image, pet, ...rest } = meta

  try {
    Promise.resolve(
      host.request('profiles.configure', { name: bot.name, ui_meta: { [META_NS]: rest } })
    ).catch(() => undefined)
  } catch {
    /* older gateway */
  }
}

async function resumeBotChat(bot, id) {
  const res = await host.request('session.resume', {
    session_id: id,
    profile: bot.name,
    omit_messages: true
  })

  if (!res?.session_id) {
    return null
  }

  return {
    runtime: res.session_id,
    stored: res.session_key || id
  }
}

async function createBotChat(bot) {
  const res = await host.request('session.create', {
    profile: bot.name,
    title: BOT_CHAT_TITLE
  })
  const stored = res?.stored_session_id || null
  const runtime = res?.session_id || null

  if (stored) {
    saveChatPin(bot, stored)
  }

  return { runtime, stored, created: true }
}

function ensureBotChat(bot) {
  const name = bot.name
  const inflight = chatCreates.get(name)

  if (inflight) {
    return inflight
  }

  const run = (async () => {
    const pinned = botMeta(bot).chat

    if (pinned) {
      try {
        const live = await resumeBotChat(bot, pinned)

        if (live) {
          return { ...live, created: false }
        }
      } catch {
        /* pin is stale */
      }
    }

    try {
      const listed = await host.request('session.list', { profile: name, limit: 100 })
      const id = pickBotChatRow(listed?.sessions, pinned)

      if (id) {
        if (id !== pinned) {
          saveChatPin(bot, id)
        }

        const live = await resumeBotChat(bot, id)

        if (live) {
          return { ...live, created: false }
        }
      }
    } catch {
      /* list failed */
    }

    return createBotChat(bot)
  })().finally(() => chatCreates.delete(name))

  chatCreates.set(name, run)
  return run
}

function markJob(name, chat) {
  $jobs.set({ ...$jobs.get(), [name]: { ...chat, t0: Date.now() } })
}

function clearJob(name) {
  const next = { ...$jobs.get() }
  delete next[name]
  $jobs.set(next)
  const timer = jobPollers.get(name)

  if (timer) {
    clearInterval(timer)
    jobPollers.delete(name)
  }
}

function watchJob(name, chat) {
  if (jobPollers.has(name)) {
    return
  }

  const started = Date.now()
  const timer = setInterval(async () => {
    if (Date.now() - started > 10 * 60 * 1000) {
      clearJob(name)
      return
    }

    if (Date.now() - started < 1200) {
      return
    }

    try {
      const state = await host.request('session.resume', {
        session_id: chat.stored || chat.runtime,
        profile: name,
        omit_messages: true
      })

      if (!state?.inflight && !state?.running) {
        clearJob(name)
        patchFx(name, { clapUntil: Date.now() + 1100, nap: false })
      }
    } catch {
      /* keep waiting */
    }
  }, 1600)

  jobPollers.set(name, timer)
}

async function openBot(bot) {
  tap()

  try {
    const chat = await ensureBotChat(bot)
    const id = chat?.stored

    if (chat?.created && chat.runtime) {
      try {
        await host.request('prompt.submit', {
          session_id: chat.runtime,
          text: 'Hey, tell me about yourself!'
        })
      } catch {
        /* kickoff is best-effort */
      }
    }

    if (id && typeof host.openSession === 'function') {
      await host.openSession(id, { profile: bot.name })
      return
    }
  } catch {
    /* fall through */
  }

  if (typeof host.newChat === 'function') {
    host.newChat(bot.name)
  }
}

async function sendTask(bot, text) {
  const task = (text || '').trim()

  if (!task) {
    return
  }

  const chat = await ensureBotChat(bot)

  if (!chat?.runtime) {
    throw new Error('Could not open that bot chat')
  }

  markJob(bot.name, chat)
  patchFx(bot.name, { nap: false })

  try {
    await host.request('prompt.submit', { session_id: chat.runtime, text: task })
  } catch (err) {
    clearJob(bot.name)
    throw err
  }

  watchJob(bot.name, chat)
}

function dropBot(name, next, roomEl) {
  const now = Date.now()
  const others = Object.entries($seats.get()).filter(([key]) => key !== name)
  const seats = { ...$seats.get(), [name]: next }

  for (const [other, pos] of others) {
    if (near(next, pos, 70)) {
      patchFx(name, { whisperUntil: now + 2800 })
      patchFx(other, { whisperUntil: now + 2800 })
    }
  }

  $drag.set(null)
  saveSeats(seats)
  setRoam(name, next, roomEl)
}

function roamPos(leg, now = Date.now()) {
  if (!leg) {
    return null
  }

  const t = Math.min(1, (now - leg.t0) / Math.max(1, leg.ms))
  return {
    x: leg.from.x + (leg.to.x - leg.from.x) * t,
    y: leg.from.y + (leg.to.y - leg.from.y) * t
  }
}

function startWalkHome(name, roomEl) {
  const from = $drag.get()?.name === name
    ? { x: $drag.get().x, y: $drag.get().y }
    : roamPos($roam.get()[name]) || $seats.get()[name]
  clearRoam(name)

  if (!from || !roomEl) {
    const next = { ...$seats.get() }
    delete next[name]
    saveSeats(next)
    return
  }

  const desk = roomEl.querySelector(`[data-desk=${JSON.stringify(name)}]`)
  const slot = desk?.querySelector('.office-empty-chair') || desk
  if (!slot) {
    const next = { ...$seats.get() }
    delete next[name]
    saveSeats(next)
    return
  }

  const room = roomEl.getBoundingClientRect()
  const box = slot.getBoundingClientRect()
  const to = { x: box.left - room.left, y: box.top - room.top }
  $walk.set({
    name,
    from,
    to,
    t0: Date.now(),
    ms: Math.max(760, roamMs(from, to) * 0.72)
  })
}

function WorkerFace({ color, image, mood, size = 36, name }) {
  const shy = mood === 'shy' || mood === 'held'
  const sleep = mood === 'sleep'
  const peek = mood === 'peek'
  const eyeY = peek ? 11 : shy ? 15 : 17
  const eyeL = shy ? 13.5 : 15
  const eyeR = shy ? 26.5 : 25

  if (image) {
    return jsx('img', {
      src: image,
      alt: '',
      'aria-hidden': true,
      draggable: false,
      className: cn('office-face', `office-face-${mood}`),
      style: {
        width: size,
        height: size,
        borderRadius: '28%',
        objectFit: 'cover',
        display: 'block',
        pointerEvents: 'none'
      }
    })
  }

  const ink = 'rgba(0,0,0,0.82)'

  return jsxs('svg', {
    viewBox: '0 0 40 44',
    width: size,
    height: size,
    'aria-hidden': true,
    className: cn('office-face', `office-face-${mood}`),
    children: [
      jsx('rect', { x: 3, y: 3, width: 34, height: 34, rx: 11, fill: color }),
      sleep || mood === 'pet' || mood === 'clap'
        ? jsx('path', {
            d: 'M12 17 Q15 20 18 17 M22 17 Q25 20 28 17',
            fill: 'none',
            stroke: ink,
            strokeWidth: 2,
            strokeLinecap: 'round'
          })
        : jsxs('g', {
            children: [
              jsx('ellipse', { cx: eyeL, cy: eyeY, rx: shy ? 3.1 : 2.4, ry: shy ? 3.4 : peek ? 3 : 2.4, fill: ink }),
              jsx('ellipse', { cx: eyeR, cy: eyeY, rx: shy ? 3.1 : 2.4, ry: shy ? 3.4 : peek ? 3 : 2.4, fill: ink }),
              shy
                ? jsx('ellipse', { cx: 31, cy: 9, rx: 1.6, ry: 2.4, fill: 'rgba(120,190,255,0.95)' })
                : null
            ]
          }),
      sleep
        ? jsx('text', { x: 30, y: 10, fontSize: 7, fill: ink, opacity: 0.7, children: 'z' })
        : null,
      mood === 'think'
        ? jsxs('g', {
            children: [
              jsx('circle', { cx: 16, cy: 40, r: 1.2, fill: color, className: 'office-dot office-dot-0' }),
              jsx('circle', { cx: 20, cy: 40, r: 1.2, fill: color, className: 'office-dot office-dot-1' }),
              jsx('circle', { cx: 24, cy: 40, r: 1.2, fill: color, className: 'office-dot office-dot-2' })
            ]
          })
        : null
    ]
  }, name)
}

function statusText({ face, isActive, wander }) {
  if (face === 'sleep') {
    return 'zzz'
  }

  if (face === 'held') {
    return 'ah!'
  }

  if (face === 'pet') {
    return 'hee'
  }

  if (face === 'clap') {
    return 'yay'
  }

  if (face === 'stretch') {
    return 'hup'
  }

  if (face === 'shy') {
    return 'eep'
  }

  if (face === 'peek') {
    return 'boo?'
  }

  if (face === 'think') {
    return 'thinking'
  }

  if (wander) {
    return 'exploring'
  }

  return isActive ? 'here' : 'at desk'
}

function Person({ bot, look, face, wander, closer, whisper, style, onPetStart }) {
  return jsxs('div', {
    className: cn('office-person', `is-${face}`, wander && 'is-wander', closer && 'is-closer'),
    style,
    role: 'button',
    tabIndex: 0,
    'aria-label': `Pet ${look.title}`,
    onPointerEnter: onPetStart.onEnter,
    onPointerLeave: onPetStart.onLeave,
    onPointerDown: onPetStart.onDown,
    children: [
      face === 'pet' || face === 'clap'
        ? jsxs('div', { className: 'office-hearts', 'aria-hidden': true, children: [jsx('span', { children: '♥' }), jsx('span', { children: '♥' }), jsx('span', { children: '♥' })] })
        : null,
      whisper
        ? jsx('div', { className: 'office-whisper', children: '…' })
        : null,
      jsx(WorkerFace, { color: look.color, image: look.image, mood: face, size: 42, name: bot.name }),
      jsx('span', {
        className: cn('office-status', (face === 'idle' || face === 'shy' || face === 'sleep') && 'is-idle'),
        children: statusText({ face, isActive: onPetStart.isActive, wander })
      })
    ]
  })
}

function usePersonHandlers(bot, roomRef, held) {
  const [shy, setShy] = useState(false)
  const [pet, setPet] = useState(false)
  const petTimer = useRef(null)
  const startRef = useRef(null)
  const sleepRef = useRef(null)

  const burstPet = () => {
    const now = Date.now()
    setPet(true)
    clearTimeout(petTimer.current)
    petTimer.current = setTimeout(() => setPet(false), 900)
    patchFx(bot.name, { stretchUntil: now + 700, closerUntil: now + 2600 })
    pickBot(bot.name)
    tap()
  }

  useEffect(() => () => {
    clearTimeout(petTimer.current)
    clearTimeout(sleepRef.current)
  }, [])

  return {
    shy,
    pet,
    handlers: {
      isActive: false,
      onEnter: () => {
        setShy(true)
        tap()
      },
      onLeave: () => {
        if (!held) {
          setShy(false)
        }
      },
      onDown: event => {
        if (event.button !== 0) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        startRef.current = { x: event.clientX, y: event.clientY }
        clearTimeout(sleepRef.current)
        sleepRef.current = setTimeout(() => {
          if (startRef.current) {
            patchFx(bot.name, { nap: true })
            const next = pointInRoom(roomRef.current, startRef.current.x, startRef.current.y)
            $drag.set({ name: bot.name, x: next.x, y: next.y, asleep: true })
          }
        }, SLEEP_HOLD_MS)

        const move = ev => {
          if (!startRef.current) {
            return
          }

          if (!movedEnough(startRef.current, { x: ev.clientX, y: ev.clientY }) && !$drag.get()) {
            return
          }

          clearTimeout(sleepRef.current)
          const next = pointInRoom(roomRef.current, ev.clientX, ev.clientY)
          const asleep = Boolean(($fx.get()[bot.name] || {}).nap)
          $drag.set({ name: bot.name, x: next.x, y: next.y, asleep })
        }

        const up = ev => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          clearTimeout(sleepRef.current)
          startRef.current = null
          const dragged = Boolean($drag.get() && $drag.get().name === bot.name)

          if (!dragged) {
            burstPet()
            return
          }

          const next = pointInRoom(roomRef.current, ev.clientX, ev.clientY)
          dropBot(bot.name, next, roomRef.current)
          setShy(false)
        }

        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }
    }
  }
}

function Desk({ bot, isActive, turnBusy, tasked, picked, roomRef, night, peek, now, onPick, onOpen }) {
  const look = botLook(bot)
  const think = deskMood({ isActive, turnBusy, tasked }) === 'think'
  const handle = botHandle(bot.name)
  const seats = useValue($seats)
  const drag = useValue($drag)
  const walk = useValue($walk)
  const fx = readFx(bot.name, now)
  const seat = drag?.name === bot.name || walk?.name === bot.name ? true : seats[bot.name]
  const held = drag?.name === bot.name
  const { shy, pet, handlers } = usePersonHandlers(bot, roomRef, held)
  const face = faceMood({
    held,
    asleep: fx.nap || Boolean(drag?.asleep && held),
    pet,
    clap: fx.clap,
    stretch: fx.stretch,
    shy,
    peek: peek && !seat,
    think
  })
  const note = stickyText(bot)

  return jsxs('div', {
    className: cn(
      'office-desk',
      think && 'is-think',
      isActive && 'is-active',
      picked && 'is-picked',
      seat && 'has-wander',
      night && 'is-night'
    ),
    'data-desk': bot.name,
    children: [
      jsxs('div', {
        className: 'office-stage',
        children: [
          jsx('div', { className: 'office-desk-top' }),
          night ? jsx('div', { className: 'office-lamp', 'aria-hidden': true }) : null,
          jsx(Monitor, { on: think, note, color: look.color }),
          seat
            ? jsx('div', { className: cn('office-empty-chair', 'is-wobble'), 'aria-hidden': true })
            : jsx(Person, {
                bot,
                look,
                face,
                wander: false,
                closer: fx.closer,
                whisper: fx.whisper,
                onPetStart: { ...handlers, isActive }
              })
        ]
      }),
      jsxs('button', {
        type: 'button',
        className: 'office-plate',
        onClick: onPick,
        onDoubleClick: event => {
          event.preventDefault()
          event.stopPropagation()
          void onOpen()
        },
        title: `Give ${look.title} a task. Double-click to open their chat.`,
        children: [
          jsx('div', { className: 'office-name', children: look.title }),
          jsx('div', { className: 'office-handle', children: `@${handle}` }),
          jsx('div', { className: 'office-preview', children: previewLine(bot) })
        ]
      }),
      picked
        ? jsx('button', {
            type: 'button',
            className: 'office-home',
            onClick: onOpen,
            children: 'open chat'
          })
        : null,
      seat
        ? jsx('button', {
            type: 'button',
            className: 'office-home',
            onClick: () => startWalkHome(bot.name, roomRef.current),
            children: 'back to desk'
          })
        : null
    ]
  })
}

function Monitor({ on, note, color }) {
  return jsxs('div', {
    className: 'office-monitor',
    'aria-hidden': true,
    children: [
      jsxs('div', {
        className: 'office-monitor-head',
        children: [
          jsx('div', { className: cn('office-screen', on && 'is-on') }),
          jsx('div', { className: 'office-monitor-cam' }),
          note
            ? jsx('div', { className: 'office-sticky', style: { background: color }, children: note })
            : null
        ]
      }),
      jsx('div', { className: 'office-monitor-neck' }),
      jsx('div', { className: 'office-monitor-base' })
    ]
  })
}

function WandererBot({ bot, isActive, turnBusy, tasked, roomRef, now, drag, seats, walk, roam }) {
  const look = botLook(bot)
  const think = deskMood({ isActive, turnBusy, tasked }) === 'think'
  const held = drag?.name === bot.name
  const fx = readFx(bot.name, now)
  const { shy, pet, handlers } = usePersonHandlers(bot, roomRef, held)
  let seat = held ? { x: drag.x, y: drag.y } : seats[bot.name]

  if (walk?.name === bot.name) {
    const raw = Math.min(1, (now - walk.t0) / Math.max(1, walk.ms))
    const t = easeInOut(raw)
    const hop = Math.abs(Math.sin(raw * Math.PI * 2)) * 7
    seat = {
      x: walk.from.x + (walk.to.x - walk.from.x) * t,
      y: walk.from.y + (walk.to.y - walk.from.y) * t - hop
    }
  } else if (roam && !held) {
    const span = Math.max(1, roam.ms)
    const raw = Math.min(1, (now - roam.t0) / span)
    const t = easeInOut(raw)
    const hop = raw < 1 ? Math.abs(Math.sin(raw * Math.PI * 3)) * 6 : 0
    seat = {
      x: roam.from.x + (roam.to.x - roam.from.x) * t,
      y: roam.from.y + (roam.to.y - roam.from.y) * t - hop
    }
  }

  if (!seat) {
    return null
  }

  return jsx(Person, {
    bot,
    look,
    face: faceMood({
      held,
      asleep: fx.nap || Boolean(drag?.asleep && held),
      pet,
      clap: fx.clap,
      stretch: fx.stretch,
      shy,
      peek: false,
      think
    }),
    wander: true,
    closer: fx.closer,
    whisper: fx.whisper,
    style: { left: seat.x, top: seat.y },
    onPetStart: { ...handlers, isActive }
  })
}

function Wanderers({ roster, isActiveName, turnBusy, jobs, roomRef, now }) {
  const seats = useValue($seats)
  const drag = useValue($drag)
  const walk = useValue($walk)
  const roam = useValue($roam)
  const names = new Set([...Object.keys(seats), drag?.name, walk?.name].filter(Boolean))

  return jsx('div', {
    className: 'office-wander-layer',
    children: roster
      .filter(bot => names.has(bot.name))
      .map(bot =>
        jsx(
          WandererBot,
          {
            bot,
            isActive: bot.name === isActiveName,
            turnBusy,
            tasked: Boolean(jobs[bot.name]),
            roomRef,
            now,
            drag,
            seats,
            walk,
            roam: roam[bot.name]
          },
          bot.name
        )
      )
  })
}

function OfficeProps({ now, roomRef }) {
  const clockKind = useValue($clockKind)
  const clockPos = useValue($clockPos)
  const dragged = useRef(false)
  const stamp = new Date(now)
  const label = clockLabel(stamp)
  const hands = clockHands(stamp)

  const onClockDown = event => {
    if (event.button !== 0) {
      return
    }

    event.stopPropagation()
    const start = { x: event.clientX, y: event.clientY }
    dragged.current = false

    const move = ev => {
      if (!movedEnough(start, { x: ev.clientX, y: ev.clientY }) && !dragged.current) {
        return
      }

      dragged.current = true
      $clockPos.set(pointOnWall(roomRef.current, ev.clientX, ev.clientY))
    }

    const up = ev => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)

      if (!dragged.current) {
        return
      }

      const next = pointOnWall(roomRef.current, ev.clientX, ev.clientY)
      $clockPos.set(next)
      savePref('clockPos', next)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onClock = event => {
    event.preventDefault()
    event.stopPropagation()

    if (dragged.current) {
      return
    }

    const next = nextClockKind($clockKind.get())
    $clockKind.set(next)
    savePref('clock', next)
  }

  return jsxs(Fragment, {
    children: [
      jsxs('button', {
        type: 'button',
        className: cn('office-clock', clockKind === 'digital' && 'is-digital', clockPos && 'is-free'),
        style: clockPos ? { left: clockPos.x, top: clockPos.y } : undefined,
        title: clockKind === 'digital' ? 'Drag to move. Click for analog.' : 'Drag to move. Click for digital.',
        onPointerDown: onClockDown,
        onClick: onClock,
        children: [
          clockKind === 'analog'
            ? jsxs('div', {
                className: 'office-clock-face',
                children: [
                  jsx('div', { className: 'office-clock-hour', style: { transform: `rotate(${hands.hour}deg)` } }),
                  jsx('div', { className: 'office-clock-min', style: { transform: `rotate(${hands.minute}deg)` } }),
                  jsx('div', { className: 'office-clock-pin' })
                ]
              })
            : jsx('div', { className: 'office-clock-lcd', children: label }),
          clockKind === 'analog' ? jsx('span', { className: 'office-clock-digits', children: label }) : null
        ]
      })
    ]
  })
}

function BotPicker({ roster, bot, look }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const close = event => {
      if (!boxRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }

    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return jsxs('div', {
    className: 'office-task-who',
    ref: boxRef,
    children: [
      jsx('span', { children: 'Task for' }),
      jsxs('div', {
        className: 'office-pick',
        children: [
          jsx('button', {
            type: 'button',
            className: 'office-pick-btn',
            'aria-haspopup': 'listbox',
            'aria-expanded': open,
            'aria-label': 'Pick a bot',
            onClick: () => setOpen(on => !on),
            children: look.title
          }),
          open
            ? jsx('div', {
                className: 'office-pick-menu',
                role: 'listbox',
                children: roster.map(row =>
                  jsx(
                    'button',
                    {
                      type: 'button',
                      role: 'option',
                      className: cn('office-pick-item', row.name === bot.name && 'is-on'),
                      'aria-selected': row.name === bot.name,
                      onClick: () => {
                        pickBot(row.name)
                        setOpen(false)
                      },
                      children: botLook(row).title
                    },
                    row.name
                  )
                )
              })
            : null
        ]
      })
    ]
  })
}

function TaskBar({ roster }) {
  const selected = useValue($selected)
  const focusToken = useValue($focusTask)
  const jobs = useValue($jobs)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const bot = roster.find(row => row.name === selected) || roster[0] || null
  const look = bot ? botLook(bot) : null
  const sending = Boolean(bot && jobs[bot.name])

  useEffect(() => {
    if (!focusToken || !inputRef.current) {
      return
    }

    inputRef.current.focus()
    inputRef.current.select?.()
  }, [focusToken])

  if (!bot || !look) {
    return null
  }

  const send = async () => {
    const task = text.trim()

    if (!task || busy || sending) {
      return
    }

    setText('')
    setBusy(true)
    pickBot(bot.name)

    try {
      await sendTask(bot, task)
    } catch (err) {
      try {
        host.notifyError(err, `Could not send to ${look.title}`)
      } catch {
        /* older shell */
      }

      try {
        await openBot(bot)
      } catch {
        /* already toasted */
      }
    } finally {
      setBusy(false)
    }
  }

  return jsxs('form', {
    className: 'office-taskbar',
    onSubmit: event => {
      event.preventDefault()
      void send()
    },
    children: [
      jsx(BotPicker, { roster, bot, look }),
      jsx('input', {
        ref: inputRef,
        className: 'office-task-input',
        value: text,
        placeholder: sending ? `${look.title} is on it…` : `Tell ${look.title}…`,
        disabled: busy || sending,
        onChange: event => setText(event.target.value)
      }),
      jsx('button', {
        type: 'submit',
        className: 'office-task-send',
        disabled: busy || sending || !text.trim(),
        children: sending ? 'on it' : 'Send'
      })
    ]
  })
}

function OfficeFloor() {
  const { data, error, isLoading } = useRoster()
  const turnBusy = useTurnBusy()
  const activeProfile = (useValue(host.state.profile) || 'default').trim() || 'default'
  useValue($avatars)
  const now = usePulse(16)
  const night = isNightHour(new Date(now))
  const peek = useValue($peekUntil) > now
  const walk = useValue($walk)
  const jobs = useValue($jobs)
  const selected = useValue($selected) || activeProfile
  const roomRef = useRef(null)
  const prevBusy = useRef(false)
  const roster = Array.isArray(data?.profiles) ? data.profiles : []
  const working = roster.filter(
    bot => deskMood({ isActive: bot.name === activeProfile, turnBusy, tasked: Boolean(jobs[bot.name]) }) === 'think'
  )

  useEffect(() => {
    pullAvatars(roster)
  }, [roster])

  useEffect(() => {
    if (prevBusy.current && !turnBusy && activeProfile) {
      patchFx(activeProfile, { clapUntil: Date.now() + 1100, nap: false })
    }

    if (turnBusy && activeProfile) {
      patchFx(activeProfile, { nap: false })
    }

    prevBusy.current = turnBusy
  }, [turnBusy, activeProfile])

  useEffect(() => {
    if (!walk) {
      return
    }

    if (now - walk.t0 < walk.ms) {
      return
    }

    const next = { ...$seats.get() }
    delete next[walk.name]
    saveSeats(next)
    $walk.set(null)
  }, [now, walk])

  useEffect(() => {
    tickRoam(now, roomRef.current)
  }, [now, walk])

  const onFloor = event => {
    const mark = event.target?.classList
    if (!mark) {
      return
    }

    if (mark.contains('office-room') || mark.contains('office-grid') || mark.contains('office-wall')) {
      $peekUntil.set(Date.now() + 900)
    }
  }

  return jsxs('div', {
    className: cn('office-root', night && 'is-night'),
    children: [
      jsxs('header', {
        className: 'office-header',
        children: [
          jsxs('div', {
            children: [
              jsx('div', { className: 'office-kicker', children: 'Office' }),
              jsx('h1', { className: 'office-title', children: 'The Office' })
            ]
          }),
          jsxs('div', {
            className: 'office-count',
            children: [
              jsx('span', { className: cn('office-pulse', working.length && 'is-live') }),
              working.length ? `${working.length} thinking` : roster.length ? 'All quiet' : 'No desks yet'
            ]
          })
        ]
      }),
      jsxs('div', {
        className: 'office-room',
        ref: roomRef,
        onPointerDown: onFloor,
        children: [
          jsx('div', { className: cn('office-wall') }),
          jsx('div', { className: cn('office-plant', working.length && 'is-lean'), 'aria-hidden': true }),
          jsx(OfficeProps, { now, roomRef }),
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
                : jsxs(Fragment, {
                    children: [
                      jsx('div', {
                        className: 'office-grid',
                        children: roster.map(bot =>
                          jsx(
                            Desk,
                            {
                              bot,
                              isActive: bot.name === activeProfile,
                              turnBusy,
                              tasked: Boolean(jobs[bot.name]),
                              picked: bot.name === selected,
                              roomRef,
                              night,
                              peek,
                              now,
                              onPick: () => pickBot(bot.name),
                              onOpen: () => void openBot(bot)
                            },
                            bot.name
                          )
                        )
                      }),
                      jsx(Wanderers, {
                        roster,
                        isActiveName: activeProfile,
                        turnBusy,
                        jobs,
                        roomRef,
                        now
                      })
                    ]
                  })
        ]
      }),
      roster.length ? jsx(TaskBar, { roster }) : null
    ]
  })
}

function OfficeChip() {
  const { data } = useRoster()
  const turnBusy = useTurnBusy()
  const activeProfile = (useValue(host.state.profile) || 'default').trim() || 'default'
  const roster = Array.isArray(data?.profiles) ? data.profiles : []
  const jobs = useValue($jobs)
  const thinking = roster.some(
    bot => deskMood({ isActive: bot.name === activeProfile, turnBusy, tasked: Boolean(jobs[bot.name]) }) === 'think'
  )

  return jsx(Tip, {
    label: thinking ? 'A bot is thinking on the office floor' : 'Open the office',
    children: jsx('button', {
      type: 'button',
      className: cn('px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)', thinking && 'text-foreground'),
      onClick: () => {
        tap()
        host.navigate('/office')
      },
      children: thinking ? 'office · live' : 'office'
    })
  })
}

function injectOfficeCss() {
  if (typeof document === 'undefined') {
    return
  }

  const css = `
.office-root { display:flex; flex-direction:column; height:100%; min-height:0; background:var(--ui-bg, transparent); color:var(--ui-text-secondary); }
.office-header { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; padding:16px 18px 10px; }
.office-kicker { font-size:10px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--ui-text-quaternary); }
.office-title { margin:2px 0 0; font-size:20px; font-weight:600; color:var(--ui-text-primary, inherit); }
.office-count { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--ui-text-tertiary); }
.office-pulse { width:8px; height:8px; border-radius:99px; background:var(--ui-text-quaternary); }
.office-pulse.is-live { background:var(--ui-accent); box-shadow:0 0 0 4px color-mix(in srgb, var(--ui-accent) 22%, transparent); }
.office-taskbar { display:flex; align-items:center; gap:8px; flex-shrink:0; padding:10px 16px 14px; }
.office-task-who { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--ui-text-tertiary); white-space:nowrap; }
.office-pick { position:relative; }
.office-pick-btn { max-width:160px; overflow:hidden; text-overflow:ellipsis; border:0; background:transparent; color:var(--ui-text-primary, inherit); font:inherit; cursor:pointer; padding:0 2px; }
.office-pick-btn:after { content:" ▾"; color:var(--ui-text-tertiary); }
.office-pick-menu { position:absolute; left:0; bottom:calc(100% + 6px); min-width:148px; max-height:220px; overflow:auto; z-index:30; padding:4px; border-radius:8px; border:1px solid var(--ui-stroke-primary, var(--ui-stroke-secondary)); background:Canvas; color:CanvasText; box-shadow:0 10px 28px color-mix(in srgb, #000 22%, transparent); }
.office-pick-item { display:block; width:100%; text-align:left; border:0; background:transparent; color:inherit; font:inherit; font-size:12px; padding:6px 8px; border-radius:6px; cursor:pointer; }
.office-pick-item:hover, .office-pick-item.is-on { background:color-mix(in srgb, var(--ui-accent) 18%, Canvas); color:inherit; }
.office-task-input { flex:1; min-width:0; height:32px; padding:0 10px; border:1px solid var(--ui-stroke-secondary); border-radius:8px; background:color-mix(in srgb, var(--ui-bg) 86%, transparent); color:inherit; font:inherit; }
.office-task-input:focus { outline:1px solid var(--ui-accent); }
.office-task-input:disabled { opacity:.7; }
.office-task-send { height:32px; padding:0 12px; border:0; border-radius:8px; background:var(--ui-accent); color:var(--ui-accent-fg, #fff); font-size:12px; cursor:pointer; }
.office-task-send:disabled { opacity:.45; cursor:default; }
.office-desk.is-picked .office-plate { outline:1px dashed var(--ui-accent); }
.office-room { position:relative; flex:1; min-height:0; margin:0 12px; overflow:auto; border:1px solid var(--ui-stroke-secondary); border-radius:12px; background:
  linear-gradient(180deg, color-mix(in srgb, var(--ui-bg) 70%, #8aa) 0 86px, transparent 86px),
  repeating-linear-gradient(90deg, color-mix(in srgb, var(--ui-stroke-secondary) 55%, transparent) 0 1px, transparent 1px 28px),
  repeating-linear-gradient(0deg, color-mix(in srgb, var(--ui-stroke-secondary) 35%, transparent) 0 1px, transparent 1px 28px),
  color-mix(in srgb, var(--ui-bg) 88%, #6b5); }
.office-root.is-night .office-room { background:
  linear-gradient(180deg, color-mix(in srgb, var(--ui-bg) 55%, #124) 0 86px, transparent 86px),
  repeating-linear-gradient(90deg, color-mix(in srgb, var(--ui-stroke-secondary) 40%, transparent) 0 1px, transparent 1px 28px),
  repeating-linear-gradient(0deg, color-mix(in srgb, var(--ui-stroke-secondary) 25%, transparent) 0 1px, transparent 1px 28px),
  color-mix(in srgb, var(--ui-bg) 82%, #243); }
.office-wall { position:absolute; inset:0 0 auto 0; height:86px; pointer-events:none; background:linear-gradient(180deg, color-mix(in srgb, var(--ui-bg) 40%, #9ab) , transparent); }
.office-plant { position:absolute; top:40px; left:18px; width:18px; height:28px; border-radius:40% 40% 20% 20%; background:color-mix(in srgb, #3d8 70%, var(--ui-bg)); pointer-events:none; transform-origin:50% 100%; transition:transform .6s ease; }
.office-plant.is-lean { transform: rotate(16deg); }
.office-plant:after { content:""; position:absolute; left:6px; bottom:-8px; width:6px; height:12px; background:color-mix(in srgb, #864 70%, var(--ui-bg)); }
.office-clock { position:absolute; top:12px; left:50px; display:grid; justify-items:center; gap:3px; border:0; padding:0; background:transparent; color:inherit; cursor:grab; touch-action:none; z-index:5; }
.office-clock.is-digital { top:16px; }
.office-clock.is-free { top:auto; }
.office-clock:active { cursor:grabbing; }
.office-clock-lcd { min-width:52px; padding:4px 7px 3px; border-radius:4px; background:#142016; color:#9dffb0; font-size:12px; font-variant-numeric:tabular-nums; letter-spacing:.06em; box-shadow: inset 0 0 0 1px #2a3a2c, 0 1px 0 color-mix(in srgb, #000 25%, transparent); }
.office-clock-face { position:relative; width:36px; height:36px; border-radius:99px; background:
  repeating-conic-gradient(from -1deg, var(--ui-text-secondary) 0 2deg, transparent 2deg 30deg),
  color-mix(in srgb, var(--ui-bg) 80%, #fff);
  box-shadow: inset 0 0 0 2px var(--ui-stroke-secondary), 0 1px 0 color-mix(in srgb, #000 20%, transparent); }
.office-clock-hour, .office-clock-min { position:absolute; left:50%; bottom:50%; width:2px; background:var(--ui-text-primary, #222); transform-origin:50% 100%; border-radius:2px; }
.office-clock-hour { height:10px; margin-left:-1px; }
.office-clock-min { height:13px; width:1.5px; margin-left:-0.75px; opacity:.85; }
.office-clock-pin { position:absolute; left:50%; top:50%; width:4px; height:4px; margin:-2px 0 0 -2px; border-radius:99px; background:var(--ui-text-primary, #222); }
.office-clock-digits { font-size:10px; font-variant-numeric:tabular-nums; color:var(--ui-text-tertiary); }

.office-grid { position:relative; display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:22px; padding:108px 22px 28px; min-height:calc(100% - 86px); }
.office-empty { padding:120px 20px 40px; text-align:center; color:var(--ui-text-tertiary); font-size:13px; }
.office-desk { position:relative; display:flex; flex-direction:column; align-items:center; gap:8px; padding:8px 10px 10px; border:0; background:transparent; color:inherit; text-align:center; user-select:none; -webkit-user-drag:none; }
.office-stage { position:relative; width:100%; min-height:118px; display:flex; flex-direction:column; align-items:center; }
.office-desk-top { position:absolute; left:8px; right:8px; top:48px; height:34px; border-radius:6px; background:#8d623e; box-shadow:0 7px 0 #5a3d22, 0 8px 0 color-mix(in srgb, #000 20%, transparent); outline:1px solid color-mix(in srgb, #000 22%, transparent); z-index:1; pointer-events:none; }
.office-lamp { position:absolute; top:40px; right:16px; width:8px; height:8px; border-radius:99px; background:#ffb14a; box-shadow:0 0 16px 6px color-mix(in srgb, #ffb14a 55%, transparent); z-index:2; pointer-events:none; }
.office-monitor { position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; width:62px; margin-top:2px; pointer-events:none; }
.office-monitor-head { position:relative; width:58px; height:40px; padding:5px 5px 8px; border-radius:5px 5px 3px 3px; background:linear-gradient(180deg, #55575d, #2c2e33); box-shadow: inset 0 1px 0 #7a7c82, 0 1px 0 #1a1b1e, 0 2px 4px color-mix(in srgb, #000 28%, transparent); }
.office-screen { width:100%; height:100%; border-radius:2px; background:#121316; box-shadow: inset 0 0 0 1px #0a0a0c; }
.office-screen.is-on { background:linear-gradient(180deg, var(--ui-accent), color-mix(in srgb, var(--ui-accent) 45%, #111)); animation:office-glow 1.1s ease-in-out infinite; }
.office-monitor-cam { position:absolute; left:50%; bottom:2.5px; width:3px; height:3px; margin-left:-1.5px; border-radius:99px; background:#141416; box-shadow:0 0 0 1px #4a4c52; }
.office-monitor-neck { width:7px; height:7px; background:linear-gradient(180deg, #3e4046, #2a2c30); }
.office-monitor-base { width:24px; height:4px; border-radius:3px 3px 1px 1px; background:linear-gradient(180deg, #45474d, #2a2c30); box-shadow:0 1px 1px color-mix(in srgb, #000 30%, transparent); }
.office-sticky { position:absolute; left:36px; top:-8px; width:28px; min-height:22px; padding:2px 3px; font-size:6px; line-height:1.15; color:#1a1208; border-radius:1px 1px 2px 0; transform:rotate(8deg); overflow:hidden; }
.office-empty-chair { width:42px; height:42px; margin-top:-8px; border-radius:12px; background:color-mix(in srgb, var(--ui-stroke-secondary) 70%, #bbb); box-shadow: inset 0 0 0 1px color-mix(in srgb, #000 18%, transparent); position:relative; z-index:3; }
.office-stage .office-person { margin-top:-10px; z-index:3; }
.office-empty-chair.is-wobble { animation:office-wobble .5s ease-in-out 2; }
.office-person { position:relative; z-index:3; margin-top:4px; display:grid; justify-items:center; gap:4px; cursor:grab; touch-action:none; outline:none; }
.office-person.is-held { cursor:grabbing; z-index:30; }
.office-person.is-wander { position:absolute; margin:0; z-index:8; will-change:left, top; }
.office-person.is-closer { transform: scale(1.12) translateY(4px); }
.office-face { display:block; transform-origin:50% 80%; pointer-events:none; -webkit-user-drag:none; filter: drop-shadow(0 0 0.6px #fff) drop-shadow(0 0 0.8px #1a1a1a) drop-shadow(0 2px 3px rgba(0,0,0,.3)); }
.office-face-think { animation:office-think 0.9s ease-in-out infinite; }
.office-face-shy { animation:office-shy 0.16s ease-in-out infinite; }
.office-face-held { transform: rotate(16deg) scale(1.14); filter: drop-shadow(0 0 0.6px #fff) drop-shadow(0 0 0.8px #1a1a1a) drop-shadow(0 10px 8px color-mix(in srgb, #000 35%, transparent)); }
.office-face-sleep { transform: rotate(-18deg); }
.office-face-pet { animation:office-pet 0.45s ease-in-out infinite; }
.office-face-clap { animation:office-pet 0.28s ease-in-out infinite; }
.office-face-stretch { transform: scaleX(1.18) scaleY(0.9); }
.office-face-peek { transform: translateY(-6px); }
.office-status { font-size:10px; letter-spacing:.04em; text-transform:uppercase; color:var(--ui-accent); }
.office-status.is-idle { color:var(--ui-text-quaternary); }
.office-person.is-shy .office-status, .office-person.is-held .office-status { color:#f09; }
.office-whisper { position:absolute; top:-14px; right:-6px; font-size:12px; color:var(--ui-text-secondary); background:color-mix(in srgb, var(--ui-bg) 80%, #fff); border-radius:8px; padding:0 5px; }
.office-plate { position:relative; z-index:2; width:100%; padding:6px 8px 7px; border:0; border-radius:8px; background:color-mix(in srgb, var(--ui-bg) 78%, transparent); color:inherit; text-align:center; cursor:pointer; }
.office-name { font-size:13px; font-weight:600; color:var(--ui-text-primary, inherit); }
.office-handle { font-size:11px; color:var(--ui-text-quaternary); }
.office-preview { margin-top:4px; font-size:11px; line-height:1.3; color:var(--ui-text-tertiary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.office-home { margin-top:2px; border:0; background:transparent; color:var(--ui-text-quaternary); font-size:10px; cursor:pointer; }
.office-desk.is-active .office-plate { outline:1px solid var(--ui-accent); }
.office-desk.is-think .office-desk-top { box-shadow:0 7px 0 #5a3d22, 0 8px 0 color-mix(in srgb, var(--ui-accent) 35%, transparent); }
.office-hearts { position:absolute; top:-10px; left:50%; display:flex; gap:4px; pointer-events:none; }
.office-hearts span { color:#f48; font-size:11px; animation:office-heart 0.9s ease-out forwards; }
.office-hearts span:nth-child(2) { animation-delay:.08s; }
.office-hearts span:nth-child(3) { animation-delay:.16s; }
.office-wander-layer { position:absolute; inset:0; pointer-events:none; }
.office-wander-layer .office-person { pointer-events:auto; }
.office-dot { opacity:.25; }
.office-dot-0 { animation:office-dot 1.1s ease-in-out infinite; }
.office-dot-1 { animation:office-dot 1.1s ease-in-out .18s infinite; }
.office-dot-2 { animation:office-dot 1.1s ease-in-out .36s infinite; }
@keyframes office-think { 0%,100% { transform: rotate(-10deg) translateY(0); } 50% { transform: rotate(11deg) translateY(-4px); } }
@keyframes office-shy { 0%,100% { transform: translateX(-3px) rotate(-12deg) scale(0.92); } 50% { transform: translateX(3px) rotate(10deg) scale(0.9); } }
@keyframes office-pet { 0%,100% { transform: rotate(-6deg) translateY(0); } 50% { transform: rotate(8deg) translateY(-5px); } }
@keyframes office-wobble { 0%,100% { transform: rotate(0); } 30% { transform: rotate(-8deg); } 70% { transform: rotate(8deg); } }
@keyframes office-heart { 0% { opacity:0; transform: translate(-50%, 6px) scale(.6); } 30% { opacity:1; } 100% { opacity:0; transform: translate(calc(-50% + 10px), -18px) scale(1); } }
@keyframes office-glow { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.35); } }
@keyframes office-dot { 0%,100% { opacity:.2; } 50% { opacity:1; } }
`
  let style = document.getElementById('hermes-office-css')

  if (!style) {
    style = document.createElement('style')
    style.id = 'hermes-office-css'
    document.head.appendChild(style)
  }

  style.textContent = css
}

const plugin = {
  id: ID,
  name: 'Office',
  register(ctx) {
    pluginCtx = ctx
    injectOfficeCss()

    try {
      Promise.resolve(ctx.storage?.get?.('seats'))
        .then(value => {
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            $seats.set(value)
          }
        })
        .catch(() => undefined)
      Promise.resolve(ctx.storage?.get?.('clock'))
        .then(value => {
          if (value === 'digital' || value === 'analog') {
            $clockKind.set(value)
          }
        })
        .catch(() => undefined)
      Promise.resolve(ctx.storage?.get?.('clockPos'))
        .then(value => {
          if (value && typeof value.x === 'number' && typeof value.y === 'number') {
            $clockPos.set(value)
          }
        })
        .catch(() => undefined)
    } catch {
      /* no storage */
    }

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
        keywords: ['bots', 'desk', 'floor', 'office'],
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

export const __test = {
  deskMood,
  displayName,
  botHandle,
  previewLine,
  faceMood,
  movedEnough,
  near,
  isNightHour,
  stickyText,
  clockLabel,
  clockHands,
  nextClockKind,
  pickBotChatRow,
  roamMs,
  easeInOut
}
