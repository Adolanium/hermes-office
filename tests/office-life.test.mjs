import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const plain = value => JSON.parse(JSON.stringify(value))

function setup() {
  const atom = value => ({ get: () => value, set: next => { value = next } })
  const clock = { now: 1000000 }
  const writes = [], visits = [], homes = [], fx = []
  const context = {
    atom, Date: class extends Date { static now() { return clock.now } },
    document: { hidden: false }, WALL_H: 86,
    $game: atom(null), $drag: atom(null), $walks: atom({}), $seats: atom({}), $officeInput: atom({}), $pizza: atom(null),
    JOB_STATES: { SUBMITTING: 'submitting', RUNNING: 'running' },
    savePref: (key, value) => writes.push({ key, value: plain(value) }),
    startWalk: (name, to) => visits.push({ name, to }), startWalkHome: name => homes.push(name), startWalkToBar: name => visits.push({ name, bar: true }),
    patchFx: (name, patch) => fx.push({ name, patch }),
    faceOn: () => ({ x: 200, y: 300 }),
    saveSeats: value => context.$seats.set(value)
  }
  vm.runInNewContext([
    slice('function deskMood(', 'function nameHash('),
    slice('function nameHash(', 'function typedText('),
    slice('function jobIsActive(', 'function jobAllowsSubmission('),
    slice('function idleBotNames(', 'function hopCourse('),
    slice('function easeInOut(', 'function roamMs('),
    slice('function freshPizza(', 'function claimPizza('),
    slice('const OFFICE_QUIRKS =', 'function PropArt('),
    'globalThis.life = { bossPosition, normalizeOfficeLife, officeQuirk, rememberOffice, officeCast, beginOfficeIncident, tickOfficeLife, endOfficeIncident, handleOfficeInput, incidentLine, $officeLife, $officeIncident, $officeArrange, $officeChatter }'
  ].join('\n'), context)
  return { ...context.life, context, clock, writes, visits, homes, fx, room: { scrollWidth: 600, querySelector: () => ({}) } }
}

test('saved life validates quirks, coordinates and bounded history', () => {
  const h = setup()
  const life = h.normalizeOfficeLife({ chaos: 'invalid', quirks: { scout: 'mugs', arke: 'bad' }, props: { cat: { x: -400, y: 200 }, fan: { x: 'bad', y: 5 } }, stories: Array.from({ length: 80 }, (_, at) => ({ at, text: 'recorded', cast: ['scout'], scene: 'missing' })) })
  assert.deepEqual(plain(life.quirks), { scout: 'mugs' })
  assert.deepEqual(plain(life.props.cat), { x: 6, y: 88, visible: true })
  assert.equal(life.props.fan, undefined)
  assert.equal(life.chaos, 'gentle')
  assert.equal(life.stories.length, 60)
  assert.equal(life.stories[0].at, 20)
  assert.equal(life.stories[0].scene, null)
})

test('personality stays stable and saved choices override the default', () => {
  const h = setup()
  const first = h.officeQuirk('scout').id
  assert.equal(h.officeQuirk('scout').id, first)
  h.$officeLife.set(h.normalizeOfficeLife({ quirks: { scout: 'quiet' } }))
  assert.equal(h.officeQuirk('scout').id, 'quiet')
})

test('scene casting excludes work, focused live chat, held bots and game players', () => {
  const h = setup()
  const roster = ['work', 'focused', 'held', 'game', 'idle'].map(name => ({ name }))
  h.context.$drag.set({ name: 'held' })
  h.context.$game.set({ players: ['game'] })
  const jobs = { work: { state: 'running' } }
  assert.deepEqual(plain(h.officeCast(roster, jobs, 'focused', true)), ['idle'])
  assert.equal(h.beginOfficeIncident('mouse', roster, jobs, 'focused', true, h.room), true)
  assert.deepEqual(plain(h.$officeIncident.get().cast), ['idle'])
  assert.equal(h.beginOfficeIncident('ufo', roster, jobs, 'focused', true, h.room), false)
  assert.deepEqual(h.visits.map(v => v.name), ['idle'])
})

test('a scene advances, excludes a newly busy actor, and records exactly one ending', () => {
  const h = setup(), roster = [{ name: 'scout' }]
  h.beginOfficeIncident('printer', roster, {}, '', false, h.room)
  h.clock.now += 4200
  h.tickOfficeLife(h.clock.now, roster, { scout: { state: 'running' } }, '', false, h.room)
  assert.equal(h.$officeIncident.get().phase, 1)
  assert.equal(h.visits.length, 1, 'a busy bot gets no new scene walk')
  h.clock.now += 8000
  h.tickOfficeLife(h.clock.now, roster, {}, '', false, h.room)
  assert.equal(h.$officeIncident.get(), null)
  assert.equal(h.$officeLife.get().stories.length, 1)
  h.tickOfficeLife(h.clock.now + 500, roster, {}, '', false, h.room)
  assert.equal(h.$officeLife.get().stories.length, 1)
  assert.equal(h.$officeLife.get().stories[0].scene, 'printer')
})

