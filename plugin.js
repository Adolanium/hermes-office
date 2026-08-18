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
const $seats = atom({})
const $drag = atom(null)
const $fx = atom({})
const $peekUntil = atom(0)
const $walks = atom({})
const $roam = atom({})
const $clockKind = atom('digital')
const $clockPos = atom(null)
const $selected = atom(null)
const $focusTask = atom(0)
const $jobs = atom({})
const $backdrop = atom('carpet')
const $game = atom(null)
const $pizza = atom({ winner: null, at: 0 })
const $puffs = atom([])
const $planes = atom([])
const $trophies = atom({})
const $lastTask = atom({})
const $week = atom(null)
const $month = atom(null)
const $hint = atom('off')
const $news = atom({})
const $ritual = atom({ hour: -1, at: 0 })
const RITUAL_MS = 2800
const RITUAL_WINDOW_MS = 10 * 60 * 1000
const $petPing = atom({})
const OFFICE_NS = 'hermes-office'
const BORED_MS = 2 * 24 * 60 * 60 * 1000
let puffSeq = 0

// A paper plane from the task bar to a desk. Root relative coordinates.
function flyPlane(from, to) {
  if (!from || !to) {
    return
  }

  const id = ++puffSeq
  $planes.set([...$planes.get(), { id, from, to }])
  setTimeout(() => {
    $planes.set($planes.get().filter(p => p.id !== id))
  }, 900)
}

// One more finished task on the shelf for this bot. Kept locally for speed and
// mirrored onto the bot's profile (ui_meta, our own namespace) so the count
// follows the profile rather than this machine.
function addTrophy(name) {
  const count = ($trophies.get()[name] || 0) + 1
  const next = { ...$trophies.get(), [name]: count }
  $trophies.set(next)
  savePref('trophies', next)

  try {
    Promise.resolve(
      host.request('profiles.configure', { name, ui_meta: { [OFFICE_NS]: { stars: count } } })
    ).catch(() => undefined)
  } catch {
    /* older gateway */
  }
}

// If the profile already carries more stars than we know about (another
// machine, or a fresh install), take the higher number.
function seedTrophies(roster) {
  const local = $trophies.get()
  let changed = false
  const next = { ...local }

  for (const bot of roster || []) {
    const stars = Number(bot?.ui_meta?.[OFFICE_NS]?.stars || 0)
    if (stars > (next[bot.name] || 0)) {
      next[bot.name] = stars
      changed = true
    }
  }

  if (changed) {
    $trophies.set(next)
    savePref('trophies', next)
  }
}

// Employee of the month: tasks per bot this calendar month.
function bumpMonth(name) {
  const next = monthBump($month.get(), name, Date.now())
  $month.set(next)
  savePref('month', next)
}

// No board for this month yet (first run of the feature, or a fresh install
// with stars on the profiles): start it from the all time stars so the wall is
// not empty. From then on it counts real completions and resets on the first.
function seedMonth(roster) {
  const cur = $month.get()
  const start = monthStart(new Date())
  if (cur) {
    return
  }

  const stars = $trophies.get()
  const tasks = {}
  for (const bot of roster || []) {
    if (stars[bot.name] > 0) {
      tasks[bot.name] = stars[bot.name]
    }
  }

  const holder = monthLeader({ tasks }, null)
  if (!holder) {
    return
  }

  const next = { start, tasks, holder, seeded: true }
  $month.set(next)
  savePref('month', next)
}

// Weekly recap: a few counters that reset every Monday.
function bumpWeek(key, name) {
  const now = Date.now()
  const next = weekBump($week.get(), key, name, now)
  $week.set(next)
  savePref('week', next)
}

// Job done: confetti at the desk, a trophy, then off to the bar.
// Two paths can see the same completion (the job poller and the focused
// busy edge). Each round gets a token in startRound; a round celebrates once.
function celebrate(name) {
  const now = Date.now()
  const row = $fx.get()[name] || {}
  const round = completionToken(row)
  if (round === null) {
    return
  }

  patchFx(name, { doneRound: round, clapUntil: now + 1100, confettiUntil: now + 950, bangUntil: now + 1500, nap: false, goBar: true, goHome: false })
  addTrophy(name)
  bumpWeek('tasks', name)
  bumpMonth(name)
  leaveNote(name, now)
  advanceHint('play')
}

// A finished task leaves a note on the desk until the chat is opened.
function leaveNote(name, at) {
  const next = { ...$news.get(), [name]: at || Date.now() }
  $news.set(next)
  savePref('news', next)
}

function readNote(name) {
  if (!$news.get()[name]) {
    return
  }
  const next = { ...$news.get() }
  delete next[name]
  $news.set(next)
  savePref('news', next)
}

// A little dust ring at a foot position. Gone after half a second.
function puffAt(x, y) {
  const id = ++puffSeq
  $puffs.set([...$puffs.get(), { id, x, y, t0: Date.now() }])
  setTimeout(() => {
    $puffs.set($puffs.get().filter(p => p.id !== id))
  }, 520)
}

