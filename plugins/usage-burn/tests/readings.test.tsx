import { expect, mock, test } from 'claude-code/testing'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 6, 15, 0)
const r7 = NOW + 2 * 24 * HOUR
// 10 hourly readings rising 1% an hour, with reading 5 a bad dip to 5%.
const seed = Array.from({ length: 10 }, (_, i) => ({ t: NOW - (10 - i) * HOUR, d7: i === 5 ? 5 : 50 + i, r7 }))

const BAND = { plugin: 'usage-burn', component: 'AbovePrompt', props: {} as never } as const

async function setup($: any, on: any) {
  mock.clock(on, { now: NOW })
  mock.store(on, { samples: seed })
  on('session.usage', () => ({ value: { startedAt: NOW, context: {}, rateLimits: [] } }) as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'toggle' })
  // Zoom out to 24h so all ten readings are in view.
  await ui.press({ key: 'out' })
  return ui
}

const optionCount = async (ui: any) =>
  ((await ui.find({ type: 'Select' }))?.props.options as unknown[] | undefined)?.length ?? 0

test('the bad reading is flagged and the editor lists every reading', async ($, on) => {
  const ui = await setup($, on)
  const select = await ui.find({ type: 'Select' })
  const labels = (select?.props.options as { label: string }[]).map(o => o.label)
  expect(labels.length).toBe(10)
  expect(labels.filter(l => l.includes('⚠')).length).toBe(1)
  expect((await ui.find({ type: 'Button', key: 'delete-flagged' }))?.props.label).toBe('Delete 1 flagged')
  await ui.unmount()
})

test('Delete reading removes exactly the selected one', async ($, on) => {
  const ui = await setup($, on)
  await ui.select({ key: 'reading', value: String(seed[3]!.t) })
  await ui.press({ key: 'delete' })
  expect(await optionCount(ui)).toBe(9)
  const values = ((await ui.find({ type: 'Select' }))?.props.options as { value: string }[]).map(o => o.value)
  expect(values.includes(String(seed[3]!.t))).toBe(false)
  await ui.unmount()
})

test('Delete flagged removes the bad dip and nothing else', async ($, on) => {
  const ui = await setup($, on)
  await ui.press({ key: 'delete-flagged' })
  expect(await optionCount(ui)).toBe(9)
  expect(await ui.find({ type: 'Button', key: 'delete-flagged' })).toBe(undefined)
  await ui.unmount()
})