test('ending a scene stops only its visit walks and never records an unplayed ending', () => {
  const h = setup()
  h.beginOfficeIncident('gravity', [{ name: 'scout' }, { name: 'arke' }], {}, '', false, h.room)
  h.context.$walks.set({ scout: { kind: 'visit', from: { x: 0, y: 0 }, to: { x: 100, y: 100 }, t0: h.clock.now - 500, ms: 1000 }, arke: { kind: 'home' } })
  h.endOfficeIncident(h.clock.now)
  assert.deepEqual(plain(h.context.$seats.get().scout), { x: 50, y: 50 })
  assert.equal(h.context.$walks.get().scout, undefined)
  assert.equal(h.context.$walks.get().arke.kind, 'home')
  assert.equal(h.$officeLife.get().stories.length, 0)
})

test('quiet, hidden and arranging states prevent automatic incidents', () => {
  for (const mode of ['quiet', 'hidden', 'arrange']) {
    const h = setup()
    if (mode === 'quiet') h.$officeLife.set(h.normalizeOfficeLife({ chaos: 'quiet' }))
    if (mode === 'hidden') h.context.document.hidden = true
    if (mode === 'arrange') h.$officeArrange.set(true)
    h.tickOfficeLife(h.clock.now, [{ name: 'scout' }], {}, '', false, h.room)
    h.clock.now += 200000
    h.tickOfficeLife(h.clock.now, [{ name: 'scout' }], {}, '', false, h.room)
    assert.equal(h.$officeIncident.get(), null, mode)
  }
})

test('memories retain the furniture arrangement at the time of the event', () => {
  const h = setup()
  h.$officeLife.set(h.normalizeOfficeLife({ props: { cat: { x: 25, y: 60 }, fan: { x: 50, y: 60, visible: false } } }))
  h.rememberOffice('incident', 'Mouse recovered.', ['scout'], 'mouse')
  const snapshot = h.$officeLife.get().stories[0].snapshot
  assert.equal(snapshot.find(p => p.id === 'cat').x, 25)
  assert.equal(snapshot.find(p => p.id === 'fan'), undefined)
  assert.equal(h.writes.at(-1).key, 'officeLife')
})

test('input requests clear only on their matching resolution or the turn ending', () => {
  const h = setup(), row = { state: 'running', id: 'job-1' }
  h.handleOfficeInput('scout', row, { type: 'clarify.request', payload: { request_id: 'new' } })
  h.handleOfficeInput('scout', row, { type: 'clarify.expire', payload: { request_id: 'old' } })
  assert.equal(h.context.$officeInput.get().scout.id, 'new')
  h.handleOfficeInput('scout', row, { type: 'tool.complete', payload: { tool_id: 'new' } })
  assert.equal(h.context.$officeInput.get().scout, undefined)
  h.handleOfficeInput('scout', { state: 'completed' }, { type: 'approval.request', payload: { request_id: 'late' } })
  assert.equal(h.context.$officeInput.get().scout, undefined)
})

test('boss pauses at both desks and returns to the entrance', () => {
  const h = setup()
  const tour = [{ x: 200, y: 80 }, { x: 40, y: 220 }, { x: 300, y: 220 }, { x: 200, y: 80 }]
  assert.equal(h.bossPosition(tour, 0).x, 200)
  assert.equal(h.bossPosition(tour, 5000).x, 40)
  assert.equal(h.bossPosition(tour, 5000).walking, false)
  assert.equal(h.bossPosition(tour, 13000).x, 300)
  assert.equal(h.bossPosition(tour, 20000).x, 200)
})

test('boss can inspect a fully busy office without moving workers or awarding work', () => {
  const h = setup(), roster = [{ name: 'scout' }, { name: 'arke' }]
  const jobs = { scout: { state: 'running' }, arke: { state: 'running' } }
  h.tickOfficeLife(h.clock.now, roster, jobs, '', false, h.room)
  h.clock.now += 91000
  h.tickOfficeLife(h.clock.now, roster, jobs, '', false, h.room)
  assert.equal(h.$officeIncident.get().kind, 'boss')
  assert.deepEqual(h.homes, [])
  assert.deepEqual(h.visits, [])
  h.clock.now += 12000
  h.tickOfficeLife(h.clock.now, roster, jobs, '', false, h.room)
  assert.equal(h.$officeIncident.get().phase, 3, 'boss tour continues past ordinary scene duration')
  h.clock.now += 8000
  h.tickOfficeLife(h.clock.now, roster, jobs, '', false, h.room)
  assert.equal(h.$officeIncident.get(), null)
  assert.equal(h.$officeLife.get().stories[0].type, 'incident')
  assert.equal(h.$officeLife.get().stories[0].scene, 'boss')
})