// Honour the OS "reduce motion" setting for the bouncy bits. Walks stay.
let reducedCache = null
function reducedMotion() {
  if (reducedCache === null) {
    reducedCache = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  return reducedCache
}
const PIZZA_MS = 14000

// Room skins. Every skin is a flat wall band plus a seamless floor tile, drawn
// as tiny SVGs and embedded as data URIs (Hermes loads plugin.js through a blob
// URL, so sibling image files are not served). Nothing here has a vanishing
// point: the paper-doll sprites and CSS desks sit on this floor, so the floor
// has to be the same flat plane they are.
const WALL_H = 86

function svgUri(svg) {
  const flat = svg.replace(/\s+/g, ' ').replace(/> </g, '><').trim()
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(flat)}`
}

function svgTile(width, height, body) {
  return svgUri(`<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>${body}</svg>`)
}

function speckle(points, fill, r = 1) {
  return `<g fill='${fill}'>${points.map(([x, y]) => `<circle cx='${x}' cy='${y}' r='${r}'/>`).join('')}</g>`
}

// Running bond bricks. Tile width must be a multiple of brick + joint and the
// colour list must be exactly four long so the half-offset rows wrap cleanly.
function brickRows(width, height, brick, joint, mortar, colors) {
  const step = brick.w + joint
  const rowH = brick.h + joint
  let out = `<rect width='${width}' height='${height}' fill='${mortar}'/>`

  for (let row = 0, y = 0; y < height; row++, y += rowH) {
    const offset = row % 2 ? -Math.floor(step / 2) : 0
    for (let i = 0, x = offset; x < width; i++, x += step) {
      out += `<rect x='${x}' y='${y}' width='${brick.w}' height='${brick.h}' rx='1' fill='${colors[(row * 3 + i) % colors.length]}'/>`
    }
  }

  return out
}

// Straight-on floorboards. Horizontal planks, staggered end joints, no taper.
function plankRows(width, plankH, colors, seam, joints) {
  let out = ''

  colors.forEach((fill, row) => {
    const y = row * plankH
    out += `<rect x='0' y='${y}' width='${width}' height='${plankH}' fill='${fill}'/>`
    out += `<rect x='0' y='${y}' width='${width}' height='1' fill='rgba(255,255,255,.14)'/>`
    out += `<rect x='0' y='${y + plankH - 1}' width='${width}' height='1' fill='${seam}'/>`
    out += `<rect x='${joints[row]}' y='${y}' width='2' height='${plankH}' fill='${seam}'/>`
    out += `<rect x='${(joints[row] + 9) % width}' y='${y + 7}' width='26' height='1' fill='rgba(0,0,0,.09)'/>`
    out += `<rect x='${(joints[row] + 61) % width}' y='${y + 15}' width='34' height='1' fill='rgba(0,0,0,.08)'/>`
  })

  return out
}

// Top-down dance floor. A fixed 4x4 pattern so the tile repeats without seams.
function checkerTiles(cell, colors, grid) {
  const map = [
    [0, 1, 2, 1],
    [1, 3, 1, 0],
    [2, 1, 0, 1],
    [1, 0, 1, 3]
  ]
  let out = ''

  map.forEach((row, r) => {
    row.forEach((c, i) => {
      const x = i * cell
      const y = r * cell
      out += `<rect x='${x}' y='${y}' width='${cell}' height='${cell}' fill='${colors[c]}'/>`
      out += `<rect x='${x + 2.5}' y='${y + 2.5}' width='${cell - 5}' height='${cell - 5}' fill='none' stroke='rgba(255,255,255,${c === 3 ? '.35' : '.1'})' stroke-width='1'/>`
    })
  })

  const size = cell * 4
  return `${out}<path d='M0 0h${size}M0 ${cell}h${size}M0 ${cell * 2}h${size}M0 ${cell * 3}h${size}M0 0v${size}M${cell} 0v${size}M${cell * 2} 0v${size}M${cell * 3} 0v${size}' stroke='${grid}' stroke-width='2'/>`
}

const OFFICE_SKINS = {
  carpet: {
    wallColor: '#ebe2d1',
    wallSize: '160px 86px',
    wall: svgTile(160, WALL_H, `
      <rect width='160' height='86' fill='#ebe2d1'/>
      ${speckle([[23, 14], [71, 38], [118, 22], [143, 49], [47, 51], [95, 9], [12, 44], [131, 8]], '#e1d6c2')}
      <rect y='60' width='160' height='3' fill='#c9b99d'/>
      <rect y='60' width='160' height='1' fill='#f7f1e4'/>
      <rect y='63' width='160' height='17' fill='#dccfb7'/>
      <g fill='#c6b699'><rect x='39' y='66' width='2' height='11'/><rect x='79' y='66' width='2' height='11'/><rect x='119' y='66' width='2' height='11'/><rect x='159' y='66' width='1' height='11'/><rect y='66' width='1' height='11'/></g>
      <rect y='80' width='160' height='6' fill='#8a755b'/>
      <rect y='80' width='160' height='1' fill='#aa937b'/>
    `),
    floorColor: '#587e8f',
    floorSize: '96px 96px',
    floor: svgTile(96, 96, `
      <rect width='96' height='96' fill='#587e8f'/>
      <rect x='48' width='48' height='48' fill='#557b8c'/>
      <rect y='48' width='48' height='48' fill='#557b8c'/>
      ${speckle([[6, 9], [21, 30], [39, 14], [30, 42], [11, 38], [58, 6], [70, 27], [88, 12], [79, 41], [63, 39], [9, 57], [27, 74], [41, 60], [18, 89], [36, 84], [55, 60], [73, 77], [89, 58], [66, 90], [84, 86], [46, 24], [90, 30], [2, 26], [70, 62], [14, 76]], '#668c9c')}
      ${speckle([[16, 20], [33, 5], [75, 16], [52, 34], [24, 62], [4, 78], [92, 70], [60, 72], [44, 92], [80, 50], [38, 70], [86, 94]], '#4b6f80')}
      <path d='M48.5 0v96M0 48.5h96' stroke='#4d7283' stroke-width='1'/>
    `)
  },
  loft: {
    wallColor: '#c9baa9',
    wallSize: '120px 86px',
    wall: svgTile(120, WALL_H, `
      ${brickRows(120, 80, { w: 28, h: 12 }, 2, '#c9baa9', ['#b25b41', '#a75237', '#bc6448', '#9e4b33'])}
      <rect y='80' width='120' height='6' fill='#45454b'/>
      <rect y='80' width='120' height='1' fill='#6c6c74'/>
    `),
    floorColor: '#c99b64',
    floorSize: '192px 96px',
    floor: svgTile(192, 96, `
      ${plankRows(192, 24, ['#cfa46c', '#c49862', '#d6ab74', '#bf915b'], '#8f6540', [40, 130, 88, 8])}
      <ellipse cx='150' cy='11' rx='3' ry='2' fill='#a2774a'/><ellipse cx='150' cy='11' rx='1.2' ry='.8' fill='#7d552f'/>
      <ellipse cx='58' cy='60' rx='2.6' ry='1.8' fill='#a2774a'/><ellipse cx='58' cy='60' rx='1' ry='.7' fill='#7d552f'/>
    `)
  },
  garden: {
    wallColor: '#bde0f4',
    wallSize: '160px 86px',
    wall: svgTile(160, WALL_H, `
      <defs><linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#a9d5f0'/><stop offset='1' stop-color='#dceff9'/></linearGradient></defs>
      <rect width='160' height='86' fill='url(#sky)'/>
      <g fill='#fff' opacity='.9'><ellipse cx='36' cy='22' rx='14' ry='6'/><ellipse cx='44' cy='18' rx='9' ry='6'/><ellipse cx='28' cy='19' rx='8' ry='5'/><ellipse cx='118' cy='34' rx='11' ry='5'/><ellipse cx='124' cy='31' rx='7' ry='5'/></g>
      <g fill='#4c9440'><circle cx='0' cy='64' r='13'/><circle cx='22' cy='62' r='14'/><circle cx='44' cy='65' r='12'/><circle cx='66' cy='61' r='14'/><circle cx='88' cy='64' r='13'/><circle cx='110' cy='62' r='14'/><circle cx='132' cy='65' r='12'/><circle cx='154' cy='62' r='13'/></g>
      <g fill='#63b04f'><circle cx='11' cy='58' r='9'/><circle cx='34' cy='56' r='9'/><circle cx='56' cy='58' r='9'/><circle cx='78' cy='55' r='9'/><circle cx='100' cy='58' r='9'/><circle cx='122' cy='56' r='9'/><circle cx='144' cy='58' r='9'/></g>
      <rect y='66' width='160' height='14' fill='#3f7f36'/>
      <g fill='#f7f4ea'>
        <rect y='60' width='160' height='3' rx='1'/><rect y='72' width='160' height='3' rx='1'/>
        <path d='M4 52l4 -5l4 5v28h-8zM24 52l4 -5l4 5v28h-8zM44 52l4 -5l4 5v28h-8zM64 52l4 -5l4 5v28h-8zM84 52l4 -5l4 5v28h-8zM104 52l4 -5l4 5v28h-8zM124 52l4 -5l4 5v28h-8zM144 52l4 -5l4 5v28h-8z'/>
      </g>
      <g fill='#d9d3c2'><rect x='10' y='52' width='2' height='28'/><rect x='30' y='52' width='2' height='28'/><rect x='50' y='52' width='2' height='28'/><rect x='70' y='52' width='2' height='28'/><rect x='90' y='52' width='2' height='28'/><rect x='110' y='52' width='2' height='28'/><rect x='130' y='52' width='2' height='28'/><rect x='150' y='52' width='2' height='28'/></g>
      <rect y='80' width='160' height='6' fill='#6a4b30'/>
      <rect y='80' width='160' height='1' fill='#8a6a48'/>
    `),
    floorColor: '#72b455',
    floorSize: '144px 144px',
    floor: svgTile(144, 144, `
      <rect width='144' height='144' fill='#72b455'/>
      <g fill='#69ac4d'><ellipse cx='30' cy='104' rx='20' ry='10'/><ellipse cx='110' cy='34' rx='18' ry='9'/><ellipse cx='126' cy='118' rx='14' ry='8'/></g>
      <g stroke='#5a9a40' stroke-width='1.4' stroke-linecap='round'>
        <path d='M8 12l2 -5M15 30l2 -5M31 8l-2 -5M40 40l2 -5M6 50l2 -5M52 58l2 -5M62 82l-2 -5M84 66l2 -5M90 44l-2 -5M70 6l2 -5M26 88l2 -5M46 76l-2 -5M78 90l2 -5M36 22l2 -5M58 34l-2 -5M12 66l-2 -5M104 12l2 -5M118 58l-2 -5M134 22l2 -5M96 96l2 -5M112 80l-2 -5M138 70l2 -5M20 122l2 -5M48 110l-2 -5M64 130l2 -5M88 118l2 -5M104 138l-2 -5M130 96l2 -5M6 138l2 -5M40 138l-2 -5'/>
      </g>
      <g stroke='#8fd06c' stroke-width='1.4' stroke-linecap='round'>
        <path d='M22 18l2 -5M44 26l-2 -5M60 12l2 -5M80 32l2 -5M14 42l2 -5M30 60l-2 -5M52 90l2 -5M88 82l-2 -5M72 50l2 -5M92 10l-2 -5M4 92l2 -5M40 90l2 -5M110 20l2 -5M126 46l-2 -5M100 66l2 -5M140 88l2 -5M120 110l-2 -5M56 120l2 -5M76 138l-2 -5M28 132l2 -5M8 112l2 -5M136 130l-2 -5'/>
      </g>
      <g><circle cx='24' cy='46' r='2.4' fill='#fff'/><circle cx='28' cy='42' r='2.4' fill='#fff'/><circle cx='28' cy='50' r='2.4' fill='#fff'/><circle cx='32' cy='46' r='2.4' fill='#fff'/><circle cx='28' cy='46' r='2' fill='#f7c948'/></g>
      <g><circle cx='104' cy='100' r='2.4' fill='#fff'/><circle cx='108' cy='96' r='2.4' fill='#fff'/><circle cx='108' cy='104' r='2.4' fill='#fff'/><circle cx='112' cy='100' r='2.4' fill='#fff'/><circle cx='108' cy='100' r='2' fill='#f7c948'/></g>
      <g fill='#4f8f38'><circle cx='72' cy='72' r='2'/><circle cx='75' cy='69' r='2'/><circle cx='75' cy='75' r='2'/></g>
      <g fill='#4f8f38'><circle cx='128' cy='16' r='2'/><circle cx='131' cy='13' r='2'/><circle cx='131' cy='19' r='2'/></g>
    `)
  },
  nightclub: {
    wallColor: '#1b1030',
    wallSize: '160px 86px',
    wall: svgTile(160, WALL_H, `
      <rect width='160' height='86' fill='#1b1030'/>
      ${speckle([[14, 12], [38, 30], [61, 8], [92, 22], [121, 14], [147, 36], [27, 44], [76, 40], [106, 46], [138, 6]], '#f9a8d4', 1)}
      ${speckle([[50, 20], [84, 10], [131, 28], [8, 34], [116, 40], [154, 18], [66, 48], [98, 4]], '#8fe9ff', 1)}
      <rect y='58' width='160' height='9' fill='#ff4fb0' opacity='.18'/>
      <rect y='61' width='160' height='3' rx='1.5' fill='#ff4fb0'/>
      <rect y='62' width='160' height='1' fill='#ffd0ea'/>
      <rect y='69' width='160' height='9' fill='#48e0ff' opacity='.16'/>
      <rect y='72' width='160' height='3' rx='1.5' fill='#48e0ff'/>
      <rect y='73' width='160' height='1' fill='#d8f8ff'/>
      <rect y='80' width='160' height='6' fill='#0b0614'/>
      <rect y='80' width='160' height='1' fill='#48e0ff' opacity='.5'/>
    `),
    floorColor: '#2c1656',
    floorSize: '160px 160px',
    floor: svgTile(160, 160, checkerTiles(40, ['#3a1a64', '#2c1656', '#4c1f74', '#7a2f8e'], '#0e0618'))
  },
  pizza: {
    wallColor: '#f4e9d6',
    wallSize: '160px 86px',
    wall: svgTile(160, WALL_H, `
      <rect width='160' height='86' fill='#f4e9d6'/>
      <g fill='#c9302c'><rect width='20' height='16'/><rect x='40' width='20' height='16'/><rect x='80' width='20' height='16'/><rect x='120' width='20' height='16'/></g>
      <g fill='#fbf5ea'><rect x='20' width='20' height='16'/><rect x='60' width='20' height='16'/><rect x='100' width='20' height='16'/><rect x='140' width='20' height='16'/></g>
      <g fill='#c9302c'><circle cx='10' cy='16' r='10'/><circle cx='50' cy='16' r='10'/><circle cx='90' cy='16' r='10'/><circle cx='130' cy='16' r='10'/></g>
      <g fill='#fbf5ea'><circle cx='30' cy='16' r='10'/><circle cx='70' cy='16' r='10'/><circle cx='110' cy='16' r='10'/><circle cx='150' cy='16' r='10'/></g>
      <rect y='26' width='160' height='60' fill='#f4e9d6'/>
      <rect y='26' width='160' height='3' fill='rgba(0,0,0,.12)'/>
      <g stroke='#6a4a3a' stroke-width='1.2' fill='none'><path d='M0 36 Q20 44 40 36 T80 36 T120 36 T160 36'/></g>
      <g fill='#f7d34a'><circle cx='10' cy='39' r='2.4'/><circle cx='30' cy='41' r='2.4'/><circle cx='50' cy='39' r='2.4'/><circle cx='70' cy='41' r='2.4'/><circle cx='90' cy='39' r='2.4'/><circle cx='110' cy='41' r='2.4'/><circle cx='130' cy='39' r='2.4'/><circle cx='150' cy='41' r='2.4'/></g>
      <g fill='#c9302c'><rect y='64' width='16' height='16'/><rect x='32' y='64' width='16' height='16'/><rect x='64' y='64' width='16' height='16'/><rect x='96' y='64' width='16' height='16'/><rect x='128' y='64' width='16' height='16'/></g>
      <g fill='#fbf5ea'><rect x='16' y='64' width='16' height='16'/><rect x='48' y='64' width='16' height='16'/><rect x='80' y='64' width='16' height='16'/><rect x='112' y='64' width='16' height='16'/><rect x='144' y='64' width='16' height='16'/></g>
      <rect y='62' width='160' height='2' fill='#b89b7a'/>
      <rect y='80' width='160' height='6' fill='#7a5238'/>
      <rect y='80' width='160' height='1' fill='#a07858'/>
    `),
    floorColor: '#f1e6d4',
    floorSize: '48px 48px',
    floor: svgTile(48, 48, `
      <rect width='48' height='48' fill='#f1e6d4'/>
      <rect width='24' height='24' fill='#dc8f86'/>
      <rect x='24' y='24' width='24' height='24' fill='#dc8f86'/>
      <path d='M24.5 0v48M0 24.5h48M0 .5h48M.5 0v48' stroke='rgba(90,50,40,.14)' stroke-width='1'/>
    `)
  }
}

function skinCss(name, skin) {
  const night = 'linear-gradient(rgba(9,11,42,.52), rgba(9,11,42,.52))'
  const floor = `url("${skin.floor}") 0 ${WALL_H}px / ${skin.floorSize} repeat local`
  const wall = `url("${skin.wall}") 0 0 / ${skin.wallSize} repeat-x`

  return `
.office-room.is-${name} { background: ${floor}, ${skin.floorColor}; }
.office-room.is-${name} .office-wall { background: ${wall}, ${skin.wallColor}; }
.office-root.is-night .office-room.is-${name} { background: ${night} 0 0 / auto repeat local, ${floor}, ${skin.floorColor}; }
.office-root.is-night .office-room.is-${name} .office-wall { background: ${night}, ${wall}, ${skin.wallColor}; }`
}

const BOT_CHAT_TITLE = 'Bot Chat'
const chatCreates = new Map()
const jobPollers = new Map()
let pluginCtx = null

function useTurnBusy() {
  return Boolean(useValue(host.state.busy))
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

// Small stable number per name, for staggering blinks and the like.
function nameHash(name) {
  let h = 0
  for (const ch of String(name || '')) {
    h = (h * 31 + ch.charCodeAt(0)) % 100003
  }
  return h
}

// Type the screen text out one letter at a time once a bot starts thinking.
function typedText(text, elapsedMs, cps = 28) {
  const full = String(text || '')
  const n = Math.max(0, Math.floor((elapsedMs || 0) / (1000 / cps)))
  if (n >= full.length) {
    return full
  }
  return full.slice(0, n) + '\u258d'
}

function faceMood({ held, asleep, pet, clap, stretch, shy, peek, think, bored }) {
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

  if (bored) {
    return 'bored'
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

// One clock for everything that depends on the time of day. Night is the same
// window the room tint uses, so the sky can never disagree with the room.
// `t` runs 0..1 across the sun's arc (7am to 7pm) or the moon's (7pm to 7am).
function skyState(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60
  const night = isNightHour(date)
  const t = night ? (((h - 19 + 24) % 24) / 12) : ((h - 7) / 12)
  const dusk = !night && h >= 17.5
  const dawn = !night && h < 8.5
  return { night, t: Math.max(0, Math.min(1, t)), tone: night ? 'night' : dusk ? 'dusk' : dawn ? 'dawn' : 'day' }
}

function headerLine(names, one, many) {
  const list = (names || []).filter(Boolean)
  if (!list.length) {
    return ''
  }
  const shown = list.slice(0, 2).join(', ')
  const more = list.length > 2 ? ` +${list.length - 2}` : ''
  return `${shown}${more} ${list.length === 1 ? one : many}`
}

// Steady state labels fade after a moment so a full floor stays calm.
function quietStatus(text) {
  return text === 'here' || text === 'at desk' || text === 'exploring'
}

// Which round a completion belongs to, or null if that round already
// celebrated. Rounds without a token (old state) count as round 0.
function completionToken(row) {
  const round = row?.round || 0
  return row?.doneRound === round ? null : round
}

// A bot that has had no task for days, and is idle at its desk, is bored.
function isBored(lastTaskAt, now, thresholdMs = BORED_MS_SLICE) {
  if (!lastTaskAt) {
    return false
  }
  return (now || 0) - lastTaskAt > thresholdMs
}

// Monday 00:00 local for the week that contains `date`.
function weekStart(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return d.getTime()
}

// Bump a weekly counter. Starts a fresh week when the Monday moved on.
function weekBump(stats, key, name, now) {
  const start = weekStart(new Date(now || Date.now()))
  const base = stats && stats.start === start ? stats : { start, tasks: 0, hops: 0, pizzas: {} }
  const next = { ...base, pizzas: { ...(base.pizzas || {}) } }

  if (key === 'pizza') {
    next.pizzas[name] = (next.pizzas[name] || 0) + 1
  } else if (key === 'tasks' || key === 'hops') {
    next[key] = (next[key] || 0) + 1
  }

  return next
}

// First of the month, local midnight.
function monthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

function monthBump(stats, name, now) {
  const start = monthStart(new Date(now || Date.now()))
  const base = stats && stats.start === start ? stats : { start, tasks: {}, holder: null }
  const tasks = { ...(base.tasks || {}), [name]: ((base.tasks || {})[name] || 0) + 1 }
  const holder = monthLeader({ ...base, tasks }, base.holder)
  return { start, tasks, holder }
}

// Who has the most tasks this month. Ties keep the current holder, so a bot
// has to pass them, not just match them, to take the frame.
function monthLeader(stats, prevHolder) {
  const tasks = (stats && stats.tasks) || {}
  let best = null
  let bestN = 0

  for (const [name, n] of Object.entries(tasks)) {
    if (n > bestN || (n === bestN && name === prevHolder)) {
      best = name
      bestN = n
    }
  }

  return bestN > 0 ? best : null
}

function weekLine(stats) {
  if (!stats || (!stats.tasks && !stats.hops && !Object.keys(stats.pizzas || {}).length)) {
    return null
  }

  const bits = []
  if (stats.tasks) {
    bits.push(`${stats.tasks} task${stats.tasks === 1 ? '' : 's'}`)
  }

  const eaters = Object.entries(stats.pizzas || {}).sort((a, b) => b[1] - a[1])
  if (eaters.length) {
    const [who, n] = eaters[0]
    bits.push(`${who} ate ${n} pizza${n === 1 ? '' : 's'}`)
  }

  if (stats.hops) {
    bits.push(`${stats.hops} hop${stats.hops === 1 ? '' : 's'}`)
  }

  return `This week: ${bits.join(', ')}`
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

  return null
}

function resolvePicked(roster, selected, activeProfile) {
  const name = selected || activeProfile

  if (name && roster.some(bot => bot.name === name)) {
    return name
  }

  return roster[0]?.name || null
}

function savePref(key, value) {
  try {
    Promise.resolve(pluginCtx?.storage?.set?.(key, value)).catch(() => undefined)
  } catch {
    /* no storage */
  }
}

function outputText(bot) {
  return (bot.last_session?.preview || '').trim()
}

function previewLine(bot) {
  const text = outputText(bot)
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

function backdropNames() {
  return ['carpet', 'loft', 'garden', 'nightclub', 'pizza']
}

function nextBackdrop(kind) {
  const all = backdropNames()
  const i = all.indexOf(kind)
  return all[((i < 0 ? 0 : i) + 1) % all.length]
}

function idleBotNames(roster, jobs, activeProfile, turnBusy) {
  return (Array.isArray(roster) ? roster : [])
    .filter(
      bot =>
        deskMood({
          isActive: bot.name === activeProfile,
          turnBusy,
          tasked: Boolean(jobs && jobs[bot.name])
        }) === 'idle'
    )
    .map(bot => bot.name)
}

const FACE_HALF = 21
const HOP_ROWS = [[1], [2], [3, 4], [5], [6, 7], [8]]
const BORED_MS_SLICE = 2 * 24 * 60 * 60 * 1000

// Out along the rows, turn at the end, and hop back down.
function hopCourse(rows) {
  const out = Array.isArray(rows) ? rows : []
  if (out.length < 2) {
    return out.slice()
  }

  return out.concat(out.slice(0, -1).reverse())
}

function chairCountForGame(playerCount) {
  return Math.max(0, (playerCount || 0) - 1)
}

function pickFreeStool(stools, taken, radius = 40) {
  const seats = Array.isArray(stools) ? stools : []
  const used = Array.isArray(taken) ? taken : []

  if (!seats.length) {
    return null
  }

  return seats.find(stool => !used.some(spot => near(stool, spot, radius))) || null
}

function nextBarStand(stools, taken, radius = 40) {
  const free = pickFreeStool(stools, taken, radius)
  if (free) {
    return free
  }

  const seats = Array.isArray(stools) ? stools : []
  const last = seats[seats.length - 1]

  if (!last) {
    return null
  }

  const n = (Array.isArray(taken) ? taken : []).length
  return { id: `stand-${n}`, x: last.x - 20, y: last.y + 18 }
}

// Pizza parlor rule: one pizza on the counter per round. A round starts when
// anyone is given a task. The first bot to finish and reach the counter takes
// the slice, everyone after that gets "no pizza".
function freshPizza(now) {
  return { winner: null, at: now }
}

function claimPizza(pizza, name, now) {
  const current = pizza || freshPizza(now)

  if (current.winner) {
    return { pizza: current, won: current.winner === name }
  }

  return { pizza: { winner: name, at: now }, won: true }
}

const CHAIR_PX = 30

// Musical chairs live in the middle of the box, backs together in a small ring.
// Positions are the chair's top-left; `gameRing` says how far out the players circle.
function boxCenter(box) {
  const area = box || { x0: 12, y0: 92, x1: 360, y1: 280 }
  return { x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 }
}

function chairRingRadius(count) {
  return count <= 1 ? 0 : count === 2 ? 22 : 18 + count * 5
}

function placeChairs(n, box) {
  const count = Math.max(0, n || 0)
  const center = boxCenter(box)
  const radius = chairRingRadius(count)
  const chairs = []

  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i / Math.max(1, count)) * Math.PI * 2
    chairs.push({
      id: `c${i}`,
      x: Math.round(center.x + Math.cos(angle) * radius - CHAIR_PX / 2),
      y: Math.round(center.y + Math.sin(angle) * radius - CHAIR_PX / 2)
    })
  }

  return chairs
}

// Where the players walk while the music plays: a wider ring around the chairs.
function gameRing(box, count) {
  const center = boxCenter(box)
  const area = box || { x0: 12, y0: 92, x1: 360, y1: 280 }
  const room = Math.min((area.x1 - area.x0) / 2, (area.y1 - area.y0) / 2) - 26
  const radius = Math.max(56, Math.min(chairRingRadius(count) + 84, room))
  return { center, radius }
}

// Next stop on the ring: keep going clockwise from wherever the player is now.
function ringPoint(ring, from, step = 0.9) {
  const dx = (from?.x ?? ring.center.x) + FACE_HALF - ring.center.x
  const dy = (from?.y ?? ring.center.y) + FACE_HALF - ring.center.y
  const angle = Math.atan2(dy, dx) + step
  return {
    x: ring.center.x + Math.cos(angle) * ring.radius - FACE_HALF,
    y: ring.center.y + Math.sin(angle) * ring.radius - FACE_HALF
  }
}

function assignChairs(players, chairs) {
  const people = Array.isArray(players) ? players : []
  const seats = Array.isArray(chairs) ? chairs : []
  const pairs = []

  for (const person of people) {
    for (const chair of seats) {
      const dx = (person.x || 0) - (chair.x || 0)
      const dy = (person.y || 0) - (chair.y || 0)
      pairs.push({ name: person.name, chair, d: dx * dx + dy * dy })
    }
  }

  pairs.sort((a, b) => a.d - b.d)

  const assigned = {}
  const usedP = new Set()
  const usedC = new Set()

  for (const pair of pairs) {
    if (usedP.has(pair.name) || usedC.has(pair.chair.id)) {
      continue
    }

    assigned[pair.name] = pair.chair
    usedP.add(pair.name)
    usedC.add(pair.chair.id)

    if (usedC.size === seats.length) {
      break
    }
  }

  const leftover = people.map(p => p.name).find(name => !usedP.has(name)) || null
  return { assigned, leftover }
}

function beginWalk(from, to, now, kind, path) {
  const scale = kind === 'chair' ? 0.55 : kind === 'bar' ? 0.68 : 0.72
  const dist = Math.hypot((to?.x || 0) - (from?.x || 0), (to?.y || 0) - (from?.y || 0))
  const ms = kind === 'hopscotch'
    ? Math.max(360, Math.min(1400, dist * 9))
    : Math.max(420, roamMs(from, to) * scale)
  return {
    from,
    to,
    t0: now || 0,
    ms,
    kind: kind || 'home',
    path: Array.isArray(path) ? path : []
  }
}

function advanceWalk(walk, now) {
  if (!walk) {
    return { walk: null, done: true, arrived: false }
  }

  if ((now || 0) - walk.t0 < walk.ms) {
    return { walk, done: false, arrived: false }
  }

  if (walk.path && walk.path.length) {
    const next = walk.path[0]
    return {
      walk: beginWalk(walk.to, next, now, walk.kind, walk.path.slice(1)),
      done: false,
      arrived: false
    }
  }

  return { walk: null, done: true, arrived: true, at: walk.to, kind: walk.kind }
}

function walkHop(raw, kind) {
  const t = Math.max(0, Math.min(1, raw))
  if (t >= 1 || (typeof reducedMotion === 'function' && reducedMotion())) {
    return 0
  }

  if (kind === 'hopscotch') {
    return 4 * t * (1 - t) * 16
  }

  if (kind === 'home' || kind === 'chair' || kind === 'bar') {
    return Math.abs(Math.sin(t * Math.PI * 2)) * 7
  }

  return Math.abs(Math.sin(t * Math.PI * 3)) * 6
}

// Travel easing per walk kind. Hops move at a steady speed so the arc reads
// as a jump. Everything else eases in and out like a stroll.
function walkEase(raw, kind) {
  const t = Math.max(0, Math.min(1, raw))
  return kind === 'hopscotch' ? t : easeInOut(t)
}

// Squash on landing, stretch on take off. Returns x/y scale for the sprite.
function hopSquash(raw, kind) {
  const t = Math.max(0, Math.min(1, raw))
  if (kind !== 'hopscotch' || (typeof reducedMotion === 'function' && reducedMotion())) {
    return { sx: 1, sy: 1 }
  }

  if (t < 0.14) {
    const k = 1 - t / 0.14
    return { sx: 1 + 0.14 * k, sy: 1 - 0.16 * k }
  }

  if (t < 0.34) {
    const k = Math.sin(((t - 0.14) / 0.2) * Math.PI)
    return { sx: 1 - 0.06 * k, sy: 1 + 0.1 * k }
  }

  if (t > 0.9) {
    const k = (t - 0.9) / 0.1
    return { sx: 1 + 0.14 * k, sy: 1 - 0.16 * k }
  }

  return { sx: 1, sy: 1 }
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

function tickRoam(now, roomEl, opts = {}) {
  if (!roomEl) {
    return
  }

  const seats = $seats.get()
  const drag = $drag.get()
  const walks = $walks.get()
  const roam = $roam.get()
  const jobs = opts.jobs || $jobs.get()
  const game = $game.get()
  const players = new Set(game?.players || [])
  const nextRoam = { ...roam }
  const nextSeats = { ...seats }
  let seatsDirty = false
  let roamDirty = false
  const scramble = opts.scramble || false
  const only = opts.only ? new Set(opts.only) : null

  for (const name of Object.keys(seats)) {
    if (only && !only.has(name)) {
      continue
    }

    if (drag?.name === name || walks[name]) {
      continue
    }

    if (!scramble && (jobs[name] || players.has(name))) {
      continue
    }

    const fx = $fx.get()[name] || {}
    if (!scramble && (fx.lingerUntil || 0) > now) {
      continue
    }

    const leg = roam[name]
    const rest = scramble ? 60 : leg?.rest || 0

    if (leg && now - leg.t0 < leg.ms + rest) {
      continue
    }

    const from = leg ? leg.to : seats[name]
    const to = scramble && opts.ring ? ringPoint(opts.ring, from) : roamPoint(roomEl, from)
    const ms = scramble ? Math.max(420, roamMs(from, to) * 0.42) : roamMs(from, to)
    nextRoam[name] = { from, to, t0: now, ms, rest: scramble ? 60 + Math.random() * 80 : 500 + Math.random() * 700 }
    roamDirty = true

    if (leg) {
      nextSeats[name] = from
      seatsDirty = true
    }
  }

  for (const name of Object.keys(nextRoam)) {
    if (!nextSeats[name] && drag?.name !== name) {
      delete nextRoam[name]
      roamDirty = true
    }
  }

  if (roamDirty) {
    $roam.set(nextRoam)
  }

  if (seatsDirty) {
    saveSeats(nextSeats)
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
  const lingering = (row.lingerUntil || 0) > now
  return {
    nap: Boolean(row.nap),
    clap: (row.clapUntil || 0) > now,
    stretch: (row.stretchUntil || 0) > now,
    closer: (row.closerUntil || 0) > now,
    whisper: (row.whisperUntil || 0) > now,
    cheers: Boolean(row.atBar) && lingering,
    pizza: (row.pizzaUntil || 0) > now,
    noPizza: (row.noPizzaUntil || 0) > now,
    drop: (row.dropUntil || 0) > now,
    boot: (row.bootUntil || 0) > now,
    hi: (row.hiUntil || 0) > now,
    ritual: (row.ritualUntil || 0) > now,
    ask: (row.askUntil || 0) > now,
    bang: (row.bangUntil || 0) > now,
    petted: (row.petUntil || 0) > now,
    confetti: (row.confettiUntil || 0) > now,
    five: (row.fiveUntil || 0) > now,
    yawn: (row.yawnUntil || 0) > now,
    thinkSince: row.thinkSince || 0,
    goHome: Boolean(row.goHome),
    goBar: Boolean(row.goBar)
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
        celebrate(name)
      }
    } catch {
      /* keep waiting */
    }
  }, 1600)

  jobPollers.set(name, timer)
}

async function openBot(bot) {
  tap()
  readNote(bot.name)

  try {
    const chat = await ensureBotChat(bot)
    const id = chat?.stored

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
  startRound(bot.name)

  try {
    await host.request('prompt.submit', { session_id: chat.runtime, text: task })
  } catch (err) {
    clearJob(bot.name)
    patchFx(bot.name, { goHome: false })
    throw err
  }

  watchJob(bot.name, chat)
}

function dropBot(name, next, roomEl) {
  const now = Date.now()
  const others = Object.entries($seats.get()).filter(([key]) => key !== name)
  const seats = { ...$seats.get(), [name]: next }
  patchFx(name, { dropUntil: now + 460 })
  puffAt(next.x + FACE_HALF, next.y + FACE_HALF * 2)

  for (const [other, pos] of others) {
    if (near(next, pos, 70)) {
      patchFx(name, { whisperUntil: now + 2800 })
      patchFx(other, { whisperUntil: now + 2800 })
    }
  }

  $drag.set(null)
  patchFx(name, { atBar: false, lingerUntil: 0 })
  saveSeats(seats)
  if (!$jobs.get()[name] && !$game.get()?.players?.includes(name)) {
    setRoam(name, next, roomEl)
  }
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

function elPos(roomEl, el) {
  if (!roomEl || !el) {
    return null
  }

  const room = roomEl.getBoundingClientRect()
  const box = el.getBoundingClientRect()
  return {
    x: box.left - room.left + roomEl.scrollLeft,
    y: box.top - room.top + roomEl.scrollTop
  }
}

// Seat coords are the top-left of a 42px face. Anchor a walker on an element
// by centring the face on it horizontally; `lift` raises it so a body can
// overlap a stool or chair instead of standing on its top edge.
function faceOn(roomEl, el, lift = 0) {
  const pos = elPos(roomEl, el)
  if (!pos) {
    return null
  }

  const box = el.getBoundingClientRect()
  return {
    x: pos.x + box.width / 2 - FACE_HALF,
    y: pos.y + box.height / 2 - FACE_HALF - lift
  }
}

function deskPersonPos(name, roomEl) {
  const desk = roomEl?.querySelector(`[data-desk=${JSON.stringify(name)}]`)
  const slot = desk?.querySelector('.office-person .office-face') || desk?.querySelector('.office-desk-chair') || desk
  return faceOn(roomEl, slot)
}

function currentPos(name, roomEl, now = Date.now()) {
  const drag = $drag.get()
  if (drag?.name === name) {
    return { x: drag.x, y: drag.y }
  }

  const walk = $walks.get()[name]
  if (walk) {
    return roamPos(walk, now)
  }

  const roam = $roam.get()[name]
  if (roam) {
    return roamPos(roam, now)
  }

  return $seats.get()[name] || deskPersonPos(name, roomEl)
}

function setWalk(name, walk) {
  const next = { ...$walks.get() }

  if (walk) {
    next[name] = walk
  } else {
    delete next[name]
  }

  $walks.set(next)
}

function startWalk(name, to, roomEl, kind, path) {
  const from = currentPos(name, roomEl)
  clearRoam(name)

  if (!from || !to) {
    return false
  }

  if ($drag.get()?.name === name) {
    $drag.set(null)
  }

  const seats = { ...$seats.get(), [name]: from }
  saveSeats(seats)
  setWalk(name, beginWalk(from, to, Date.now(), kind, path))
  return true
}

function startWalkHome(name, roomEl) {
  if (!$seats.get()[name] && !$walks.get()[name] && $drag.get()?.name !== name) {
    patchFx(name, { atBar: false, lingerUntil: 0, goHome: false })
    return
  }

  const from = currentPos(name, roomEl)
  clearRoam(name)
  patchFx(name, { atBar: false, lingerUntil: 0, goHome: false })

  if (!from || !roomEl) {
    const next = { ...$seats.get() }
    delete next[name]
    saveSeats(next)
    setWalk(name, null)
    return
  }

  const desk = roomEl.querySelector(`[data-desk=${JSON.stringify(name)}]`)
  const slot = desk?.querySelector('.office-desk-chair') || desk
  if (!slot) {
    const next = { ...$seats.get() }
    delete next[name]
    saveSeats(next)
    setWalk(name, null)
    return
  }

  startWalk(name, faceOn(roomEl, slot), roomEl, 'home')
}

function stoolPoints(roomEl) {
  if (!roomEl) {
    return []
  }

  const els = roomEl.querySelectorAll('[data-stool]')
  const points = [...els].map((el, i) => {
    const pos = faceOn(roomEl, el, 12)
    return pos ? { id: el.getAttribute('data-stool') || String(i), ...pos } : null
  }).filter(Boolean)

  if (points.length) {
    return points
  }

  const box = roomEl.getBoundingClientRect()
  return [0, 1, 2].map(i => ({
    id: String(i),
    x: Math.max(80, box.width - 92),
    y: 118 + i * 52
  }))
}

function takenBarPoints() {
  const now = Date.now()
  const taken = []

  for (const [name, seat] of Object.entries($seats.get())) {
    const row = $fx.get()[name] || {}
    if ((row.lingerUntil || 0) > now) {
      taken.push(seat)
    }
  }

  for (const walk of Object.values($walks.get())) {
    if (walk.kind === 'bar' && walk.to) {
      taken.push(walk.to)
    }
  }

  return taken
}

function startWalkToBar(name, roomEl) {
  const existing = $walks.get()[name]
  if (existing?.kind === 'bar') {
    return
  }

  const fx = $fx.get()[name] || {}
  if (fx.atBar && (fx.lingerUntil || 0) > Date.now()) {
    return
  }

  const dest = nextBarStand(stoolPoints(roomEl), takenBarPoints())
  if (!dest) {
    return
  }

  startWalk(name, dest, roomEl, 'bar')
}

// The course: one landing per row (pairs are landed on together), out to the
// far end and back again. Each point carries the square ids it covers so the
// chalk can light up under the hopper.
function hopscotchPoints(roomEl) {
  if (!roomEl) {
    return []
  }

  const rows = HOP_ROWS.map(row => {
    const spots = row
      .map(n => roomEl.querySelector('[data-hop="' + n + '"]'))
      .map(el => faceOn(roomEl, el))
      .filter(Boolean)
    if (!spots.length) {
      return null
    }

    return {
      id: row.join('-'),
      x: spots.reduce((sum, p) => sum + p.x, 0) / spots.length,
      y: spots.reduce((sum, p) => sum + p.y, 0) / spots.length
    }
  }).filter(Boolean)

  return hopCourse(rows)
}

function startHopscotch(name, roomEl) {
  if (!name || $jobs.get()[name] || $game.get()) {
    return
  }

  const points = hopscotchPoints(roomEl)
  if (points.length < 2) {
    return
  }

  const [first, ...rest] = points
  startWalk(name, first, roomEl, 'hopscotch', rest)
  bumpWeek('hops', name)
}

// Someone got a task: they walk home, and a fresh pizza lands on the counter.
function startRound(name) {
  const now = Date.now()
  patchFx(name, { round: now, nap: false, goHome: true, goBar: false, atBar: false, lingerUntil: 0, pizzaUntil: 0, noPizzaUntil: 0, thinkSince: now, bootUntil: now + 700, askUntil: now + 1400 })
  const last = { ...$lastTask.get(), [name]: now }
  $lastTask.set(last)
  savePref('lastTask', last)
  readNote(name)
  advanceHint('wait')
  $pizza.set(freshPizza(Date.now()))
}

function finishWalk(name, walk) {
  const seats = { ...$seats.get() }

  if (walk.kind === 'home') {
    delete seats[name]
    saveSeats(seats)
    return
  }

  if (walk.to) {
    seats[name] = walk.to
    saveSeats(seats)
  }

  if (walk.kind === 'bar') {
    const now = Date.now()
    patchFx(name, { atBar: true, lingerUntil: now + 4200, clapUntil: now + 1100, nap: false })

    const buddy = Object.entries($fx.get()).find(([other, row]) => other !== name && row.atBar && (row.lingerUntil || 0) > now)
    if (buddy) {
      patchFx(name, { fiveUntil: now + 1500 })
      patchFx(buddy[0], { fiveUntil: now + 1500, clapUntil: now + 900, lingerUntil: Math.max(buddy[1].lingerUntil || 0, now + 1800) })
    }

    if ($backdrop.get() === 'pizza') {
      const { pizza, won } = claimPizza($pizza.get(), name, now)
      $pizza.set(pizza)
      if (won && pizza.winner === name && !(pizza.counted || {})[name]) {
        bumpWeek('pizza', name)
        pizza.counted = { ...(pizza.counted || {}), [name]: true }
      }
      patchFx(name, won ? { pizzaUntil: now + PIZZA_MS, lingerUntil: now + 6000 } : { noPizzaUntil: now + 4200 })
    }
  }
}

// Two bots crossing paths say hi. One hello per pair every so often.
const hiSeen = new Map()
let hiTick = 0

function tickHellos(now, roomEl) {
  if (!roomEl || now - hiTick < 160) {
    return
  }

  hiTick = now
  const walks = $walks.get()
  const roam = $roam.get()
  const names = Object.keys($seats.get()).filter(name => walks[name] || roam[name])
  if (names.length < 2) {
    return
  }

  const spots = names.map(name => ({ name, pos: currentPos(name, roomEl, now) })).filter(x => x.pos)
  const others = Object.keys($seats.get()).filter(name => !walks[name] && !roam[name]).map(name => ({ name, pos: $seats.get()[name] }))

  for (const a of spots) {
    for (const b of [...spots, ...others]) {
      if (a.name === b.name || !near(a.pos, b.pos, 46)) {
        continue
      }

      const key = [a.name, b.name].sort().join('|')
      if (now - (hiSeen.get(key) || 0) < 9000) {
        continue
      }

      hiSeen.set(key, now)
      patchFx(a.name, { hiUntil: now + 1100 })
      patchFx(b.name, { hiUntil: now + 1100 })
    }
  }
}

// After dark, bots left alone at their desks get sleepy: the odd yawn, and
// after a few quiet minutes they nod off. A task or a pet wakes them.
let nightTick = 0

function tickNight(now, night, roster, jobs, activeProfile, turnBusy) {
  if (now - nightTick < 1000) {
    return
  }

  nightTick = now
  const seats = $seats.get()
  const drag = $drag.get()

  for (const bot of roster || []) {
    const name = bot.name
    const row = $fx.get()[name] || {}
    const busy = deskMood({ isActive: name === activeProfile, turnBusy, tasked: Boolean(jobs?.[name]) }) === 'think'
    const away = Boolean(seats[name]) || drag?.name === name

    if (!night || busy || away) {
      if (row.idleSince) {
        patchFx(name, { idleSince: 0 })
      }
      continue
    }

    if (row.nap) {
      continue
    }

    if (!row.idleSince) {
      patchFx(name, { idleSince: now })
      continue
    }

    if (now - row.idleSince > 150000) {
      patchFx(name, { nap: true, yawnUntil: 0 })
      continue
    }

    if ((row.yawnUntil || 0) < now && Math.random() < 0.02) {
      patchFx(name, { yawnUntil: now + 1500 })
    }
  }
}

// On the hour, idle bots at their desks look up and stretch. Once per hour on
// its own, and again on request (clicking the clock within ten minutes of the
// hour) so nobody has to be watching at exactly the right second.
function ritualDue(state, date) {
  const hour = date.getHours()
  return date.getMinutes() === 0 && state.hour !== hour ? hour : -1
}

function ritualReplayable(state, now) {
  return new Date(now).getMinutes() < 10 || (state.at > 0 && now - state.at < RITUAL_WINDOW_MS)
}

function runRitual(roster, jobs, activeProfile, turnBusy, hour) {
  const now = Date.now()
  const seats = $seats.get()
  let i = 0

  for (const bot of roster || []) {
    const busy = deskMood({ isActive: bot.name === activeProfile, turnBusy, tasked: Boolean(jobs?.[bot.name]) }) === 'think'
    if (busy || seats[bot.name] || $drag.get()?.name === bot.name) {
      continue
    }

    const wait = 120 * i++
    patchFx(bot.name, { ritualUntil: now + wait + RITUAL_MS, stretchUntil: now + wait + 900 })
  }

  $ritual.set({ hour: typeof hour === 'number' ? hour : $ritual.get().hour, at: now })
  savePref('ritualHour', $ritual.get().hour)
}

function tickWalks(now) {
  const walks = $walks.get()
  let dirty = false
  const next = { ...walks }

  for (const [name, walk] of Object.entries(walks)) {
    const step = advanceWalk(walk, now)
    if (step.done) {
      delete next[name]
      finishWalk(name, walk)
      if (walk.to && walk.kind !== 'home') {
        puffAt(walk.to.x + FACE_HALF, walk.to.y + FACE_HALF * 2)
      }
      dirty = true
    } else if (step.walk && step.walk !== walk) {
      next[name] = step.walk
      if (walk.kind === 'hopscotch' && walk.to) {
        puffAt(walk.to.x + FACE_HALF, walk.to.y + FACE_HALF * 2)
      }
      dirty = true
    }
  }

  if (dirty) {
    $walks.set(next)
  }
}

function flushGoFlags(roomEl) {
  if (!roomEl) {
    return
  }

  const fx = $fx.get()

  for (const name of Object.keys(fx)) {
    const row = fx[name]
    if (row.goHome) {
      patchFx(name, { goHome: false, atBar: false, lingerUntil: 0 })
      startWalkHome(name, roomEl)
    } else if (row.goBar) {
      patchFx(name, { goBar: false })
      startWalkToBar(name, roomEl)
    }
  }
}

function gameBox(roomEl) {
  const box = roamBox(roomEl)
  const bar = roomEl?.querySelector('.office-bar')

  if (bar) {
    const room = roomEl.getBoundingClientRect()
    const edge = bar.getBoundingClientRect()
    box.x1 = Math.min(box.x1, edge.left - room.left - 18)
  }

  return box
}

function stopMusicalChairs() {
  $game.set(null)
}

function startMusicalChairs(roster, jobs, activeProfile, turnBusy, roomEl) {
  if ($game.get()) {
    stopMusicalChairs()
    return false
  }

  const players = idleBotNames(roster, jobs, activeProfile, turnBusy)
  if (players.length < 2 || !roomEl) {
    return false
  }

  const watchers = roster.map(bot => bot.name).filter(name => !players.includes(name) && !jobs[name])

  const seats = { ...$seats.get() }

  for (const name of players) {
    if (!seats[name] && !$walks.get()[name]) {
      const pos = deskPersonPos(name, roomEl)
      if (pos) {
        seats[name] = pos
      }
    }

  }

  saveSeats(seats)
  const box = gameBox(roomEl)
  const chairs = placeChairs(chairCountForGame(players.length), box)
  const ring = gameRing(box, chairs.length)

  for (const name of players) {
    const from = currentPos(name, roomEl) || seats[name]
    if (from) {
      const to = ringPoint(ring, from, 0)
      $roam.set({ ...$roam.get(), [name]: { from, to, t0: Date.now(), ms: Math.max(420, roamMs(from, to) * 0.6), rest: 60 } })
    }
  }

  $game.set({ phase: 'scramble', t0: Date.now(), players, chairs, ring, watchers })
  tap()
  return true
}

function startSit(game, roomEl) {
  const now = Date.now()
  const people = (game.players || []).map(name => ({
    name,
    x: (currentPos(name, roomEl, now) || {}).x || 0,
    y: (currentPos(name, roomEl, now) || {}).y || 0
  }))
  const chairs = game.chairs || placeChairs(chairCountForGame(people.length), gameBox(roomEl))
  const { assigned, leftover } = assignChairs(people, chairs)

  for (const [name, chair] of Object.entries(assigned)) {
    startWalk(name, { ...chair, x: chair.x + CHAIR_PX / 2 - FACE_HALF, y: chair.y + CHAIR_PX / 2 - FACE_HALF - 10 }, roomEl, 'chair')
  }

  if (leftover) {
    const mid = roamPoint(roomEl)
    startWalk(leftover, mid, roomEl, 'chair')
    patchFx(leftover, { stretchUntil: now + 2200 })
  }

  $game.set({
    phase: 'sit',
    t0: now,
    players: game.players,
    chairs,
    leftover,
    assigned
  })
}

function tickGame(now, roomEl, jobs) {
  const game = $game.get()
  if (!game || !roomEl) {
    return
  }

  if (game.phase === 'scramble') {
    tickRoam(now, roomEl, { scramble: true, only: game.players, jobs, ring: game.ring })

    if (now - game.t0 > 4200) {
      // Music stops. Everyone freezes where they are for a beat.
      const seats = { ...$seats.get() }
      const roam = { ...$roam.get() }
      for (const name of game.players || []) {
        const pos = currentPos(name, roomEl, now)
        if (pos) {
          seats[name] = pos
        }
        delete roam[name]
      }
      saveSeats(seats)
      $roam.set(roam)
      $game.set({ ...game, phase: 'freeze', t0: now })
    }

    return
  }

  if (game.phase === 'freeze') {
    if (now - game.t0 > 420) {
      startSit(game, roomEl)
    }

    return
  }

  if (game.phase === 'sit') {
    const walking = (game.players || []).some(name => $walks.get()[name])
    if (!walking || now - game.t0 > 3600) {
      const clapUntil = now + 1100
      for (const name of game.players || []) {
        if (name !== game.leftover) {
          patchFx(name, { clapUntil })
        }
      }

      for (const name of game.watchers || []) {
        if (!jobs?.[name]) {
          patchFx(name, { clapUntil: now + 1400 })
        }
      }

      $game.set({ ...game, phase: 'out', t0: now })
    }

    return
  }

  if (game.phase === 'out' && now - game.t0 > 2200) {
    $game.set(null)
  }
}

function WorkerFace({ color, image, mood, size = 36, name, sad = false }) {
  const shy = mood === 'shy' || mood === 'held'
  const sleep = mood === 'sleep'
  const peek = mood === 'peek'
  const bored = mood === 'bored'
  const eyeY = peek ? 11 : shy ? 15 : bored ? 19 : sad ? 18 : 17
  const eyeL = shy ? 13.5 : 15
  const eyeR = shy ? 26.5 : 25
  const rx = shy ? 3.1 : 2.4
  const ry = shy ? 3.4 : peek ? 3 : bored ? 1.2 : 2.4
  const hash = nameHash(name)

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
  // Sad brows: body colored lids that sit over the top of each eye at a
  // slant. Parked above the eye (and see-through) the rest of the time so
  // the mood can slide in instead of popping.
  const lidY = sad ? eyeY - ry * 1.3 : eyeY - ry * 2.6
  const eye = (side, cx) =>
    jsxs('g', {
      className: cn('office-eye', side === 'l' ? 'office-eye-l' : 'office-eye-r'),
      children: [
        jsx('ellipse', { className: 'office-pupil', cx, cy: eyeY, rx, ry, fill: ink }),
        jsx('ellipse', {
          className: 'office-lid',
          cx,
          cy: lidY,
          rx: rx + 0.9,
          ry: ry + 0.4,
          fill: color,
          opacity: sad ? 1 : 0,
          transform: `rotate(${side === 'l' ? -18 : 18} ${cx} ${eyeY})`
        })
      ]
    })

  return jsxs('svg', {
    viewBox: '0 0 40 44',
    width: size,
    height: size,
    'aria-hidden': true,
    className: cn('office-face', `office-face-${mood}`, sad && 'is-sad'),
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
            className: 'office-eyes',
            children: [
              // office-gaze: slow wander plus a glance aside now and then, on
              // each bot's own clock. office-blink: the lid squash, also on
              // its own clock, and a quarter of the bots double blink.
              jsx('g', {
                className: 'office-gaze',
                style: {
                  animationDuration: `${(8 + (hash % 41) / 10).toFixed(1)}s`,
                  animationDelay: `-${hash % 7900}ms`
                },
                children: jsxs('g', {
                  className: cn('office-blink', hash % 4 === 0 && 'is-double'),
                  style: {
                    animationDuration: `${(3.2 + (hash % 27) / 10).toFixed(1)}s`,
                    animationDelay: `-${hash % 2900}ms`
                  },
                  children: [eye('l', eyeL), eye('r', eyeR)]
                })
              }),
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

function statusText({ face, isActive, wander, cheers, gamePhase, leftover, pizza, noPizza, walkKind, five, yawn, ritual }) {
  if (face === 'sleep') {
    return 'zzz'
  }

  if (face === 'held') {
    return 'ah!'
  }

  if (face === 'pet') {
    return 'hee'
  }

  if (pizza) {
    return 'pizza!'
  }

  if (noPizza) {
    return 'no pizza'
  }

  if (five) {
    return 'high five!'
  }

  if (yawn && face !== 'sleep') {
    return 'yawn'
  }

  if (ritual && face !== 'sleep' && face !== 'think') {
    return 'break'
  }

  if (cheers) {
    return 'cheers'
  }

  if (face === 'clap') {
    return 'yay'
  }

  if (leftover) {
    return 'doh'
  }

  if (gamePhase === 'scramble') {
    return 'go'
  }

  if (gamePhase === 'freeze') {
    return '!'
  }

  if (gamePhase === 'sit') {
    return 'sit'
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

  if (face === 'bored') {
    return 'bored'
  }

  if (walkKind === 'hopscotch') {
    return 'hop hop'
  }

  if (walkKind === 'bar') {
    return 'to the bar'
  }

  if (walkKind === 'home') {
    return 'heading back'
  }

  if (walkKind === 'chair') {
    return 'mine!'
  }

  if (wander) {
    return 'exploring'
  }

  return isActive ? 'here' : 'at desk'
}

function PizzaSlice({ className }) {
  return jsxs('svg', {
    viewBox: '0 0 20 20',
    width: 18,
    height: 18,
    className,
    'aria-hidden': true,
    children: [
      jsx('path', { d: 'M2 3 L18 3 L10 19 Z', fill: '#f2b53a' }),
      jsx('path', { d: 'M2 3 L18 3 L16.6 6 L3.4 6 Z', fill: '#c9702c' }),
      jsx('circle', { cx: 8, cy: 9, r: 1.6, fill: '#c9302c' }),
      jsx('circle', { cx: 12.5, cy: 10.5, r: 1.5, fill: '#c9302c' }),
      jsx('circle', { cx: 10, cy: 14, r: 1.3, fill: '#c9302c' })
    ]
  })
}

function Person({ bot, look, face, wander, closer, whisper, hi, ask, bang, five, yawn, cheers, gamePhase, leftover, pizza, noPizza, walkKind, drop, ritual, style, onPetStart }) {
  const status = statusText({ face, isActive: onPetStart.isActive, wander, cheers, gamePhase, leftover, pizza, noPizza, walkKind, five, yawn, ritual })
  return jsxs('div', {
    className: cn('office-person', `is-${face}`, wander && 'is-wander', closer && 'is-closer', cheers && 'is-cheers', pizza && 'has-pizza', drop && 'is-drop', ritual && 'is-lookup'),
    style,
    role: 'button',
    tabIndex: 0,
    'aria-label': `Pet ${look.title}`,
    title: `${look.title}. Hover to startle, tap to pet, hold to send to sleep, drag to move.`,
    onPointerEnter: onPetStart.onEnter,
    onPointerLeave: onPetStart.onLeave,
    onPointerDown: onPetStart.onDown,
    onKeyDown: event => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return
      }

      event.preventDefault()
      onPetStart.onActivate?.()
    },
    children: [
      face === 'pet' || face === 'clap' || cheers
        ? jsxs('div', { className: 'office-hearts', 'aria-hidden': true, children: [jsx('span', { children: '♥' }), jsx('span', { children: '♥' }), jsx('span', { children: '♥' })] })
        : null,
      whisper || hi || ask || bang
        ? jsx('div', { className: cn('office-whisper', (hi || ask || bang) && 'is-hi'), children: hi ? 'hi!' : ask ? '?' : bang ? '!' : '\u2026' })
        : null,
      wander ? jsx('span', { className: 'office-ground', 'aria-hidden': true }) : null,
      pizza ? jsx(PizzaSlice, { className: 'office-slice' }) : null,
      jsx(WorkerFace, { color: look.color, image: look.image, mood: face, size: 42, name: bot.name, sad: Boolean(noPizza || leftover) && (face === 'idle' || face === 'stretch') }),
      jsx('span', {
        className: cn('office-status', (face === 'idle' || face === 'shy' || face === 'sleep') && 'is-idle', noPizza && 'is-sad', quietStatus(status) && 'is-quiet'),
        children: status
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
    patchFx(bot.name, { stretchUntil: now + 700, closerUntil: now + 2600, nap: false, idleSince: 0 })
    pickBot(bot.name)
    dismissHint()
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
      onEnter: () => {
        setShy(true)
        tap()
      },
      onLeave: () => {
        if (!held) {
          setShy(false)
        }
      },
      onActivate: () => burstPet(),
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
          const start = startRef.current
          startRef.current = null
          const dragged = Boolean($drag.get() && $drag.get().name === bot.name)
          const moved = movedEnough(start, { x: ev.clientX, y: ev.clientY })

          if (!moved) {
            if (dragged) {
              $drag.set(null)
              patchFx(bot.name, { nap: false })
            } else {
              burstPet()
            }
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
  const walks = useValue($walks)
  const fx = readFx(bot.name, now)
  const seat = drag?.name === bot.name || walks[bot.name] ? true : seats[bot.name]
  const held = drag?.name === bot.name
  const { shy, pet, handlers } = usePersonHandlers(bot, roomRef, held)
  const lastTask = useValue($lastTask)
  const note = Boolean(useValue($news)[bot.name]) && !think
  const bored = !seat && !think && isBored(lastTask[bot.name], now)
  const face = faceMood({
    held,
    asleep: fx.nap || Boolean(drag?.asleep && held),
    pet: pet || fx.petted,
    clap: fx.clap,
    stretch: fx.stretch || fx.yawn,
    shy,
    peek: peek && !seat,
    think,
    bored
  })
  const output = outputText(bot)
  const game = useValue($game)
  const trophies = useValue($trophies)
  const deskRef = useRef(null)
  let watchDx = null

  if (game?.ring && !seat && !think && !(game.players || []).includes(bot.name) && deskRef.current && roomRef?.current) {
    const me = elPos(roomRef.current, deskRef.current)
    if (me) {
      const box = deskRef.current.getBoundingClientRect()
      watchDx = game.ring.center.x > me.x + box.width / 2 ? '2px' : '-2px'
    }
  }

  return jsxs('div', {
    ref: deskRef,
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
          note
            ? jsx('button', {
                type: 'button',
                className: 'office-memo',
                title: `${look.title} has news. Open the chat.`,
                onClick: event => {
                  event.stopPropagation()
                  void onOpen()
                },
                children: jsxs('svg', { viewBox: '0 0 22 18', width: 22, height: 18, 'aria-hidden': true, children: [
                  jsx('path', { d: 'M1 3 L11 10 L21 3 V16 H1 Z', fill: '#fff8e6', stroke: '#8a7a5a', strokeWidth: 1 }),
                  jsx('path', { d: 'M1 3 H21 L11 10 Z', fill: '#f4e9c8', stroke: '#8a7a5a', strokeWidth: 1 })
                ] })
              })
            : null,
          night
            ? jsxs('div', {
                className: 'office-lamp',
                'aria-hidden': true,
                children: [
                  jsx('div', { className: 'office-lamp-shade' }),
                  jsx('div', { className: 'office-lamp-stem' }),
                  jsx('div', { className: 'office-lamp-base' })
                ]
              })
            : null,
          jsx(Monitor, { on: think, text: output, since: fx.thinkSince, now, boot: fx.boot, doodle: bored }),
          fx.confetti
            ? jsx('div', {
                className: 'office-confetti',
                'aria-hidden': true,
                children: Array.from({ length: 7 }, (_, i) => jsx('i', { style: { '--i': i } }, i))
              })
            : null,
          jsxs('div', {
            className: 'office-seat',
            children: [
              jsx(DeskChair, { wobble: Boolean(seat) }),
              seat
                ? null
                : jsx(Person, {
                    bot,
                    look,
                    face,
                    wander: false,
                    closer: fx.closer,
                    whisper: fx.whisper,
                    hi: fx.hi,
                    ask: fx.ask,
                    bang: fx.bang,
                    yawn: fx.yawn,
                    ritual: fx.ritual,
                    style: watchDx ? { '--wdx': watchDx } : undefined,
                    onPetStart: { ...handlers, isActive }
                  })
            ]
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
          jsxs('div', {
            className: 'office-handle',
            children: [
              `@${handle}`,
              trophies[bot.name] ? jsx('span', { className: 'office-stars', title: `${trophies[bot.name]} tasks done`, children: `\u2605 ${trophies[bot.name]}` }) : null
            ]
          })
        ]
      }),
      output
        ? jsx('button', {
            type: 'button',
            className: 'office-say',
            onClick: onOpen,
            title: `Open ${look.title}'s chat`,
            children: output
          })
        : null,
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

