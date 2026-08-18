import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

function loadHelpers() {
  const start = source.indexOf('function displayName')
  const end = source.indexOf('function botHandle')
  const moodStart = source.indexOf('function deskMood')
  const moodEnd = source.indexOf('function previewLine')
  const previewEnd = source.indexOf('function pointInRoom')

  assert.ok(start >= 0 && end > start)
  assert.ok(moodStart >= 0 && moodEnd > moodStart)
  assert.ok(previewEnd > moodEnd)

  const context = {}
  vm.runInNewContext(
    `${source.slice(start, end)}\nconst DRAG_PX = 8;\nconst BOT_CHAT_TITLE = 'Bot Chat';\n${source.slice(moodStart, previewEnd)}\nglobalThis.__h = { displayName, deskMood, previewLine, faceMood, movedEnough, near, isNightHour, stickyText, clockLabel, clockHands, nextClockKind, pickBotChatRow, roamMs, easeInOut, resolvePicked, backdropNames, nextBackdrop, idleBotNames, chairCountForGame, pickFreeStool, nextBarStand, placeChairs, assignChairs, beginWalk, advanceWalk, walkHop, freshPizza, claimPizza, gameRing, ringPoint, hopCourse, hopSquash, walkEase, nameHash, typedText };`,
    context
  )

  return context.__h
}

test('deskMood is think only for the focused live turn', () => {
  const { deskMood } = loadHelpers()

  assert.equal(deskMood({ isActive: true, turnBusy: true }), 'think')
  assert.equal(deskMood({ isActive: true, turnBusy: false }), 'idle')
  assert.equal(deskMood({ isActive: false, turnBusy: true }), 'idle')
  assert.equal(deskMood({ isActive: false, turnBusy: false, tasked: true }), 'think')
})

test('pickBotChatRow keeps the pinned Bot Chat when it still exists', () => {
  const { pickBotChatRow } = loadHelpers()
  const rows = [
    { id: 'scratch', title: 'Notes' },
    { id: 'forever', title: 'Bot Chat' }
  ]

  assert.equal(pickBotChatRow(rows, 'forever'), 'forever')
  assert.equal(pickBotChatRow(rows, 'gone'), 'forever')
  assert.equal(pickBotChatRow([{ id: 'only', title: 'Other' }], null), null)
  assert.equal(pickBotChatRow([], 'gone'), null)
})

test('resolvePicked matches the task bar to the outlined desk', () => {
  const { resolvePicked } = loadHelpers()
  const roster = [{ name: 'default' }, { name: 'scout' }]

  assert.equal(resolvePicked(roster, null, 'scout'), 'scout')
  assert.equal(resolvePicked(roster, 'default', 'scout'), 'default')
  assert.equal(resolvePicked(roster, 'gone', 'also-gone'), 'default')
})

test('displayName prefers a custom title and calls default Hermes', () => {
  const { displayName } = loadHelpers()

  assert.equal(displayName({ name: 'default' }, {}), 'Hermes')
  assert.equal(displayName({ name: 'scribe' }, { title: 'Notes' }), 'Notes')
})

test('previewLine falls back when the bot has no last message', () => {
  const { previewLine } = loadHelpers()

  assert.equal(previewLine({}), 'Waiting for a task')
  assert.ok(previewLine({ last_session: { preview: 'Hello there' } }).includes('Hello'))
})

test('faceMood prefers held, then pet, then shy, then think', () => {
  const { faceMood } = loadHelpers()

  assert.equal(faceMood({ held: true, pet: true, shy: true, think: true }), 'held')
  assert.equal(faceMood({ held: true, asleep: true }), 'sleep')
  assert.equal(faceMood({ held: false, pet: true, shy: true, think: true }), 'pet')
  assert.equal(faceMood({ clap: true, think: true }), 'clap')
  assert.equal(faceMood({ held: false, pet: false, shy: true, think: true }), 'shy')
  assert.equal(faceMood({ held: false, pet: false, shy: false, think: true }), 'think')
  assert.equal(faceMood({}), 'idle')
})

test('isNightHour is late evening or early morning', () => {
  const { isNightHour } = loadHelpers()

  assert.equal(isNightHour(new Date(2026, 0, 1, 21)), true)
  assert.equal(isNightHour(new Date(2026, 0, 1, 3)), true)
  assert.equal(isNightHour(new Date(2026, 0, 1, 14)), false)
})

