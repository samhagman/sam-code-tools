import { expect, mock, test } from 'claude-code/testing'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 6, 15, 0)
const r7 = NOW + 2 * 24 * HOUR
// 10 hourly readings rising 1% an hour, with reading 5 a bad dip to 5%.
const seed = Array.from({ length: 10 }, (_, i) => ({ t: NOW - (10 - i) * HOUR, d7: i === 5 ? 5 : 50 + i, r7 }))

const BAND = { plugin: 'usage-burn', component: 'AbovePrompt', props: {} as never } as const
const COLS = 70, ROWS = 12

async function setup($: any, on: any) {
  mock.clock(on, { now: NOW })
  mock.store(on, { samples: seed })
  on('session.usage', () => ({ value: { startedAt: NOW, context: {}, rateLimits: [] } }) as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'toggle' })
  // Zoom out to 24h so all ten readings are in view.
  await ui.press({ key: 'out' })
  await ui.resize({ columns: COLS, rows: ROWS, in: 'picker' })
  return ui
}

const dots = async (ui: any) =>
  ((await ui.find({ type: 'Client', key: 'picker' }))?.props.props.dots as [number, number, number][])

// Click where a reading's dot is drawn, in the click layer's cells.
async function clickDot(ui: any, t: number) {
  const d = (await dots(ui)).find(x => x[0] === t)!
  await ui.pointer({ type: 'down', x: Math.floor(d[1] * COLS), y: Math.floor(d[2] * ROWS), button: 'left', in: 'picker' })
}

test('nothing is selected until a dot is clicked; ✕ clears it', async ($, on) => {
  const ui = await setup($, on)
  expect(await ui.find({ type: 'Button', key: 'delete' })).toBe(undefined)
  expect((await dots(ui)).length).toBe(10)
  await clickDot(ui, seed[3]!.t)
  expect((await ui.find({ type: 'Button', key: 'delete' }))?.props.label).toBe('Delete reading')
  await ui.press({ key: 'unselect' })
  expect(await ui.find({ type: 'Button', key: 'delete' })).toBe(undefined)
  await ui.unmount()
})

test('clicking a dot then Delete removes exactly that reading', async ($, on) => {
  const ui = await setup($, on)
  await clickDot(ui, seed[3]!.t)
  await ui.press({ key: 'delete' })
  const left = (await dots(ui)).map(d => d[0])
  expect(left.length).toBe(9)
  expect(left.includes(seed[3]!.t)).toBe(false)
  expect(await ui.find({ type: 'Button', key: 'delete' })).toBe(undefined)
  await ui.unmount()
})

test('Delete flagged removes the bad dip and nothing else', async ($, on) => {
  const ui = await setup($, on)
  expect((await ui.find({ type: 'Button', key: 'delete-flagged' }))?.props.label).toBe('Delete 1 flagged')
  await ui.press({ key: 'delete-flagged' })
  expect((await dots(ui)).length).toBe(9)
  expect(await ui.find({ type: 'Button', key: 'delete-flagged' })).toBe(undefined)
  await ui.unmount()
})