function Doodle() {
  return jsxs('svg', { viewBox: '0 0 48 26', className: 'office-doodle', 'aria-hidden': true, children: [
    jsx('circle', { cx: 12, cy: 13, r: 7, fill: 'none', stroke: '#c9d4c4', strokeWidth: 1.2 }),
    jsx('circle', { cx: 9.5, cy: 11, r: 1, fill: '#c9d4c4' }),
    jsx('circle', { cx: 14.5, cy: 11, r: 1, fill: '#c9d4c4' }),
    jsx('path', { d: 'M9 15 Q12 18 15 15', fill: 'none', stroke: '#c9d4c4', strokeWidth: 1.2, strokeLinecap: 'round' }),
    jsx('path', { d: 'M24 18 C 27 6, 31 22, 34 10 S 41 20, 44 8', fill: 'none', stroke: '#c9d4c4', strokeWidth: 1.2, strokeLinecap: 'round', className: 'office-doodle-line' })
  ] })
}

function Monitor({ on, text, since, now, boot, doodle }) {
  const copy = on ? typedText(text || '> working on it', since ? Math.max(0, (now || 0) - since) : 1e9) : text

  return jsxs('div', {
    className: 'office-monitor',
    'aria-hidden': true,
    children: [
      jsxs('div', {
        className: 'office-monitor-head',
        children: [
          jsx('div', {
            className: cn('office-screen', on && 'is-on', copy && 'has-copy', boot && 'is-boot'),
            children: !on && doodle ? jsx(Doodle, {}) : copy ? jsx('div', { className: 'office-screen-copy', children: copy }) : null
          }),
          jsx('div', { className: 'office-monitor-cam' })
        ]
      }),
      jsx('div', { className: 'office-monitor-neck' }),
      jsx('div', { className: 'office-monitor-base' })
    ]
  })
}