test('near uses a radius', () => {
  const { near } = loadHelpers()

  assert.equal(near({ x: 0, y: 0 }, { x: 3, y: 4 }, 6), true)
  assert.equal(near({ x: 0, y: 0 }, { x: 10, y: 0 }, 6), false)
})

test('movedEnough ignores tiny pointer jitter', () => {
  const { movedEnough } = loadHelpers()

  assert.equal(movedEnough({ x: 0, y: 0 }, { x: 3, y: 3 }), false)
  assert.equal(movedEnough({ x: 0, y: 0 }, { x: 10, y: 0 }), true)
})

test('clockHands are 24 hour digits plus analog angles', () => {
  const { clockLabel, clockHands, nextClockKind } = loadHelpers()
  const noon = new Date(2026, 0, 1, 15, 0)

  assert.equal(clockLabel(noon), '15:00')
  assert.equal(clockHands(noon).hour, 90)
  assert.equal(clockHands(noon).minute, 0)
  assert.equal(nextClockKind('digital'), 'analog')
  assert.equal(nextClockKind('analog'), 'digital')
})

test('easeInOut starts slow, hits the middle, and finishes slow', () => {
  const { easeInOut } = loadHelpers()

  assert.equal(easeInOut(0), 0)
  assert.equal(easeInOut(1), 1)
  assert.ok(easeInOut(0.25) < 0.25)
  assert.ok(easeInOut(0.75) > 0.75)
})

test('roamMs is longer for a farther walk, and stays in range', () => {
  const { roamMs } = loadHelpers()
  const short = roamMs({ x: 0, y: 0 }, { x: 20, y: 0 })
  const long = roamMs({ x: 0, y: 0 }, { x: 400, y: 0 })

  assert.ok(short >= 1400)
  assert.ok(long > short)
  assert.ok(long <= 4200)
})

test('plugin id matches the folder contract', () => {
  assert.match(source, /const ID = 'hermes-office'/)
  assert.match(source, /id: ID/)
  assert.match(source, /path: '\/office'/)
})

test('floor markup has a bar, hopscotch, and flat room skins', () => {
  assert.match(source, /className: 'office-bar'/)
  assert.match(source, /data-stool/)
  assert.match(source, /data-hop/)
  assert.match(source, /startWalkToBar/)
  assert.match(source, /startHopscotch/)
  assert.match(source, /startMusicalChairs/)
  assert.match(source, /goBar: true/)
  assert.match(source, /className: 'office-wall'/)
  assert.doesNotMatch(source, /office-backdrop/)
  assert.doesNotMatch(source, /data:image\/jpeg;base64,/)
  assert.doesNotMatch(source, /AudioContext/)
})

function loadSkins() {
  const start = source.indexOf('const WALL_H = ')
  const end = source.indexOf("const BOT_CHAT_TITLE = 'Bot Chat'")
  assert.ok(start >= 0 && end > start)

  const context = {}
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.__s = { WALL_H, OFFICE_SKINS, skinCss, svgUri };`, context)
  return context.__s
}

test('every room skin is a flat wall band plus a seamless floor tile', () => {
  const { WALL_H, OFFICE_SKINS, skinCss } = loadSkins()
  const names = Object.keys(OFFICE_SKINS)

  assert.deepEqual(names, ['carpet', 'loft', 'garden', 'nightclub', 'pizza'])

  for (const name of names) {
    const skin = OFFICE_SKINS[name]
    assert.match(skin.wall, /^data:image\/svg\+xml;charset=utf-8,/, `${name} wall`)
    assert.match(skin.floor, /^data:image\/svg\+xml;charset=utf-8,/, `${name} floor`)
    assert.match(skin.wallSize, new RegExp(`^\\d+px ${WALL_H}px$`), `${name} wall band is ${WALL_H}px tall`)
    assert.match(skin.floorSize, /^\d+px \d+px$/, `${name} floor tile has an explicit size`)
    assert.ok(decodeURIComponent(skin.wall).length < 8000, `${name} wall stays small`)
    assert.ok(decodeURIComponent(skin.floor).length < 8000, `${name} floor stays small`)

    const css = skinCss(name, skin)
    assert.match(css, new RegExp(`\\.office-room\\.is-${name} \\{ background: url\\("data:image/svg\\+xml`))
    assert.match(css, /repeat local/, 'floor tile scrolls with the desks')
    assert.match(css, /repeat-x/, 'wall repeats along the top only')
    assert.match(css, new RegExp(`\\.office-root\\.is-night \\.office-room\\.is-${name} `), 'night tint exists')
  }
})

