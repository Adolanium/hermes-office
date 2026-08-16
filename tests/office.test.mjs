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
  const previewEnd = source.indexOf('async function openBot')

  assert.ok(start >= 0 && end > start)
  assert.ok(moodStart >= 0 && moodEnd > moodStart)
  assert.ok(previewEnd > moodEnd)

  const context = {}
  vm.runInNewContext(
    `${source.slice(start, end)}\n${source.slice(moodStart, previewEnd)}\nglobalThis.__h = { displayName, deskMood, previewLine };`,
    context
  )

  return context.__h
}

test('deskMood is think only for the focused live turn', () => {
  const { deskMood } = loadHelpers()

  assert.equal(deskMood({ isActive: true, turnBusy: true }), 'think')
  assert.equal(deskMood({ isActive: true, turnBusy: false }), 'idle')
  assert.equal(deskMood({ isActive: false, turnBusy: true }), 'idle')
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

test('plugin id matches the folder contract', () => {
  assert.match(source, /const ID = 'hermes-office'/)
  assert.match(source, /id: ID/)
  assert.match(source, /path: '\/office'/)
})