function WandererBot({ bot, isActive, turnBusy, tasked, roomRef, now, drag, seats, walk, roam, game }) {
  const look = botLook(bot)
  const think = deskMood({ isActive, turnBusy, tasked }) === 'think'
  const held = drag?.name === bot.name
  const fx = readFx(bot.name, now)
  const { shy, pet, handlers } = usePersonHandlers(bot, roomRef, held)
  let seat = held ? { x: drag.x, y: drag.y } : seats[bot.name]

  let squash = null
  let lift = 0
  let heading = 0

  if (walk) {
    const raw = Math.min(1, (now - walk.t0) / Math.max(1, walk.ms))
    const t = walkEase(raw, walk.kind)
    const hop = walkHop(raw, walk.kind)
    seat = {
      x: walk.from.x + (walk.to.x - walk.from.x) * t,
      y: walk.from.y + (walk.to.y - walk.from.y) * t - hop
    }
    lift = Math.min(1, hop / 12)
    heading = Math.sign(walk.to.x - walk.from.x)
    if (walk.kind === 'hopscotch') {
      const { sx, sy } = hopSquash(raw, walk.kind)
      squash = 'scale(' + sx.toFixed(3) + ', ' + sy.toFixed(3) + ')'
    }
  } else if (roam && !held) {
    const span = Math.max(1, roam.ms)
    const raw = Math.min(1, (now - roam.t0) / span)
    const t = easeInOut(raw)
    const hop = walkHop(raw, game?.phase === 'scramble' ? 'scramble' : 'roam')
    seat = {
      x: roam.from.x + (roam.to.x - roam.from.x) * t,
      y: roam.from.y + (roam.to.y - roam.from.y) * t - hop
    }
    lift = Math.min(1, hop / 12)
    heading = raw < 1 ? Math.sign(roam.to.x - roam.from.x) : 0
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
      pet: pet || fx.petted,
      clap: fx.clap,
      stretch: fx.stretch,
      shy,
      peek: false,
      think
    }),
    wander: true,
    closer: fx.closer,
    whisper: fx.whisper,
    cheers: fx.cheers,
    pizza: fx.pizza,
    noPizza: fx.noPizza,
    walkKind: walk?.kind || null,
    drop: fx.drop,
    hi: fx.hi,
    ask: fx.ask,
    bang: fx.bang,
    five: fx.five,
    gamePhase: game?.players?.includes(bot.name) ? game.phase : null,
    leftover: game?.leftover === bot.name,
    style: {
      left: seat.x,
      top: seat.y,
      transform: squash || undefined,
      '--lift': lift.toFixed(2),
      '--wdx': heading ? `${heading * 2}px` : '0px'
    },
    onPetStart: { ...handlers, isActive }
  })
}

function Wanderers({ roster, isActiveName, turnBusy, jobs, roomRef }) {
  const seats = useValue($seats)
  const drag = useValue($drag)
  const walks = useValue($walks)
  const roam = useValue($roam)
  const game = useValue($game)
  const moving = Boolean(drag) || Object.keys(walks).length > 0 || Object.keys(roam).length > 0 || Boolean(game)
  const now = usePulse(moving ? 16 : 240)
  const names = new Set([...Object.keys(seats), drag?.name, ...Object.keys(walks)].filter(Boolean))

  useEffect(() => {
    flushGoFlags(roomRef.current)
    tickWalks(now)
    tickGame(now, roomRef.current, jobs)
    tickHellos(now, roomRef.current)
  }, [now, jobs, roomRef])

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
            walk: walks[bot.name],
            roam: roam[bot.name],
            game
          },
          bot.name
        )
      )
  })
}

// A wooden slat chair for musical chairs.
function GameChair({ claimed, id, style }) {
  return jsxs('svg', {
    viewBox: '0 0 30 36',
    width: 30,
    height: 36,
    className: cn('office-game-chair', claimed && 'is-claimed'),
    'data-game-chair': id,
    style,
    'aria-hidden': true,
    children: [
      jsx('rect', { x: 6, y: 1, width: 18, height: 14, rx: 3, fill: '#a26b3f' }),
      jsx('rect', { x: 8, y: 5, width: 14, height: 2, rx: 1, fill: 'rgba(0,0,0,.18)' }),
      jsx('rect', { x: 8, y: 9, width: 14, height: 2, rx: 1, fill: 'rgba(0,0,0,.18)' }),
      jsx('rect', { x: 3, y: 15, width: 24, height: 7, rx: 2, fill: '#b87b4a' }),
      jsx('rect', { x: 3, y: 15, width: 24, height: 2, rx: 1, fill: 'rgba(255,255,255,.28)' }),
      jsx('rect', { x: 5, y: 22, width: 3, height: 13, rx: 1, fill: '#6b4425' }),
      jsx('rect', { x: 22, y: 22, width: 3, height: 13, rx: 1, fill: '#6b4425' }),
      jsx('rect', { x: 8, y: 27, width: 14, height: 2, rx: 1, fill: '#6b4425' })
    ]
  })
}