test('svgUri collapses whitespace and encodes the markup', () => {
  const { svgUri } = loadSkins()
  const uri = svgUri(`<svg xmlns='http://www.w3.org/2000/svg'>
    <rect width='1' height='1'/>
  </svg>`)

  assert.equal(uri, `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg'><rect width='1' height='1'/></svg>")}`)
})

test('nextBackdrop walks the five room skins', () => {
  const { backdropNames, nextBackdrop } = loadHelpers()

  assert.equal(backdropNames().join(','), 'carpet,loft,garden,nightclub,pizza')
  assert.equal(nextBackdrop('carpet'), 'loft')
  assert.equal(nextBackdrop('nightclub'), 'pizza')
  assert.equal(nextBackdrop('pizza'), 'carpet')
  assert.equal(nextBackdrop('nope'), 'loft')
})

test('first bot to the pizza counter gets the slice, the rest get nothing', () => {
  const { freshPizza, claimPizza } = loadHelpers()
  const pie = freshPizza(1000)

  assert.equal(pie.winner, null)
  assert.equal(pie.at, 1000)

  const first = claimPizza(pie, 'scout', 1500)
  assert.equal(first.won, true)
  assert.equal(first.pizza.winner, 'scout')

  const second = claimPizza(first.pizza, 'scribe', 1900)
  assert.equal(second.won, false)
  assert.equal(second.pizza.winner, 'scout', 'the pie remembers who took the slice')

  const again = claimPizza(first.pizza, 'scout', 2200)
  assert.equal(again.won, true, 'the winner walking up again still has their slice')

  const next = claimPizza(freshPizza(3000), 'scribe', 3100)
  assert.equal(next.won, true, 'a new round is a new pie')
  assert.equal(claimPizza(null, 'solo', 10).won, true)
})

