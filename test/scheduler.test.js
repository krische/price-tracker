import assert from 'node:assert/strict'
import cron from 'node-cron'
import { test } from 'node:test'
import { startScheduler, stopScheduler } from '../src/scheduler.js'

function startSchedulerWithExpression(t, expression) {
  const previousExpression = process.env.CHECK_INTERVAL_EXPRESSION
  let scheduledExpression

  if (expression === undefined) {
    delete process.env.CHECK_INTERVAL_EXPRESSION
  } else {
    process.env.CHECK_INTERVAL_EXPRESSION = expression
  }
  t.after(() => {
    if (previousExpression === undefined) {
      delete process.env.CHECK_INTERVAL_EXPRESSION
    } else {
      process.env.CHECK_INTERVAL_EXPRESSION = previousExpression
    }
  })
  t.mock.method(cron, 'schedule', (value) => {
    scheduledExpression = value
  })
  t.mock.method(globalThis, 'setTimeout', () => {})
  t.mock.method(console, 'log', () => {})

  startScheduler()
  return scheduledExpression
}

test('schedules using the configured full cron expression', (t) => {
  assert.equal(startSchedulerWithExpression(t, '*/15 * * * *'), '*/15 * * * *')
})

test('defaults to every six hours when the expression is not configured', (t) => {
  assert.equal(startSchedulerWithExpression(t), '0 */6 * * *')
})

test('defaults to every six hours when the expression is blank', (t) => {
  assert.equal(startSchedulerWithExpression(t, '  '), '0 */6 * * *')
})

test('trims surrounding whitespace from the configured expression', (t) => {
  assert.equal(startSchedulerWithExpression(t, '  */15 * * * *  '), '*/15 * * * *')
})

test('stops scheduled and startup price checks', async (t) => {
  const task = { stop: t.mock.fn() }
  const startupTimer = {}
  const clearTimeout = t.mock.method(globalThis, 'clearTimeout')
  t.mock.method(cron, 'schedule', () => task)
  t.mock.method(globalThis, 'setTimeout', () => startupTimer)
  t.mock.method(console, 'log', () => {})

  startScheduler()
  await stopScheduler()

  assert.equal(task.stop.mock.callCount(), 1)
  assert.deepEqual(clearTimeout.mock.calls[0].arguments, [startupTimer])
})