// The office chair at every desk. Bots sit on it; it wobbles when they leave.
function DeskChair({ wobble }) {
  return jsxs('svg', {
    viewBox: '0 0 42 46',
    width: 42,
    height: 46,
    className: cn('office-desk-chair', wobble && 'is-wobble'),
    'aria-hidden': true,
    children: [
      jsx('rect', { x: 8, y: 1, width: 26, height: 22, rx: 7, fill: '#3b3b43' }),
      jsx('rect', { x: 11, y: 4, width: 20, height: 16, rx: 5, fill: '#4c4c56' }),
      jsx('rect', { x: 4, y: 22, width: 34, height: 10, rx: 4, fill: '#454550' }),
      jsx('rect', { x: 4, y: 22, width: 34, height: 3, rx: 1.5, fill: 'rgba(255,255,255,.14)' }),
      jsx('rect', { x: 19.5, y: 32, width: 3, height: 7, rx: 1, fill: '#8a8a94' }),
      jsx('path', { d: 'M21 39 L7 44 M21 39 L35 44 M21 39 L21 45', stroke: '#8a8a94', strokeWidth: 2.4, strokeLinecap: 'round' }),
      jsx('circle', { cx: 7, cy: 44.5, r: 1.6, fill: '#26262c' }),
      jsx('circle', { cx: 35, cy: 44.5, r: 1.6, fill: '#26262c' }),
      jsx('circle', { cx: 21, cy: 45, r: 1.6, fill: '#26262c' })
    ]
  })
}

function Puffs() {
  const puffs = useValue($puffs)
  if (!puffs.length) {
    return null
  }

  return jsx('div', {
    className: 'office-puff-layer',
    'aria-hidden': true,
    children: puffs.map(p => jsx('span', { className: 'office-puff', style: { left: p.x, top: p.y } }, p.id))
  })
}

// Eyes follow the pointer when it is close. Done straight on the DOM so a
// moving mouse does not re-render the whole floor.
function useEyeTracking(roomRef) {
  useEffect(() => {
    const room = roomRef.current
    if (!room || reducedMotion()) {
      return undefined
    }

    let frame = 0
    let last = null

    const apply = () => {
      frame = 0
      const faces = room.querySelectorAll('svg.office-face')
      for (const face of faces) {
        if (!last) {
          face.style.removeProperty('--edx')
          face.style.removeProperty('--edy')
          continue
        }

        const box = face.getBoundingClientRect()
        const vx = last.x - (box.left + box.width / 2)
        const vy = last.y - (box.top + box.height / 2)
        const d = Math.hypot(vx, vy)
        if (d > 200 || d < 1) {
          face.style.removeProperty('--edx')
          face.style.removeProperty('--edy')
          continue
        }

        const k = Math.min(1, d / 60) * 2.2
        face.style.setProperty('--edx', `${((vx / d) * k).toFixed(2)}px`)
        face.style.setProperty('--edy', `${((vy / d) * k * 0.7).toFixed(2)}px`)
      }
    }

    const onMove = event => {
      last = { x: event.clientX, y: event.clientY }
      if (!frame) {
        frame = requestAnimationFrame(apply)
      }
    }

    const onLeave = () => {
      last = null
      if (!frame) {
        frame = requestAnimationFrame(apply)
      }
    }

    room.addEventListener('pointermove', onMove)
    room.addEventListener('pointerleave', onLeave)
    return () => {
      room.removeEventListener('pointermove', onMove)
      room.removeEventListener('pointerleave', onLeave)
      if (frame) {
        cancelAnimationFrame(frame)
      }
    }
  }, [roomRef])
}

function GameChairs() {
  const game = useValue($game)
  if (!game?.chairs?.length) {
    return null
  }

  const center = game.ring?.center
  const notes = game.phase === 'scramble' && center && !reducedMotion()
    ? [0, 1, 2, 3].map(i =>
        jsx('span', {
          className: 'office-note',
          style: { left: center.x + [-30, 18, -6, 34][i], top: center.y + [-46, -60, -78, -40][i], '--d': `${i * 0.45}s` },
          children: i % 2 ? '\u266a' : '\u266b'
        }, i)
      )
    : []

  return jsxs('div', {
    className: 'office-game-layer',
    'aria-hidden': true,
    children: [
      ...game.chairs.map(chair =>
        jsx(GameChair, { id: chair.id, claimed: game.phase === 'out', style: { left: chair.x, top: chair.y } }, chair.id)
      ),
      ...notes
    ]
  })
}

// Chalk hopscotch on the floor: 1, 2, 3|4, 5, 6|7, 8.

function litHopSquares(walks, now) {
  const lit = new Set()
  for (const walk of Object.values(walks || {})) {
    if (walk?.kind !== 'hopscotch') {
      continue
    }

    const raw = (now - walk.t0) / Math.max(1, walk.ms)
    const spot = raw < 0.45 ? walk.from : raw > 0.8 ? walk.to : null
    for (const id of String(spot?.id || '').split('-')) {
      if (id) {
        lit.add(id)
      }
    }
  }

  return lit
}

function Hopscotch({ onHop, now }) {
  const walks = useValue($walks)
  const lit = litHopSquares(walks, now)

  return jsxs('div', {
    className: 'office-aisle',
    children: [
      jsx('div', { className: 'office-hop-label', children: 'hop' }),
      ...HOP_ROWS.map(row =>
        jsx(
          'div',
          {
            className: 'office-hop-row',
            children: row.map(n =>
              jsx(
                'button',
                {
                  type: 'button',
                  className: cn('office-hop', lit.has(String(n)) && 'is-lit'),
                  'data-hop': String(n),
                  'aria-label': `Hopscotch square ${n}`,
                  title: 'Tap to send an idle bot down the hopscotch',
                  onPointerDown: event => {
                    event.stopPropagation()
                    onHop?.()
                  },
                  children: n
                },
                n
              )
            )
          },
          row.join('-')
        )
      )
    ]
  })
}

// The pie on the pizza counter. Loses a slice once someone has claimed it.
function PizzaPie({ eaten }) {
  return jsxs('svg', {
    viewBox: '0 0 40 40',
    width: 34,
    height: 34,
    className: cn('office-pie', eaten && 'is-eaten'),
    'aria-hidden': true,
    children: [
      jsx('circle', { cx: 20, cy: 20, r: 19.5, fill: '#4a4a4e' }),
      jsx('circle', { cx: 20, cy: 20, r: 18, fill: '#c9702c' }),
      jsx('circle', { cx: 20, cy: 20, r: 15, fill: '#f2b53a' }),
      jsxs('g', {
        fill: '#c9302c',
        children: [
          jsx('circle', { cx: 13, cy: 14, r: 2.4 }),
          jsx('circle', { cx: 25, cy: 12, r: 2.4 }),
          jsx('circle', { cx: 28, cy: 23, r: 2.4 }),
          jsx('circle', { cx: 18, cy: 26, r: 2.4 }),
          jsx('circle', { cx: 10, cy: 24, r: 2.2 }),
          jsx('circle', { cx: 21, cy: 19, r: 2 })
        ]
      }),
      jsxs('g', {
        fill: '#4f8f38',
        children: [
          jsx('ellipse', { cx: 16, cy: 20, rx: 2, ry: 1.2, transform: 'rotate(-30 16 20)' }),
          jsx('ellipse', { cx: 25, cy: 28, rx: 2, ry: 1.2, transform: 'rotate(20 25 28)' })
        ]
      }),
      jsx('path', { d: 'M20 20 L20 3 A17 17 0 0 1 35.6 11 Z', stroke: 'rgba(0,0,0,.18)', strokeWidth: 1, fill: 'none' }),
      eaten
        ? jsx('path', { d: 'M20 20 L20 1.5 A18.5 18.5 0 0 1 36.7 11.2 Z', fill: '#4a4a4e' })
        : null
    ]
  })
}

// Back bar: a row of bottles on the shelf.
function BarBottles() {
  const bottles = [
    { x: 4, h: 22, w: 7, fill: '#3d7a3a' },
    { x: 15, h: 26, w: 7, fill: '#c98a2a' },
    { x: 26, h: 18, w: 8, fill: '#e6dcc4' },
    { x: 38, h: 24, w: 7, fill: '#8a2a3a' },
    { x: 49, h: 20, w: 7, fill: '#4a86c9' },
    { x: 60, h: 25, w: 7, fill: '#2b2b2f' },
    { x: 71, h: 19, w: 8, fill: '#c9702c' },
    { x: 83, h: 23, w: 7, fill: '#3d7a3a' },
    { x: 94, h: 21, w: 7, fill: '#e6dcc4' }
  ]

  return jsx('svg', {
    viewBox: '0 0 108 30',
    className: 'office-bar-bottles',
    preserveAspectRatio: 'xMidYMax meet',
    'aria-hidden': true,
    children: bottles.map((b, i) =>
      jsxs('g', {
        children: [
          jsx('rect', { x: b.x + b.w / 2 - 1.5, y: 30 - b.h, width: 3, height: 6, rx: 1, fill: b.fill }),
          jsx('rect', { x: b.x, y: 30 - b.h + 5, width: b.w, height: b.h - 5, rx: 1.5, fill: b.fill }),
          jsx('rect', { x: b.x + 1.2, y: 30 - b.h + 8, width: 1.4, height: b.h - 11, rx: .7, fill: 'rgba(255,255,255,.35)' }),
          jsx('rect', { x: b.x + 1, y: 30 - b.h + 11, width: b.w - 2, height: 5, rx: .5, fill: 'rgba(255,255,255,.55)' })
        ]
      }, i)
    )
  })
}

// Beer taps and a poured pint on the counter.
function BarTaps() {
  return jsxs('svg', {
    viewBox: '0 0 64 30',
    width: 64,
    height: 30,
    className: 'office-bar-taps',
    'aria-hidden': true,
    children: [
      jsx('rect', { x: 14, y: 12, width: 26, height: 18, rx: 3, fill: '#8f949c' }),
      jsx('rect', { x: 16, y: 13, width: 6, height: 16, rx: 2, fill: 'rgba(255,255,255,.35)' }),
      jsx('rect', { x: 20, y: 2, width: 3, height: 12, rx: 1.5, fill: '#2b2b2f' }),
      jsx('circle', { cx: 21.5, cy: 3, r: 2.6, fill: '#c9302c' }),
      jsx('rect', { x: 31, y: 2, width: 3, height: 12, rx: 1.5, fill: '#2b2b2f' }),
      jsx('circle', { cx: 32.5, cy: 3, r: 2.6, fill: '#3d7a3a' }),
      jsx('rect', { x: 46, y: 12, width: 12, height: 18, rx: 1.5, fill: '#f2b53a' }),
      jsx('rect', { x: 46, y: 12, width: 12, height: 18, rx: 1.5, fill: 'none', stroke: 'rgba(255,255,255,.55)', strokeWidth: 1 }),
      jsx('ellipse', { cx: 52, cy: 12, rx: 7, ry: 3.2, fill: '#fff' }),
      jsx('circle', { cx: 56.5, cy: 10, r: 1.6, fill: '#fff' })
    ]
  })
}

function OfficeBar({ count, now }) {
  const n = Math.min(6, Math.max(3, count || 3))
  const backdrop = useValue($backdrop)
  const pizza = useValue($pizza)
  const parlor = backdrop === 'pizza'
  const ding = parlor && pizza?.at && !pizza.winner && (now || 0) - pizza.at < 1400

  return jsxs('aside', {
    className: 'office-bar',
    children: [
      jsx('div', { className: 'office-bar-sign', children: parlor ? 'Pizza' : 'Bar' }),
      ding ? jsx('div', { className: 'office-ding office-chip', children: 'ding!' }) : null,
      jsx('div', { className: 'office-bar-shelf', 'aria-hidden': true, children: parlor ? null : jsx(BarBottles, {}) }),
      jsx('div', {
        className: 'office-bar-counter',
        'aria-hidden': true,
        children: parlor ? jsx(PizzaPie, { eaten: Boolean(pizza?.winner) }) : jsx(BarTaps, {})
      }),
      jsx('div', {
        className: 'office-bar-stools',
        children: Array.from({ length: n }, (_, i) =>
          jsx('div', { className: 'office-bar-stool', 'data-stool': String(i), 'aria-hidden': true }, i)
        )
      })
    ]
  })
}

function FloorTools({ roster, jobs, activeProfile, turnBusy, roomRef, idleCount }) {
  const backdrop = useValue($backdrop)
  const game = useValue($game)

  return jsxs('div', {
    className: 'office-tools',
    children: [
      jsx('button', {
        type: 'button',
        className: 'office-tool',
        title: 'Change the room',
        onClick: () => {
          const next = nextBackdrop($backdrop.get())
          $backdrop.set(next)
          savePref('backdrop', next)
          tap()
        },
        children: backdrop
      }),
      jsx('button', {
        type: 'button',
        className: cn('office-tool', game && 'is-on'),
        title: game ? 'Stop musical chairs' : 'Play musical chairs',
        disabled: !game && idleCount < 2,
        onClick: () => {
          startMusicalChairs(roster, jobs, activeProfile, turnBusy, roomRef.current)
        },
        children: game ? 'stop' : 'chairs'
      })
    ]
  })
}

// One small living thing per room, so each skin feels like a place. Plus the
// tally board on the wall once anyone has finished a task.
function SunMoon({ sky }) {
  const left = `calc(8% + ${(sky.t * 84).toFixed(1)}%)`
  const top = 46 - Math.sin(sky.t * Math.PI) * 32
  return sky.night
    ? jsxs('svg', { className: 'office-moon', viewBox: '0 0 20 20', width: 18, height: 18, style: { left, top }, children: [
        jsx('circle', { cx: 10, cy: 10, r: 8, fill: '#f4f0d8' }),
        jsx('circle', { cx: 13.5, cy: 8, r: 7, fill: '#0f1a3a' })
      ] })
    : jsx('svg', { className: 'office-sun', viewBox: '0 0 20 20', width: 22, height: 22, style: { left, top }, children: jsx('circle', { cx: 10, cy: 10, r: 8, fill: sky.tone === 'day' ? '#ffd44d' : '#ffb347' }) })
}

function WallWindow({ sky }) {
  const glass = { day: '#a9d8f2', dawn: '#f6c9a0', dusk: '#f0a05a', night: '#182a58' }[sky.tone]
  const cx = 6 + sky.t * 28
  const cy = 24 - Math.sin(sky.t * Math.PI) * 12
  return jsxs('svg', { className: 'office-window', viewBox: '0 0 44 40', width: 44, height: 40, children: [
    jsx('rect', { x: 2, y: 2, width: 40, height: 34, rx: 3, fill: glass }),
    sky.night
      ? jsxs('g', { fill: '#f4f0d8', children: [jsx('circle', { cx: 12, cy: 10, r: .9 }), jsx('circle', { cx: 30, cy: 14, r: .8 }), jsx('circle', { cx: 22, cy: 24, r: .7 }), jsx('circle', { cx: cx, cy: cy, r: 3.2 })] })
      : jsx('circle', { cx, cy, r: 3.6, fill: sky.tone === 'day' ? '#ffd44d' : '#ffb347' }),
    jsx('rect', { x: 20.5, y: 2, width: 3, height: 34, fill: '#f4efe6' }),
    jsx('rect', { x: 2, y: 17.5, width: 40, height: 3, fill: '#f4efe6' }),
    jsx('rect', { x: 2, y: 2, width: 40, height: 34, rx: 3, fill: 'none', stroke: '#f4efe6', strokeWidth: 3 }),
    jsx('rect', { x: 0, y: 35, width: 44, height: 4, rx: 1, fill: '#e2d9c8' })
  ] })
}

// A framed portrait on the wall for the bot with the most tasks this month.
function EmployeeOfMonth({ roster }) {
  const stats = useValue($month)
  const holder = stats && stats.start === monthStart(new Date()) ? stats.holder : null
  const bot = holder ? roster.find(row => row.name === holder) : null
  if (!bot) {
    return null
  }

  const look = botLook(bot)
  const n = stats.tasks?.[holder] || 0
  const month = new Date().toLocaleString(undefined, { month: 'long' })

  return jsxs('div', {
    className: 'office-eom',
    title: `Employee of the month: ${look.title}, ${n} task${n === 1 ? '' : 's'} in ${month}`,
    children: [
      jsx('div', { className: 'office-eom-frame', children: jsx(WorkerFace, { color: look.color, image: look.image, mood: 'idle', size: 30, name: bot.name }) }),
      jsx('div', { className: 'office-eom-plate', children: 'employee of the month' }),
      jsx('div', { className: 'office-eom-name', children: look.title })
    ]
  }, holder)
}

// "3 tasks done overall" plus who did what, for the tally board tooltip.
function tallyTitle(tally, trophies, roster) {
  const head = `${tally} task${tally === 1 ? '' : 's'} done overall`
  const rows = (roster || [])
    .map(bot => [botLook(bot).title, (trophies || {})[bot.name] || 0])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([title, n]) => `${title}: ${n}`)
  return rows.length ? `${head}\n${rows.join('\n')}` : head
}