test('pizza wiring: rounds start on tasks, claims happen at the counter in the parlor', () => {
  assert.match(source, /function startRound\(name\)/)
  assert.match(source, /\$pizza\.set\(freshPizza\(Date\.now\(\)\)\)/)
  assert.match(source, /\$backdrop\.get\(\) === 'pizza'/)
  assert.match(source, /claimPizza\(\$pizza\.get\(\), name, now\)/)
  assert.match(source, /parlor \? 'Pizza' : 'Bar'/)
  assert.match(source, /if \(pizza\) \{\s*return 'pizza!'/)
  assert.match(source, /if \(noPizza\) \{\s*return 'no pizza'/)
})

test('idleBotNames leaves thinking bots at their desks', () => {
  const { idleBotNames } = loadHelpers()
  const roster = [{ name: 'scout' }, { name: 'scribe' }, { name: 'default' }]

  assert.deepEqual(idleBotNames(roster, { scout: { t0: 1 } }, 'default', true), ['scribe'])
  assert.deepEqual(idleBotNames(roster, {}, 'scribe', false), ['scout', 'scribe', 'default'])
})

test('chairCountForGame is always one short', () => {
  const { chairCountForGame } = loadHelpers()

  assert.equal(chairCountForGame(4), 3)
  assert.equal(chairCountForGame(1), 0)
  assert.equal(chairCountForGame(0), 0)
})

test('pickFreeStool skips taken spots, then stands beside the last one', () => {
  const { pickFreeStool, nextBarStand } = loadHelpers()
  const stools = [
    { id: '0', x: 0, y: 0 },
    { id: '1', x: 80, y: 0 }
  ]

  assert.equal(pickFreeStool(stools, [{ x: 2, y: 1 }]).id, '1')
  assert.equal(pickFreeStool(stools, []), stools[0])
  assert.equal(nextBarStand(stools, [{ x: 0, y: 0 }, { x: 80, y: 0 }]).id, 'stand-2')
  assert.equal(nextBarStand([], []), null)
})

test('musical chairs sit in the middle and players circle further out', () => {
  const { placeChairs, gameRing, ringPoint } = loadHelpers()
  const box = { x0: 0, y0: 0, x1: 400, y1: 300 }
  const chairs = placeChairs(3, box)
  const cx = chairs.reduce((sum, c) => sum + c.x + 15, 0) / 3
  const cy = chairs.reduce((sum, c) => sum + c.y + 15, 0) / 3

  assert.ok(Math.abs(cx - 200) < 2 && Math.abs(cy - 150) < 2, 'chairs are centred in the box')
  assert.equal(new Set(chairs.map(c => c.id)).size, 3)

  const ring = gameRing(box, 3)
  assert.ok(ring.radius > 60 && ring.radius < 150, `ring is well outside the chairs (${ring.radius})`)

  const start = { x: 320, y: 129 }
  const p1 = ringPoint(ring, start, 0)
  const p2 = ringPoint(ring, p1)
  const dist = p => Math.hypot(p.x + 21 - 200, p.y + 21 - 150)
  assert.ok(Math.abs(dist(p1) - ring.radius) < 1, 'first stop is on the ring')
  assert.ok(Math.abs(dist(p2) - ring.radius) < 1, 'next stop stays on the ring')
  assert.ok(Math.hypot(p2.x - p1.x, p2.y - p1.y) > 40, 'and moves around it')
})

test('assignChairs seats everyone but one leftover', () => {
  const { assignChairs, placeChairs } = loadHelpers()
  const chairs = placeChairs(2, { x0: 0, y0: 0, x1: 200, y1: 200 })
  const result = assignChairs(
    [
      { name: 'near', x: chairs[0].x, y: chairs[0].y },
      { name: 'mid', x: chairs[1].x + 4, y: chairs[1].y },
      { name: 'far', x: 800, y: 800 }
    ],
    chairs
  )

  assert.equal(chairs.length, 2)
  assert.equal(Object.keys(result.assigned).length, 2)
  assert.equal(result.assigned.near.id, chairs[0].id)
  assert.equal(result.leftover, 'far')
})

test('hopscotch goes out and back, hops fast and flat, and squashes on landing', () => {
  const { hopCourse, hopSquash, walkEase, beginWalk, walkHop } = loadHelpers()
  const rows = [{ id: '1' }, { id: '2' }, { id: '3-4' }, { id: '5' }, { id: '6-7' }, { id: '8' }]
  const course = hopCourse(rows).map(r => r.id)

  assert.deepEqual(course, ['1', '2', '3-4', '5', '6-7', '8', '6-7', '5', '3-4', '2', '1'])
  assert.deepEqual(hopCourse([{ id: 'x' }]).map(r => r.id), ['x'])

  const hop = beginWalk({ x: 0, y: 0 }, { x: 0, y: 30 }, 0, 'hopscotch')
  assert.ok(hop.ms >= 360 && hop.ms <= 420, 'a short hop is quick (' + hop.ms + ')')
  assert.equal(walkEase(0.25, 'hopscotch'), 0.25, 'hops travel at a steady speed')
  assert.ok(walkEase(0.25, 'bar') < 0.25, 'walks still ease in')
  assert.equal(walkHop(0.5, 'hopscotch'), 16)
  assert.equal(walkHop(0, 'hopscotch'), 0)

  const land = hopSquash(0.02, 'hopscotch')
  const air = hopSquash(0.6, 'hopscotch')
  const rise = hopSquash(0.24, 'hopscotch')
  assert.ok(land.sx > 1 && land.sy < 1, 'squash on landing')
  assert.ok(rise.sy > 1 && rise.sx < 1, 'stretch on take off')
  assert.equal(air.sx, 1)
  assert.equal(air.sy, 1)
  const flat = hopSquash(0.02, 'bar')
  assert.equal(flat.sx, 1)
  assert.equal(flat.sy, 1)
})

test('typedText types out the screen and nameHash is stable', () => {
  const { typedText, nameHash } = loadHelpers()

  assert.equal(typedText('hello', 0), '▍')
  assert.equal(typedText('hello', 1000 / 28 * 2 + 1), 'he▍')
  assert.equal(typedText('hello', 5000), 'hello')
  assert.equal(typedText('', 5000), '')
  assert.equal(nameHash('scout'), nameHash('scout'))
  assert.notEqual(nameHash('scout'), nameHash('scribe'))
  assert.ok(nameHash('') === 0)
})

test('advanceWalk follows a hopscotch path then arrives', () => {
  const { beginWalk, advanceWalk, walkHop } = loadHelpers()
  const first = beginWalk({ x: 0, y: 0 }, { x: 10, y: 0 }, 0, 'hopscotch', [{ x: 20, y: 0 }])
  const mid = advanceWalk(first, first.t0 + first.ms)
  const end = advanceWalk(mid.walk, mid.walk.t0 + mid.walk.ms)

  assert.equal(mid.done, false)
  assert.equal(mid.walk.to.x, 20)
  assert.equal(end.arrived, true)
  assert.equal(end.kind, 'hopscotch')
  assert.ok(walkHop(0.5, 'hopscotch') > walkHop(0.5, 'roam'))
  assert.equal(walkHop(1, 'hopscotch'), 0)
})
