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
    `${source.slice(start, end)}\nconst DRAG_PX = 8;\nconst BOT_CHAT_TITLE = 'Bot Chat';\n${source.slice(moodStart, previewEnd)}\nglobalThis.__h = { displayName, deskMood, previewLine, faceMood, movedEnough, near, isNightHour, stickyText, clockLabel, clockHands, nextClockKind, pickBotChatRow, roamMs, easeInOut };`,
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
  assert.equal(pickBotChatRow([{ id: 'only', title: 'Other' }], null), 'only')
  assert.equal(pickBotChatRow([], 'gone'), null)
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