function Ambience({ backdrop, tally, sky, roster, trophies }) {
  const bits = []

  bits.push(jsx(EmployeeOfMonth, { roster: roster || [] }, 'eom'))

  if (sky && backdrop === 'garden') {
    bits.push(jsx(SunMoon, { sky }, 'sunmoon'))
  }

  if (sky && (backdrop === 'carpet' || backdrop === 'loft')) {
    bits.push(jsx(WallWindow, { sky }, 'window'))
  }

  if (tally > 0) {
    bits.push(jsx('div', { className: 'office-tally office-chip', title: tallyTitle(tally, trophies, roster), children: `${tally} done` }, 'tally'))
  }

  if (backdrop === 'garden') {
    bits.push(
      jsx('svg', { className: 'office-butterfly is-a', viewBox: '0 0 20 14', width: 28, height: 20, children: jsxs('g', { children: [
        jsx('ellipse', { className: 'office-wing', cx: 6, cy: 7, rx: 6, ry: 5, fill: '#f6a5c0' }),
        jsx('ellipse', { className: 'office-wing is-r', cx: 14, cy: 7, rx: 6, ry: 5, fill: '#f6a5c0' }),
        jsx('rect', { x: 9, y: 2, width: 2, height: 10, rx: 1, fill: '#4a3a3a' })
      ] }) }, 'b1'),
      jsx('svg', { className: 'office-butterfly is-b', viewBox: '0 0 20 14', width: 22, height: 15, children: jsxs('g', { children: [
        jsx('ellipse', { className: 'office-wing', cx: 6, cy: 7, rx: 6, ry: 5, fill: '#8fd0ff' }),
        jsx('ellipse', { className: 'office-wing is-r', cx: 14, cy: 7, rx: 6, ry: 5, fill: '#8fd0ff' }),
        jsx('rect', { x: 9, y: 2, width: 2, height: 10, rx: 1, fill: '#4a3a3a' })
      ] }) }, 'b2')
    )
  }

  if (backdrop === 'nightclub') {
    bits.push(jsx('div', { className: 'office-sweep' }, 'sweep'))
  }

  if (backdrop === 'pizza') {
    bits.push(jsxs('svg', { className: 'office-oven', viewBox: '0 0 44 50', width: 44, height: 50, children: [
      jsx('rect', { x: 2, y: 8, width: 40, height: 42, rx: 4, fill: '#8a5a3a' }),
      jsx('rect', { x: 2, y: 8, width: 40, height: 6, rx: 3, fill: '#a87048' }),
      jsx('rect', { x: 14, y: 2, width: 16, height: 8, rx: 2, fill: '#5a3a26' }),
      jsx('path', { d: 'M8 42 V30 A14 12 0 0 1 36 30 V42 Z', fill: '#2a1810' }),
      jsx('path', { className: 'office-oven-fire', d: 'M12 42 V32 A10 9 0 0 1 32 32 V42 Z', fill: '#ff8a2a' }),
      jsx('rect', { x: 6, y: 42, width: 32, height: 4, rx: 1, fill: '#5a3a26' })
    ] }, 'oven'))
  }

  if (backdrop === 'carpet') {
    bits.push(jsxs('svg', { className: 'office-cooler', viewBox: '0 0 22 52', width: 22, height: 52, children: [
      jsx('rect', { x: 4, y: 20, width: 14, height: 30, rx: 2, fill: '#e9ecf0' }),
      jsx('rect', { x: 4, y: 20, width: 14, height: 4, fill: '#c9d0da' }),
      jsx('rect', { x: 8, y: 30, width: 6, height: 4, rx: 1, fill: '#4f7cff' }),
      jsx('rect', { x: 5, y: 2, width: 12, height: 19, rx: 4, fill: '#a9d8f2', opacity: 0.9 }),
      jsx('circle', { className: 'office-bubble', cx: 9, cy: 16, r: 1.3, fill: '#fff' }),
      jsx('circle', { className: 'office-bubble is-2', cx: 13, cy: 18, r: 1, fill: '#fff' })
    ] }, 'cooler'))
  }

  if (backdrop === 'loft') {
    bits.push(jsxs('svg', { className: 'office-pendant', viewBox: '0 0 30 40', width: 30, height: 40, children: [
      jsx('rect', { x: 14, y: 0, width: 2, height: 18, fill: '#3a3a3a' }),
      jsx('path', { d: 'M4 30 L11 18 H19 L26 30 Z', fill: '#3f3f44' }),
      jsx('ellipse', { cx: 15, cy: 30, rx: 11, ry: 2.5, fill: '#ffe4a8' }),
      jsx('circle', { cx: 15, cy: 27, r: 3, fill: '#fff2c8' })
    ] }, 'pendant'))
  }

  return jsx(Fragment, { children: bits })
}

// First run only. One bubble that says what the toy does. Closing it, or
// doing any of the things it mentions, puts it away for good.
// Onboarding in two moments. First: give someone a task (points at the task
// bar). After the first result comes back: pet them, and try one game.
function HintBubble({ roster, stage, onClose }) {
  const first = roster[0] ? botLook(roster[0]).title : 'a bot'
  const copy = stage === 'task'
    ? [jsx('b', { children: `Give ${first} something small.` }, 'b'), ' Type it in the bar below and press Send. Watch the desk.']
    : [jsx('b', { children: `${first} is back. Try petting them.` }, 'b'), ' Hover to startle, tap to pet, hold to send to sleep, drag to move. Then tap a hop square or press chairs.']

  return jsxs('div', {
    className: cn('office-hint', stage === 'task' && 'is-task'),
    role: 'note',
    children: [
      jsx('div', { className: 'office-hint-copy', children: copy }),
      jsx('button', { type: 'button', className: 'office-hint-close', 'aria-label': 'Dismiss', onClick: onClose, children: '\u00d7' })
    ]
  })
}

// Stages: 'task' (show the first bubble), 'wait' (task sent, hold), 'play'
// (show the second bubble), 'done'. 'off' means storage has not answered yet.
function setHint(stage) {
  $hint.set(stage)
  savePref('hintStage', stage)
}

function advanceHint(next) {
  const cur = $hint.get()
  if (cur === 'off' || cur === 'done') {
    return
  }
  if (next === 'wait' && cur === 'task') {
    setHint('wait')
  } else if (next === 'play' && (cur === 'wait' || cur === 'task')) {
    setHint('play')
  }
}

// Doing any of the things the bubble teaches puts it away.
function dismissHint() {
  const cur = $hint.get()
  if (cur === 'off' || cur === 'done') {
    return
  }
  setHint('done')
}

// "Scout thinking", "Scout, Arke thinking", "Scout, Arke +2 thinking".
function headerNames(names, one, many) {
  return headerLine(names, one, many)
}

function scrollToDesk(roomEl, name) {
  const desk = roomEl?.querySelector?.(`[data-desk=${JSON.stringify(name)}]`)
  if (desk?.scrollIntoView) {
    desk.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center', inline: 'nearest' })
  }
  pickBot(name)
}

function OfficeProps({ now, roomRef, onReplay }) {
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
    onReplay?.()
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

// Measure the send button and the target desk's monitor, both relative to the
// office root, and let a plane fly between them.
function launchPlane(buttonEl, name) {
  const root = buttonEl?.closest?.('.office-root')
  const monitor = root?.querySelector?.(`[data-desk=${JSON.stringify(name)}] .office-monitor-head`)
  if (!root || !monitor || reducedMotion()) {
    return
  }

  const base = root.getBoundingClientRect()
  const a = buttonEl.getBoundingClientRect()
  const b = monitor.getBoundingClientRect()
  flyPlane(
    { x: a.left - base.left + a.width / 2, y: a.top - base.top + a.height / 2 },
    { x: b.left - base.left + b.width / 2, y: b.top - base.top + b.height / 2 }
  )
}

function Planes() {
  const planes = useValue($planes)
  if (!planes.length) {
    return null
  }

  return jsx('div', {
    className: 'office-plane-layer',
    'aria-hidden': true,
    children: planes.map(p => {
      const dx = p.to.x - p.from.x
      const dy = p.to.y - p.from.y
      const rot = (Math.atan2(dy, dx) * 180) / Math.PI
      return jsx('svg', {
        viewBox: '0 0 24 16',
        width: 24,
        height: 16,
        className: 'office-plane',
        style: { left: p.from.x, top: p.from.y, '--dx': `${dx}px`, '--dy': `${dy}px`, '--rot': `${rot}deg` },
        children: jsx('path', { d: 'M1 8 L23 1 L15 15 L11 10 Z M11 10 L23 1', fill: '#f4f4f8', stroke: '#6b6f7a', strokeWidth: 1, strokeLinejoin: 'round' })
      }, p.id)
    })
  })
}

function TaskBar({ roster, activeProfile }) {
  const selected = useValue($selected)
  const focusToken = useValue($focusTask)
  const jobs = useValue($jobs)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const sendRef = useRef(null)
  const picked = resolvePicked(roster, selected, activeProfile)
  const bot = roster.find(row => row.name === picked) || null
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
    launchPlane(sendRef.current, bot.name)

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
        ref: sendRef,
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
  const now = usePulse(200)
  const night = isNightHour(new Date(now))
  const sky = skyState(new Date(now))
  const peek = useValue($peekUntil) > now
  const jobs = useValue($jobs)
  const backdrop = useValue($backdrop)
  const trophies = useValue($trophies)
  const hint = useValue($hint)
  const week = useValue($week)
  const roomRef = useRef(null)
  const prevBusy = useRef(false)
  const roster = Array.isArray(data?.profiles) ? data.profiles : []
  const selected = resolvePicked(roster, useValue($selected), activeProfile)
  const working = roster.filter(
    bot => deskMood({ isActive: bot.name === activeProfile, turnBusy, tasked: Boolean(jobs[bot.name]) }) === 'think'
  )
  const idleCount = idleBotNames(roster, jobs, activeProfile, turnBusy).length
  const news = useValue($news)
  const newsNames = roster.map(bot => bot.name).filter(name => news[name])
  const nameOf = name => {
    const bot = roster.find(row => row.name === name)
    return bot ? botLook(bot).title : name
  }

  useEffect(() => {
    pullAvatars(roster)
  }, [roster])

  useEffect(() => {
    if (prevBusy.current && !turnBusy && activeProfile) {
      celebrate(activeProfile)
    }

    if (turnBusy && activeProfile) {
      startRound(activeProfile)
    }

    prevBusy.current = turnBusy
  }, [turnBusy, activeProfile])

  useEffect(() => {
    tickRoam(now, roomRef.current, { jobs })
  }, [now, jobs])

  useEffect(() => {
    tickNight(now, night, roster, jobs, activeProfile, turnBusy)
  }, [now, night, roster, jobs, activeProfile, turnBusy])

  useEffect(() => {
    seedTrophies(roster)
    seedMonth(roster)
  }, [roster, trophies])

  useEffect(() => {
    const due = ritualDue($ritual.get(), new Date(now))
    if (due >= 0 && roster.length) {
      runRitual(roster, jobs, activeProfile, turnBusy, due)
    }
  }, [now, roster, jobs, activeProfile, turnBusy])

  // Keyboard: arrows nudge the picked bot, Enter opens its chat, P pets it.
  // Ignored while typing in a field.
  useEffect(() => {
    const onKey = event => {
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const bot = roster.find(row => row.name === selected)
      if (!bot || !roomRef.current) {
        return
      }

      const step = event.shiftKey ? 48 : 24
      const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }

      if (arrows[event.key]) {
        event.preventDefault()
        if (jobs[bot.name] || $game.get()) {
          return
        }
        const [dx, dy] = arrows[event.key]
        const from = currentPos(bot.name, roomRef.current)
        if (!from) {
          return
        }
        const box = roamBox(roomRef.current)
        const next = {
          x: Math.max(box.x0, Math.min(box.x1, from.x + dx)),
          y: Math.max(box.y0, Math.min(box.y1, from.y + dy))
        }
        clearRoam(bot.name)
        setWalk(bot.name, null)
        saveSeats({ ...$seats.get(), [bot.name]: next })
        patchFx(bot.name, { atBar: false, lingerUntil: 0, nap: false })
        dismissHint()
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        void openBot(bot)
        return
      }

      if (event.key === 'p' || event.key === 'P') {
        event.preventDefault()
        const at = Date.now()
        patchFx(bot.name, { petUntil: at + 900, stretchUntil: at + 700, closerUntil: at + 2600, nap: false, idleSince: 0 })
        dismissHint()
        tap()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [roster, selected, jobs])

  useEffect(() => () => stopMusicalChairs(), [])
  useEyeTracking(roomRef)

  const onFloor = event => {
    const mark = event.target?.classList
    if (!mark) {
      return
    }

    if (mark.contains('office-room') || mark.contains('office-grid') || mark.contains('office-work') || mark.contains('office-floor')) {
      $peekUntil.set(Date.now() + 900)
    }
  }

  const playHop = () => {
    const idle = idleBotNames(roster, jobs, activeProfile, turnBusy)
    const name = idle.includes(selected) ? selected : idle[0]
    if (!name) {
      return
    }

    startHopscotch(name, roomRef.current)
    tap()
  }

  return jsxs('div', {
    className: cn('office-root', night && 'is-night', `is-${backdrop}`),
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
            className: 'office-head-right',
            children: [
              roster.length
                ? jsx(FloorTools, {
                    roster,
                    jobs,
                    activeProfile,
                    turnBusy,
                    roomRef,
                    idleCount
                  })
                : null,
              weekLine(week)
                ? jsx('div', { className: 'office-recap', title: weekLine(week), children: weekLine(week) })
                : null,
              newsNames.length
                ? jsx('button', {
                    type: 'button',
                    className: 'office-news',
                    title: 'Open the chat',
                    onClick: () => {
                      scrollToDesk(roomRef.current, newsNames[0])
                      const bot = roster.find(row => row.name === newsNames[0])
                      if (bot) {
                        void openBot(bot)
                      }
                    },
                    children: headerNames(newsNames.map(nameOf), 'has news', 'have news')
                  })
                : null,
              jsxs('button', {
                type: 'button',
                className: cn('office-count', working.length && 'is-link'),
                title: working.length ? 'Scroll to the desk' : undefined,
                onClick: () => working.length && scrollToDesk(roomRef.current, working[0].name),
                children: [
                  jsx('span', { className: cn('office-pulse', working.length && 'is-live') }),
                  working.length ? headerNames(working.map(bot => nameOf(bot.name)), 'thinking', 'thinking') : roster.length ? 'All quiet' : 'No desks yet'
                ]
              })
            ]
          })
        ]
      }),
      jsx('div', { className: 'office-stage-wrap', children: jsxs('div', {
        className: cn('office-room', `is-${backdrop}`),
        ref: roomRef,
        onPointerDown: onFloor,
        children: [
          jsx('div', { className: 'office-wall', 'aria-hidden': true }),
          jsx('div', { className: cn('office-plant', working.length && 'is-lean'), 'aria-hidden': true }),
          jsx(Ambience, { backdrop, tally: Object.values(trophies).reduce((a, b) => a + b, 0), sky, roster, trophies }),
          hint === 'task' || hint === 'play' ? jsx(HintBubble, { roster, stage: hint, onClose: dismissHint }) : null,
          jsx(OfficeProps, {
            now,
            roomRef,
            onReplay: () => {
              const state = $ritual.get()
              if (ritualReplayable(state, Date.now()) && !roster.some(bot => ($fx.get()[bot.name]?.ritualUntil || 0) > Date.now())) {
                runRitual(roster, jobs, activeProfile, turnBusy)
              }
            }
          }),
          jsx(GameChairs, {}),
          jsx(Puffs, {}),
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
                      jsxs('div', {
                        className: 'office-floor',
                        children: [
                          jsx('div', {
                            className: 'office-work',
                            children: jsx('div', {
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
                            })
                          }),
                          jsx(Hopscotch, { onHop: playHop, now }),
                          jsx(OfficeBar, { count: roster.length, now })
                        ]
                      }),
                      jsx(Wanderers, {
                        roster,
                        isActiveName: activeProfile,
                        turnBusy,
                        jobs,
                        roomRef
                      })
                    ]
                  })
        ]
      }) }),
      roster.length ? jsx(TaskBar, { roster, activeProfile }) : null,
      jsx(Planes, {})
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
.office-root { --office-radius:10px; --office-pill:999px; --office-card-shadow: 0 0 0 1px color-mix(in srgb, CanvasText 16%, transparent), 0 1px 0 rgba(0,0,0,.08), 0 5px 12px rgba(0,0,0,.16); --office-chip-shadow: 0 0 0 1px color-mix(in srgb, CanvasText 18%, transparent), 0 1px 3px rgba(0,0,0,.22); position:relative; display:flex; flex-direction:column; height:100%; min-height:0; background:var(--ui-bg, transparent); color:var(--ui-text-secondary); }
.office-stage-wrap { flex:1; min-height:0; display:flex; flex-direction:column; justify-content:center; }
.office-recap { font-size:11px; color:var(--ui-text-tertiary); max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.office-news { height:24px; padding:0 10px; border:0; border-radius:var(--office-pill); background:color-mix(in srgb, var(--ui-accent) 16%, transparent); color:var(--ui-accent); font:inherit; font-size:11px; font-weight:600; cursor:pointer; white-space:nowrap; animation: office-hint .4s ease-out 1; }
.office-news:hover { background:color-mix(in srgb, var(--ui-accent) 26%, transparent); }
.office-count { border:0; background:transparent; font:inherit; padding:0; }
.office-count.is-link { cursor:pointer; }
.office-count.is-link:hover { color:var(--ui-text-primary, inherit); }
.office-memo { position:absolute; right:14px; top:44px; z-index:3; padding:0; border:0; background:transparent; cursor:pointer; filter: drop-shadow(0 1px 1px rgba(0,0,0,.35)); animation: office-memo .5s cubic-bezier(.2,.9,.3,1.3) 1; }
.office-memo:hover { transform: translateY(-2px) rotate(-4deg); }
.office-status.is-quiet { animation: office-quiet .5s ease 2.4s forwards; }
.office-person:hover .office-status.is-quiet, .office-person:focus-visible .office-status.is-quiet { animation:none; opacity:1; }
.office-person.is-lookup .office-eyes { transform: translate(var(--wdx, 0px), -2.6px); }
.office-hint.is-task { left:16px; top:auto; bottom:14px; }
.office-hint.is-task:before { left:22px; top:auto; bottom:-6px; box-shadow: 1px 1px 0 color-mix(in srgb, CanvasText 16%, transparent); }
.office-hint { position:absolute; left:206px; top:${WALL_H + 14}px; z-index:12; max-width:300px; display:flex; gap:8px; align-items:flex-start; padding:10px 10px 10px 12px; border-radius:var(--office-radius); background:Canvas; color:CanvasText; font-size:12px; line-height:1.4; box-shadow: var(--office-card-shadow); animation: office-hint .5s cubic-bezier(.2,.9,.3,1.2) 1; }
.office-hint b { font-weight:600; }
.office-hint:before { content:""; position:absolute; left:-6px; top:18px; width:12px; height:12px; background:Canvas; transform:rotate(45deg); box-shadow: -1px 1px 0 color-mix(in srgb, CanvasText 16%, transparent); }
.office-hint-close { flex-shrink:0; width:22px; height:22px; border:0; border-radius:99px; background:transparent; color:CanvasText; font:inherit; font-size:15px; line-height:1; cursor:pointer; opacity:.7; }
.office-hint-close:hover { opacity:1; background:color-mix(in srgb, CanvasText 10%, transparent); }
.office-sun, .office-moon { position:absolute; z-index:0; pointer-events:none; filter: drop-shadow(0 0 6px rgba(255,220,120,.6)); transition: left 60s linear, top 60s linear; }
.office-moon { filter: drop-shadow(0 0 5px rgba(244,240,216,.5)); }
.office-window { position:absolute; right:24%; top:12px; z-index:0; pointer-events:none; filter: drop-shadow(0 1px 2px rgba(0,0,0,.25)); }
.office-doodle { display:block; width:100%; height:100%; padding:2px; box-sizing:border-box; opacity:.8; }
.office-doodle-line { stroke-dasharray:60; stroke-dashoffset:60; animation: office-doodle 6s ease-in-out infinite; }
.office-face-bored { transform: translateY(5px) rotate(-7deg); }
.office-plane-layer { position:absolute; inset:0; pointer-events:none; z-index:40; overflow:hidden; }
.office-plane { position:absolute; margin:-8px 0 0 -12px; transform-origin:50% 50%; animation: office-plane .8s cubic-bezier(.3,.6,.4,1) forwards; filter: drop-shadow(0 2px 2px rgba(0,0,0,.25)); }
.office-confetti { position:absolute; left:50%; top:60px; width:0; height:0; z-index:9; pointer-events:none; }
.office-confetti i { position:absolute; left:-3px; top:-3px; width:6px; height:6px; border-radius:1px; background: hsl(calc(var(--i) * 51deg), 85%, 60%); animation: office-confetti .95s cubic-bezier(.2,.7,.4,1) forwards; --ang: calc(var(--i) * 51deg - 150deg); }
.office-stars { margin-left:6px; color:#d9a422; font-weight:600; }
.office-note { position:absolute; font-size:14px; color:CanvasText; text-shadow: 0 0 2px Canvas, 0 0 6px Canvas; animation: office-note 1.8s ease-in-out infinite; animation-delay: var(--d, 0s); opacity:0; }
.office-ding { position:absolute; top:22px; left:50%; transform:translateX(-50%); font-size:11px; font-weight:700; color:#c9302c; padding:1px 8px; border-radius:99px; animation: office-ding 1.4s ease-out forwards; z-index:4; }
.office-eom { position:absolute; left:24%; top:6px; z-index:1; display:grid; justify-items:center; gap:2px; transform-origin:50% 0; animation: office-eom-hang .9s cubic-bezier(.3,1.4,.4,1) 1; }
.office-eom-frame { width:44px; height:44px; box-sizing:border-box; padding:4px; border-radius:4px; background:linear-gradient(135deg, #f0d27a, #b8892c 45%, #f2d98a 55%, #a87a20); box-shadow: 0 2px 4px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.4); }
.office-eom-frame .office-face { width:36px; height:36px; background:#f7f2e4; border-radius:3px; }
.office-eom-plate { font-size:7px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#3a2a10; background:linear-gradient(180deg, #e8c86a, #c9a03a); padding:1px 5px; border-radius:2px; box-shadow: 0 1px 0 rgba(0,0,0,.3); white-space:nowrap; }
.office-eom-name { font-size:9px; font-weight:600; color:CanvasText; background:Canvas; padding:0 6px; border-radius:99px; box-shadow: var(--office-chip-shadow); max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.office-tally { position:absolute; top:14px; left:50%; transform:translateX(-50%); font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; padding:2px 8px; border-radius:99px; z-index:1; }
.office-butterfly { position:absolute; z-index:6; pointer-events:none; }
.office-butterfly.is-a { left:30%; top:40%; animation: office-fly-a 16s ease-in-out infinite; }
.office-butterfly.is-b { left:60%; top:55%; animation: office-fly-b 21s ease-in-out infinite; }
.office-wing { transform-box: fill-box; transform-origin: 100% 50%; animation: office-flap .28s ease-in-out infinite alternate; }
.office-wing.is-r { transform-origin: 0% 50%; animation-name: office-flap-r; }
.office-sweep { position:absolute; inset:0; z-index:2; pointer-events:none; mix-blend-mode:screen; background: radial-gradient(120px 90px at 20% 60%, rgba(255,79,176,.35), transparent 70%), radial-gradient(140px 100px at 70% 40%, rgba(72,224,255,.3), transparent 70%); animation: office-sweep 9s ease-in-out infinite alternate; }
.office-oven { position:absolute; right:22px; top:34px; z-index:1; }
.office-oven-fire { transform-box: fill-box; transform-origin: 50% 100%; animation: office-fire .5s ease-in-out infinite alternate; filter: drop-shadow(0 0 4px #ff8a2a); }
.office-cooler { position:absolute; left:46px; top:42px; z-index:1; }
.office-bubble { animation: office-bubble 2.4s ease-in infinite; }
.office-bubble.is-2 { animation-delay: 1.1s; animation-duration: 3s; }
.office-pendant { position:absolute; left:38%; top:0; margin-left:-15px; z-index:1; transform-origin:50% 0; animation: office-sway 4.5s ease-in-out infinite; }
.office-header { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; padding:16px 18px 10px; }
.office-kicker { font-size:10px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--ui-text-quaternary); }
.office-title { margin:2px 0 0; font-size:20px; font-weight:600; color:var(--ui-text-primary, inherit); }
.office-head-right { display:flex; align-items:center; gap:14px; }
.office-tools { display:flex; align-items:center; gap:6px; }
.office-tool { height:24px; padding:0 8px; border:1px solid var(--ui-stroke-secondary); border-radius:999px; background:transparent; color:var(--ui-text-tertiary); font:inherit; font-size:11px; cursor:pointer; }
.office-tool:hover { color:var(--ui-text-primary, inherit); }
.office-tool.is-on { border-color:var(--ui-accent); color:var(--ui-accent); }
.office-tool:disabled { opacity:.4; cursor:default; }
.office-count { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--ui-text-tertiary); }
.office-pulse { width:8px; height:8px; border-radius:99px; background:var(--ui-text-quaternary); }
.office-pulse.is-live { background:var(--ui-accent); box-shadow:0 0 0 4px color-mix(in srgb, var(--ui-accent) 22%, transparent); }
.office-taskbar { display:flex; align-items:center; gap:8px; flex-shrink:0; padding:10px 16px 14px; }
.office-task-who { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--ui-text-tertiary); white-space:nowrap; }
.office-pick { position:relative; }
.office-pick-btn { max-width:160px; overflow:hidden; text-overflow:ellipsis; border:0; background:transparent; color:var(--ui-text-primary, inherit); font:inherit; cursor:pointer; padding:0 2px; }
.office-pick-btn:after { content:" ▾"; color:var(--ui-text-tertiary); }
.office-pick-menu { position:absolute; left:0; bottom:calc(100% + 6px); min-width:148px; max-height:220px; overflow:auto; z-index:30; padding:4px; border-radius:var(--office-radius); border:0; background:Canvas; color:CanvasText; box-shadow: var(--office-card-shadow), 0 10px 28px color-mix(in srgb, #000 22%, transparent); }
.office-pick-item { display:block; width:100%; text-align:left; border:0; background:transparent; color:inherit; font:inherit; font-size:12px; padding:6px 8px; border-radius:6px; cursor:pointer; }
.office-pick-item:hover, .office-pick-item.is-on { background:color-mix(in srgb, var(--ui-accent) 18%, Canvas); color:inherit; }
.office-task-input { flex:1; min-width:0; height:32px; padding:0 10px; border:1px solid var(--ui-stroke-secondary); border-radius:var(--office-radius); background:color-mix(in srgb, var(--ui-bg) 86%, transparent); color:inherit; font:inherit; }
.office-task-input:focus { outline:1px solid var(--ui-accent); }
.office-task-input:disabled { opacity:.7; }
.office-task-send { height:32px; padding:0 12px; border:0; border-radius:var(--office-radius); background:var(--ui-accent); color:var(--ui-accent-fg, #fff); font-size:12px; cursor:pointer; }
.office-task-send:disabled { opacity:.45; cursor:default; }
.office-desk.is-picked .office-plate { outline:1px dashed var(--ui-accent); outline-offset:1px; }
.office-room { position:relative; flex:1 1 auto; max-height:min(100%, 780px); min-height:0; margin:0 12px; overflow:auto; border:1px solid var(--ui-stroke-secondary); border-radius:12px; background:#557b8c; }
.office-wall { position:absolute; inset:0 0 auto 0; height:${WALL_H}px; pointer-events:none; }
.office-wall:after { content:""; position:absolute; left:0; right:0; top:100%; height:12px; background:linear-gradient(180deg, rgba(0,0,0,.34), rgba(0,0,0,0)); }
${Object.entries(OFFICE_SKINS).map(([name, skin]) => skinCss(name, skin)).join('\n')}
.office-plant { position:absolute; top:56px; left:18px; width:18px; height:28px; border-radius:40% 40% 20% 20%; background:#3f9f5f; box-shadow: inset -3px -2px 0 rgba(0,0,0,.18); pointer-events:none; transform-origin:50% 100%; transition:transform .6s ease; z-index:1; }
.office-plant.is-lean { transform: rotate(16deg); }
.office-plant:after { content:""; position:absolute; left:5px; bottom:-9px; width:8px; height:12px; border-radius:1px 1px 3px 3px; background:#8b5a3a; box-shadow: inset 0 1px 0 #b0805a; }
.office-room.is-nightclub .office-plant { background:#2f7f6f; }
.office-clock { position:absolute; top:12px; left:50px; display:grid; justify-items:center; gap:3px; border:0; padding:0; background:transparent; color:inherit; cursor:grab; touch-action:none; z-index:5; }
.office-clock.is-digital { top:16px; }
.office-clock.is-free { top:auto; }
.office-clock:active { cursor:grabbing; }
.office-clock-lcd { min-width:52px; padding:4px 7px 3px; border-radius:4px; background:#142016; color:#9dffb0; font-size:12px; font-variant-numeric:tabular-nums; letter-spacing:.06em; box-shadow: inset 0 0 0 1px #2a3a2c, 0 1px 0 color-mix(in srgb, #000 25%, transparent); }
.office-clock-face { position:relative; width:36px; height:36px; border-radius:99px; background:
  repeating-conic-gradient(from -1deg, color-mix(in srgb, CanvasText 70%, transparent) 0 2deg, transparent 2deg 30deg),
  Canvas;
  box-shadow: inset 0 0 0 2px color-mix(in srgb, CanvasText 30%, transparent), 0 1px 3px rgba(0,0,0,.3); }
.office-clock-hour, .office-clock-min { position:absolute; left:50%; bottom:50%; width:2px; background:CanvasText; transform-origin:50% 100%; border-radius:2px; }
.office-clock-hour { height:10px; margin-left:-1px; }
.office-clock-min { height:13px; width:1.5px; margin-left:-0.75px; opacity:.85; }
.office-clock-pin { position:absolute; left:50%; top:50%; width:4px; height:4px; margin:-2px 0 0 -2px; border-radius:99px; background:CanvasText; }
.office-clock-digits { font-size:10px; font-variant-numeric:tabular-nums; color:CanvasText; background:Canvas; padding:0 5px; border-radius:99px; box-shadow: 0 0 0 1px color-mix(in srgb, CanvasText 18%, transparent); }

.office-floor { position:relative; z-index:1; display:flex; align-items:stretch; box-sizing:border-box; min-width:560px; min-height:${WALL_H + 380}px; padding:${WALL_H + 10}px 0 16px; }
.office-work { flex:1 1 56%; min-width:0; }
.office-grid { position:relative; display:grid; grid-template-columns:repeat(auto-fill, minmax(168px, 1fr)); gap:18px; padding:8px 14px 20px; min-height:0; }
.office-aisle { flex:0 0 84px; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; gap:4px; padding:10px 6px 16px; z-index:2; }
.office-chip, .office-hop-label, .office-bar-sign, .office-status, .office-home { background:Canvas; color:CanvasText; box-shadow: var(--office-chip-shadow); }
.office-hop-label { font-size:9px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; padding:1px 6px; border-radius:99px; margin-bottom:4px; }
.office-hop-row { display:flex; gap:4px; }
.office-hop { width:30px; height:28px; padding:0; border:2px solid #f6f2e6; border-radius:5px; background:color-mix(in srgb, Canvas 90%, transparent); color:CanvasText; font:inherit; font-size:11px; font-weight:700; cursor:pointer; box-shadow: 0 0 0 1px rgba(0,0,0,.32), 0 1px 3px rgba(0,0,0,.2); }
.office-hop:hover { border-color:var(--ui-accent); color:var(--ui-accent); }
.office-hop.is-lit { background:color-mix(in srgb, var(--ui-accent) 40%, Canvas); border-color:var(--ui-accent); color:CanvasText; box-shadow: 0 0 0 1px rgba(0,0,0,.32), 0 0 10px color-mix(in srgb, var(--ui-accent) 55%, transparent); transition:background .12s ease, box-shadow .12s ease; }
.office-room.is-nightclub .office-hop { border-color:#f7a8dc; box-shadow: 0 0 0 1px rgba(0,0,0,.4), 0 0 8px rgba(255,79,176,.45); }
.office-bar { flex:0 0 148px; display:flex; flex-direction:column; align-items:center; padding:6px 10px 18px; z-index:2; }
.office-bar-sign { font-size:11px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; padding:2px 9px; border-radius:99px; margin-bottom:8px; }
.office-room.is-nightclub .office-bar-sign { color:#f6c; text-shadow:0 0 8px #f4a; }
.office-bar-shelf { position:relative; width:100%; height:14px; margin-top:20px; border-radius:3px 3px 0 0; background:linear-gradient(180deg, #6a4a32, #3d2a1c); box-shadow: inset 0 1px 0 #a07a55, 0 -22px 0 -1px rgba(20,28,40,.35); }
.office-bar-shelf:before, .office-bar-shelf:after { content:none; position:absolute; bottom:3px; width:5px; height:9px; border-radius:1px 1px 0 0; background:#7ec8e8; }
.office-bar-shelf:before { left:18%; background:#e86; }
.office-bar-shelf:after { left:32%; }
.office-bar-bottles { position:absolute; left:6px; right:6px; bottom:5px; height:30px; filter:drop-shadow(0 1px 1px rgba(0,0,0,.35)); }
.office-bar-counter { display:flex; justify-content:flex-end; padding-right:10px; box-sizing:border-box; width:100%; height:28px; border-radius:0 0 6px 6px; background:linear-gradient(180deg, #a3734a 0 3px, #8d623e 3px, #5a3d22); box-shadow:0 6px 0 #3d2816, 0 9px 0 #c9a24a, 0 14px 10px -2px rgba(0,0,0,.35); margin-bottom:16px; }
.office-bar-taps { position:relative; margin-top:-18px; z-index:3; filter:drop-shadow(0 2px 2px rgba(0,0,0,.3)); }
.office-room.is-nightclub .office-bar-counter { background:linear-gradient(180deg, #3a2448 0 3px, #2a1838 3px, #140816); box-shadow:0 6px 0 #0a0610, 0 9px 0 #48e0ff, 0 14px 10px -2px rgba(0,0,0,.45), 0 0 12px color-mix(in srgb, #f4a 35%, transparent); }
.office-room.is-nightclub .office-bar-shelf { background:linear-gradient(180deg, #2a1838, #140816); box-shadow: inset 0 1px 0 #f4a, 0 -22px 0 -1px rgba(255,79,176,.12); }
.office-bar-stools { display:flex; flex-wrap:wrap; justify-content:center; gap:10px 12px; width:100%; padding:10px 6px 12px; border-radius:12px; background:rgba(0,0,0,.16); box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); }
.office-room.is-nightclub .office-bar-stools { background:rgba(255,79,176,.10); box-shadow: inset 0 0 0 1px rgba(255,79,176,.25); }
.office-bar-stool { width:22px; height:18px; border-radius:6px 6px 3px 3px; background:linear-gradient(180deg, #a83a34 0 45%, #3a2a22 45%); box-shadow:0 3px 0 #241812, inset 0 1px 0 #d4665f, 0 6px 5px -1px rgba(0,0,0,.4); }
.office-room.is-nightclub .office-bar-stool { background:#2a1830; box-shadow:0 3px 0 #120814, inset 0 1px 0 #f4a, 0 6px 5px -1px rgba(0,0,0,.5); }
.office-room.is-pizza .office-bar-sign { color:#fff; background:#c9302c; letter-spacing:.2em; box-shadow:0 1px 0 rgba(0,0,0,.25); }
.office-room.is-pizza .office-bar-shelf { background:linear-gradient(180deg, #e9dcc6, #cdbb9d); box-shadow: inset 0 1px 0 #fff8ea; }
.office-room.is-pizza .office-bar-shelf:before { content:""; background:#c9302c; width:12px; height:8px; left:14%; }
.office-room.is-pizza .office-bar-shelf:after { content:""; background:#c9302c; width:12px; height:8px; left:30%; }
.office-room.is-pizza .office-bar-counter { justify-content:center; padding-right:0; background:linear-gradient(180deg, #ececec 0 50%, #c9302c 50% 62.5%, #ececec 62.5% 75%, #c9302c 75% 87.5%, #ececec 87.5%); box-shadow:0 6px 0 #a3a3a3, 0 12px 10px -2px rgba(0,0,0,.35); }
.office-room.is-pizza .office-bar-stools { background:rgba(120,40,30,.14); }
.office-room.is-pizza .office-bar-stool { background:#c9302c; box-shadow:0 3px 0 #8f1f1c, inset 0 1px 0 #ea6c66, 0 6px 5px -1px rgba(0,0,0,.4); }
.office-pie { position:relative; margin-top:-16px; z-index:3; filter:drop-shadow(0 2px 2px rgba(0,0,0,.35)); }
.office-slice { position:absolute; top:-2px; left:-12px; z-index:2; transform:rotate(-20deg); filter:drop-shadow(0 1px 1px rgba(0,0,0,.35)); animation:office-slice .6s ease-in-out infinite; }
.office-status.is-sad { color:#c9302c; }
.office-person.has-pizza .office-face { animation: office-chew .55s ease-in-out infinite; }
.office-whisper.is-hi { color:var(--ui-accent); font-weight:600; animation: office-hi .3s ease-out 1; }
@keyframes office-hi { 0% { transform: translateY(4px) scale(.7); opacity:0; } 100% { transform: none; opacity:1; } }
@keyframes office-slice { 0%,100% { transform:rotate(-20deg) translateY(0); } 50% { transform:rotate(-8deg) translateY(-2px); } }
.office-game-layer { position:absolute; inset:0; pointer-events:none; z-index:4; }
.office-game-chair { position:absolute; display:block; filter:drop-shadow(0 2px 2px rgba(0,0,0,.35)); }
.office-game-chair.is-claimed { filter:drop-shadow(0 2px 2px rgba(0,0,0,.35)) drop-shadow(0 0 4px var(--ui-accent)); }
.office-empty { min-height:${WALL_H + 200}px; padding:120px 20px 40px; text-align:center; color:var(--ui-text-tertiary); font-size:13px; }
.office-desk { position:relative; display:flex; flex-direction:column; align-items:center; gap:8px; padding:8px 10px 10px; border:0; border-radius:16px; background:rgba(0,0,0,.09); box-shadow: inset 0 0 0 1px rgba(255,255,255,.10); color:inherit; text-align:center; user-select:none; -webkit-user-drag:none; }
.office-room.is-nightclub .office-desk { background:rgba(255,255,255,.07); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
.office-stage { position:relative; width:100%; min-height:118px; display:flex; flex-direction:column; align-items:center; }
.office-stage:before { content:""; position:absolute; left:14px; right:14px; top:84px; height:34px; border-radius:50%; background:radial-gradient(ellipse at 50% 50%, rgba(0,0,0,.30), rgba(0,0,0,0) 68%); pointer-events:none; }
.office-desk-top { position:absolute; left:8px; right:8px; top:48px; height:34px; border-radius:6px; background:#8d623e; box-shadow:0 7px 0 #5a3d22, 0 8px 0 color-mix(in srgb, #000 20%, transparent), 0 14px 10px -2px rgba(0,0,0,.35); outline:1px solid color-mix(in srgb, #000 22%, transparent); z-index:1; pointer-events:none; }
.office-lamp { position:absolute; top:24px; right:10px; width:18px; height:30px; display:flex; flex-direction:column; align-items:center; z-index:2; pointer-events:none; }
.office-lamp-shade { width:16px; height:9px; background:linear-gradient(180deg, #b56a24, #e29a3a); clip-path:polygon(18% 0, 82% 0, 100% 100%, 0 100%); border-radius:1px; box-shadow:0 5px 10px 2px color-mix(in srgb, #ffb14a 50%, transparent); position:relative; }
.office-lamp-shade:after { content:""; position:absolute; left:2px; right:2px; bottom:-1px; height:3px; background:#ffe7b0; opacity:.8; filter:blur(1px); }
.office-lamp-stem { width:2px; height:14px; margin-top:-1px; background:linear-gradient(180deg, #6a5644, #3d3228); }
.office-lamp-base { width:9px; height:3px; margin-top:-1px; border-radius:2px 2px 1px 1px; background:#4a3b2e; box-shadow:0 1px 0 #2a2118; }
.office-monitor { position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; width:62px; margin-top:2px; pointer-events:none; }
.office-monitor-head { position:relative; width:58px; height:40px; padding:5px 5px 8px; border-radius:5px 5px 3px 3px; background:linear-gradient(180deg, #55575d, #2c2e33); box-shadow: inset 0 1px 0 #7a7c82, 0 1px 0 #1a1b1e, 0 2px 4px color-mix(in srgb, #000 28%, transparent); }
.office-screen { width:100%; height:100%; border-radius:2px; background:#121316; box-shadow: inset 0 0 0 1px #0a0a0c; overflow:hidden; }
.office-screen.is-on { background:linear-gradient(180deg, color-mix(in srgb, var(--ui-accent) 70%, #1a1a22), #121316); animation:office-glow 1.1s ease-in-out infinite; }
.office-screen-copy { height:100%; overflow:hidden; padding:2px 3px 1px; font-size:5.5px; line-height:1.25; letter-spacing:0; color:#c9d4c4; text-align:left; word-break:break-word; }
.office-screen.is-on .office-screen-copy { color:#eef2ff; }
.office-monitor-cam { position:absolute; left:50%; bottom:2.5px; width:3px; height:3px; margin-left:-1.5px; border-radius:99px; background:#141416; box-shadow:0 0 0 1px #4a4c52; }
.office-monitor-neck { width:7px; height:7px; background:linear-gradient(180deg, #3e4046, #2a2c30); }
.office-monitor-base { width:24px; height:4px; border-radius:3px 3px 1px 1px; background:linear-gradient(180deg, #45474d, #2a2c30); box-shadow:0 1px 1px color-mix(in srgb, #000 30%, transparent); }
.office-seat { position:relative; width:42px; height:46px; margin-top:-8px; z-index:3; }
.office-desk-chair { position:absolute; left:0; top:0; display:block; transform-origin:50% 90%; filter:drop-shadow(0 2px 2px rgba(0,0,0,.3)); }
.office-desk-chair.is-wobble { animation:office-wobble .5s ease-in-out 2; }
.office-stage .office-person { position:absolute; left:0; top:-2px; margin:0; z-index:3; width:42px; }
.office-stage .office-person .office-status { position:absolute; top:100%; left:50%; transform:translateX(-50%); margin-top:2px; }
.office-stage .office-person .office-hearts { left:50%; transform:translateX(-50%); }
.office-person { position:relative; z-index:3; margin-top:4px; display:grid; justify-items:center; gap:4px; cursor:grab; touch-action:none; outline:none; }
.office-person.is-held { cursor:grabbing; z-index:30; }
.office-person.is-wander { position:absolute; margin:0; z-index:8; width:42px; will-change:left, top, transform; transform-origin:50% 100%; }
.office-person.is-wander .office-status { position:absolute; top:100%; left:50%; transform:translateX(-50%); margin-top:2px; }
.office-person.is-wander .office-hearts { left:50%; transform:translateX(-50%); }
.office-person.is-closer { transform: scale(1.12) translateY(4px); }
.office-eyes { transform: translate(calc(var(--edx, 0px) + var(--wdx, 0px)), var(--edy, 0px)); transition: transform .12s ease-out; }
.office-gaze { animation: office-gaze 10s ease-in-out infinite; }
.office-blink { transform-box: fill-box; transform-origin: center; animation: office-blink 4s ease-in-out infinite; }
.office-blink.is-double { animation-name: office-blink-double; }
.office-eye { transform-box: fill-box; transform-origin: center; }
.office-pupil, .office-lid { transition: cx .3s ease, cy .3s ease, rx .3s ease, ry .3s ease, opacity .3s ease; }
.office-face-think .office-eyes { animation: office-eyes-turn 0.9s ease-in-out infinite; }
.office-face-think .office-eye-l { animation: office-eye-far 0.9s ease-in-out infinite; }
.office-face-think .office-eye-r { animation: office-eye-near 0.9s ease-in-out infinite; }
.office-stage .office-person { animation: office-breathe 3.4s ease-in-out infinite; }
.office-stage .office-person.is-sleep { animation-duration: 5.6s; }
.office-stage .office-person.is-closer, .office-stage .office-person.is-held { animation: none; }
.office-ground { position:absolute; left:50%; bottom:-3px; width:30px; height:9px; margin-left:-15px; border-radius:50%; background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,.36), rgba(0,0,0,0) 70%); transform: scale(calc(1 - var(--lift, 0) * .5)); opacity: calc(1 - var(--lift, 0) * .55); z-index:-1; pointer-events:none; }
.office-person.is-drop .office-face { animation: office-drop .46s cubic-bezier(.2,.9,.3,1.2) 1; }
.office-puff-layer { position:absolute; inset:0; pointer-events:none; z-index:7; }
.office-puff { position:absolute; width:22px; height:10px; margin:-5px 0 0 -11px; border-radius:50%; border:2px solid rgba(255,255,255,.75); box-shadow: 0 0 0 1px rgba(0,0,0,.18), inset 0 0 0 1px rgba(0,0,0,.12); animation: office-puff .5s ease-out forwards; }
.office-puff:before, .office-puff:after { content:""; position:absolute; top:-2px; width:4px; height:4px; border-radius:99px; background:rgba(255,255,255,.85); box-shadow: 0 0 0 1px rgba(0,0,0,.18); animation: office-puff-dot .5s ease-out forwards; }
.office-puff:before { left:-4px; --dx:-8px; }
.office-puff:after { right:-4px; --dx:8px; }
.office-screen.is-boot { animation: office-boot .7s ease-out 1; }
.office-face { display:block; transform-origin:50% 80%; pointer-events:none; -webkit-user-drag:none; filter: drop-shadow(0 0 0.6px #fff) drop-shadow(0 0 0.8px #1a1a1a) drop-shadow(0 2px 3px rgba(0,0,0,.3)); }
.office-face-think { animation:office-think 0.9s ease-in-out infinite; }
.office-face-shy { animation:office-shy 0.16s ease-in-out infinite; }
.office-face-held { transform: rotate(16deg) scale(1.14); filter: drop-shadow(0 0 0.6px #fff) drop-shadow(0 0 0.8px #1a1a1a) drop-shadow(0 10px 8px color-mix(in srgb, #000 35%, transparent)); }
.office-face-sleep { transform: rotate(-18deg); }
.office-face-pet { animation:office-pet 0.45s ease-in-out infinite; }
.office-face-clap { animation:office-pet 0.28s ease-in-out infinite; }
.office-face-stretch { transform: scaleX(1.18) scaleY(0.9); }
.office-face-peek { transform: translateY(-6px); }
.office-status { font-size:10px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--ui-accent); padding:1px 7px; border-radius:99px; white-space:nowrap; }
.office-status.is-idle { color:color-mix(in srgb, CanvasText 62%, transparent); }
.office-person.is-shy .office-status, .office-person.is-held .office-status { color:#f09; }
.office-whisper { position:absolute; top:-14px; right:-6px; font-size:12px; color:CanvasText; background:Canvas; border-radius:8px; padding:0 5px; box-shadow: 0 0 0 1px color-mix(in srgb, CanvasText 18%, transparent); }
.office-plate { position:relative; z-index:2; width:100%; padding:6px 8px 7px; border:0; border-radius:var(--office-radius); background:Canvas; color:CanvasText; text-align:center; cursor:pointer; box-shadow: var(--office-card-shadow); }
.office-plate:hover { box-shadow: 0 0 0 1px var(--ui-accent), 0 1px 0 rgba(0,0,0,.08), 0 5px 12px rgba(0,0,0,.16); }
.office-name { font-size:13px; font-weight:600; color:CanvasText; }
.office-handle { font-size:11px; color:color-mix(in srgb, CanvasText 60%, transparent); }
.office-say { position:relative; z-index:2; width:100%; margin-top:2px; padding:8px 10px 9px; border:0; border-radius:var(--office-radius); background:Canvas; color:CanvasText; font:inherit; font-size:12px; line-height:1.35; text-align:left; cursor:pointer; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; box-shadow: var(--office-card-shadow); }
.office-say:before { content:""; position:absolute; left:50%; top:-5px; width:9px; height:9px; margin-left:-4.5px; background:Canvas; border-left:1px solid var(--ui-stroke-secondary); border-top:1px solid var(--ui-stroke-secondary); transform:rotate(45deg); }
.office-say:hover { outline-color:var(--ui-accent); }
.office-home { margin-top:2px; border:0; padding:2px 9px; border-radius:99px; color:color-mix(in srgb, CanvasText 72%, transparent); font:inherit; font-size:10px; cursor:pointer; }
.office-home:hover { color:var(--ui-accent); }
.office-desk.is-active .office-plate { box-shadow: 0 0 0 1.5px var(--ui-accent), 0 1px 0 rgba(0,0,0,.08), 0 5px 12px rgba(0,0,0,.16); }
.office-desk.is-think .office-desk-top { box-shadow:0 7px 0 #5a3d22, 0 8px 0 color-mix(in srgb, var(--ui-accent) 35%, transparent); }
.office-hearts { position:absolute; top:-10px; left:50%; display:flex; gap:4px; pointer-events:none; }
.office-hearts span { color:#f48; font-size:11px; animation:office-heart 0.9s ease-out forwards; }
.office-hearts span:nth-child(2) { animation-delay:.08s; }
.office-hearts span:nth-child(3) { animation-delay:.16s; }
.office-wander-layer { position:absolute; inset:0; pointer-events:none; z-index:8; }
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
@keyframes office-plane { 0% { transform: translate(0, 0) rotate(var(--rot)) scale(.8); opacity:0; } 12% { opacity:1; } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(.6); opacity:0; } }
@keyframes office-confetti { 0% { transform: translate(0, 0) rotate(0); opacity:1; } 60% { opacity:1; } 100% { transform: translate(calc(cos(var(--ang)) * 34px), calc(sin(var(--ang)) * 26px + 30px)) rotate(240deg); opacity:0; } }
@keyframes office-note { 0% { transform: translateY(6px) rotate(-8deg); opacity:0; } 25% { opacity:1; } 100% { transform: translateY(-26px) rotate(10deg); opacity:0; } }
@keyframes office-ding { 0% { transform: translate(-50%, 8px) scale(.6); opacity:0; } 20% { transform: translate(-50%, 0) scale(1.1); opacity:1; } 70% { opacity:1; } 100% { transform: translate(-50%, -6px); opacity:0; } }
@keyframes office-fly-a { 0% { transform: translate(0, 0); } 25% { transform: translate(120px, -30px); } 50% { transform: translate(60px, 60px); } 75% { transform: translate(-80px, 20px); } 100% { transform: translate(0, 0); } }
@keyframes office-fly-b { 0% { transform: translate(0, 0); } 30% { transform: translate(-90px, 40px); } 60% { transform: translate(40px, 80px); } 100% { transform: translate(0, 0); } }
@keyframes office-flap { from { transform: scaleX(1); } to { transform: scaleX(.35); } }
@keyframes office-flap-r { from { transform: scaleX(1); } to { transform: scaleX(.35); } }
@keyframes office-sweep { 0% { transform: translateX(-12%); } 100% { transform: translateX(12%); } }
@keyframes office-fire { from { transform: scaleY(.85) scaleX(.96); } to { transform: scaleY(1.08) scaleX(1.02); } }
@keyframes office-bubble { 0% { transform: translateY(0); opacity:.9; } 100% { transform: translateY(-11px); opacity:0; } }
@keyframes office-sway { 0%,100% { transform: rotate(-2.5deg); } 50% { transform: rotate(2.5deg); } }
@keyframes office-chew { 0%,100% { transform: scaleX(1) rotate(0); } 50% { transform: scaleX(1.06) rotate(-3deg); } }
@keyframes office-eom-hang { 0% { transform: rotate(-9deg) translateY(-6px); opacity:0; } 60% { transform: rotate(4deg); opacity:1; } 100% { transform: none; } }
@keyframes office-memo { 0% { transform: translateY(-10px) rotate(-12deg); opacity:0; } 100% { transform: none; opacity:1; } }
@keyframes office-quiet { to { opacity:0; } }
@keyframes office-hint { 0% { transform: translateY(8px) scale(.96); opacity:0; } 100% { transform: none; opacity:1; } }
@keyframes office-doodle { 0% { stroke-dashoffset:60; } 50% { stroke-dashoffset:0; } 100% { stroke-dashoffset:0; } }
@keyframes office-blink { 0%, 93%, 100% { transform: scaleY(1); } 95.5%, 96.5% { transform: scaleY(.08); } }
@keyframes office-blink-double { 0%, 88%, 92.5%, 100% { transform: scaleY(1); } 89.5%, 90.5% { transform: scaleY(.08); } 94%, 95% { transform: scaleY(.08); } 96.5% { transform: scaleY(1); } }
@keyframes office-gaze { 0%, 100% { transform: translate(0, 0); } 18% { transform: translate(.5px, -.2px); } 34% { transform: translate(-.4px, .2px); } 46% { transform: translate(-.4px, .2px); } 50% { transform: translate(2.2px, -.4px); } 58% { transform: translate(2.2px, -.4px); } 63% { transform: translate(0, 0); } 82% { transform: translate(-.6px, .3px); } }
@keyframes office-eyes-turn { 0%, 100% { transform: translate(calc(var(--edx, 0px) + var(--wdx, 0px) - 1.6px), var(--edy, 0px)); } 50% { transform: translate(calc(var(--edx, 0px) + var(--wdx, 0px) + 1.6px), calc(var(--edy, 0px) - .6px)); } }
@keyframes office-eye-far { 0%, 100% { transform: scaleX(.78); } 50% { transform: scaleX(1); } }
@keyframes office-eye-near { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(.78); } }
@keyframes office-breathe { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1.2px); } }
@keyframes office-drop { 0% { transform: scale(1.22, .78); } 40% { transform: scale(.92, 1.08); } 70% { transform: scale(1.04, .97); } 100% { transform: scale(1, 1); } }
@keyframes office-puff { 0% { transform: scale(.4); opacity:.9; } 100% { transform: scale(1.5); opacity:0; } }
@keyframes office-puff-dot { 0% { transform: translate(0, 0); opacity:1; } 100% { transform: translate(var(--dx), -10px); opacity:0; } }
@keyframes office-boot { 0% { filter: brightness(3) contrast(1.4); } 30% { filter: brightness(.6); } 60% { filter: brightness(2); } 100% { filter: brightness(1); } }
@media (prefers-reduced-motion: reduce) {
  .office-stage .office-person, .office-blink, .office-gaze, .office-face-think .office-eyes, .office-face-think .office-eye-l, .office-face-think .office-eye-r, .office-face-think, .office-face-pet, .office-face-clap, .office-face-shy, .office-screen.is-on, .office-slice, .office-plant, .office-desk-chair.is-wobble, .office-person.is-drop .office-face, .office-butterfly, .office-wing, .office-sweep, .office-oven-fire, .office-bubble, .office-pendant, .office-person.has-pizza .office-face, .office-note, .office-doodle-line, .office-hint, .office-news { animation: none !important; }
  .office-status.is-quiet { animation: none; opacity:.35; }
  .office-eom { animation: none; }
  .office-eyes { transition: none; }
  .office-pupil, .office-lid { transition: none; }
}
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
      Promise.resolve(ctx.storage?.get?.('lastTask'))
        .then(value => {
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            $lastTask.set(value)
          }
        })
        .catch(() => undefined)
      Promise.resolve(ctx.storage?.get?.('month'))
        .then(value => {
          if (value && typeof value === 'object' && typeof value.start === 'number') {
            $month.set(value)
          }
        })
        .catch(() => undefined)
      Promise.resolve(ctx.storage?.get?.('week'))
        .then(value => {
          if (value && typeof value === 'object' && typeof value.start === 'number') {
            $week.set(value)
          }
        })
        .catch(() => undefined)
      Promise.resolve(ctx.storage?.get?.('hintStage'))
        .then(value => {
          $hint.set(value === 'wait' || value === 'play' || value === 'done' ? value : 'task')
        })
        .catch(() => $hint.set('task'))
      Promise.resolve(ctx.storage?.get?.('news'))
        .then(value => {
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            $news.set(value)
          }
        })
        .catch(() => undefined)
      Promise.resolve(ctx.storage?.get?.('ritualHour'))
        .then(value => {
          if (typeof value === 'number') {
            $ritual.set({ hour: value, at: 0 })
          }
        })
        .catch(() => undefined)
      Promise.resolve(ctx.storage?.get?.('trophies'))
        .then(value => {
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            $trophies.set(value)
          }
        })
        .catch(() => undefined)
      Promise.resolve(ctx.storage?.get?.('backdrop'))
        .then(value => {
          if (backdropNames().includes(value)) {
            $backdrop.set(value)
          }
        })
        .catch(() => undefined)
    } catch {
      /* no storage */
    }

    try {
      ctx.onDispose?.(() => {
        for (const name of [...jobPollers.keys()]) {
          clearJob(name)
        }
        stopMusicalChairs()
      })
    } catch {
      /* older shell */
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
        keywords: ['bots', 'desk', 'floor', 'office', 'bar', 'hopscotch'],
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
  resolvePicked,
  roamMs,
  easeInOut,
  backdropNames,
  nextBackdrop,
  idleBotNames,
  chairCountForGame,
  pickFreeStool,
  nextBarStand,
  placeChairs,
  assignChairs,
  beginWalk,
  advanceWalk,
  walkHop
}
