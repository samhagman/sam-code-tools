import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

// One sample per half hour: five-hour and weekly window % used, plus the weekly reset time.
type Sample = { t: number; h5: number; d7: number; r7?: number }

const HOUR = 3_600_000
const SLOT = HOUR / 2
const isOpen = atom({ plugin: 'usage-burn', key: 'isOpen' } as const, false)
const zoom = atom({ plugin: 'usage-burn', key: 'zoomLevel' } as const, 3)
const tick = atom({ plugin: 'usage-burn', key: 'tick' } as const, 0)

const pick = (limits: SessionRateLimit[], kind: string) => limits.find(l => l.kind === kind)

// Usage spent since `from`: sum the rises; a drop is a reset, so the new value counts whole.
function spent(s: Sample[], key: 'h5' | 'd7', from: number) {
  let sum = 0
  for (let i = 1; i < s.length; i++) {
    if (s[i]!.t <= from) continue
    const d = s[i]![key] - s[i - 1]![key]
    sum += d >= 0 ? d : s[i]![key]
  }
  return Math.round(sum * 10) / 10
}

// %/ms burn of the weekly window over 48h, recent slots weighted more (24h half-life-ish).
function burnRate(s: Sample[], now: number) {
  let num = 0
  let den = 0
  for (let i = 1; i < s.length; i++) {
    const age = now - s[i]!.t
    if (age > 48 * HOUR) continue
    const d = s[i]!.d7 - s[i - 1]!.d7
    const w = Math.exp(-age / (24 * HOUR))
    num += w * (d >= 0 ? d : s[i]!.d7)
    den += w * (s[i]!.t - s[i - 1]!.t)
  }
  return den > 0 ? num / den : 0
}

const ZOOMS = [168, 72, 24, 6] // hours of history shown, widest first

function ticks(x0: number, x1: number, spanH: number) {
  const out: { t: number; label: string }[] = []
  if (spanH >= 48) {
    // Step by calendar day (setDate), so DST changes never duplicate a label.
    const d = new Date(x0); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1)
    for (; d.getTime() < x1; d.setDate(d.getDate() + 1))
      out.push({ t: d.getTime(), label: d.toLocaleDateString(undefined, { weekday: 'short' }) })
  } else {
    const step = spanH <= 6 ? 1 : 4
    const d = new Date(x0); d.setMinutes(0, 0, 0)
    for (; d.getTime() < x1; d.setHours(d.getHours() + 1))
      if (d.getTime() > x0 && d.getHours() % step === 0)
        out.push({ t: d.getTime(), label: d.toLocaleTimeString(undefined, { hour: 'numeric' }) })
  }
  return out
}

const when = (t: number) =>
  new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

function chart(s: Sample[], now: number, spanH: number) {
  const W = 560, H = 170, L = 30, R = 10, T = 14, B = 22
  const x0 = now - spanH * HOUR
  const x1 = now + (spanH * HOUR * 2) / 7
  const last = s[s.length - 1]!
  const rate = burnRate(s, now)
  const left = 100 - last.d7
  const eta = rate > 0 ? now + left / rate : Infinity
  const X = (t: number) => L + ((t - x0) / (x1 - x0)) * (W - L - R)
  const Y = (rem: number) => T + (1 - rem / 100) * (H - T - B)
  // Keep the one sample just before the window so the line enters from the left edge.
  const firstIn = s.findIndex(p => p.t >= x0)
  const pts = firstIn < 0 ? [] : s.slice(firstIn)
  const before = firstIn > 0 ? s[firstIn - 1] : undefined
  if (before && pts[0] && pts[0].d7 >= before.d7) {
    // Interpolate where the line crosses the left edge (skipped across a reset).
    const f = (x0 - before.t) / (pts[0].t - before.t)
    pts.unshift({ t: x0, h5: pts[0].h5, d7: before.d7 + f * (pts[0].d7 - before.d7) })
  }
  const cx = (t: number) => Math.max(L, X(t))
  const line = pts.map(p => `${cx(p.t).toFixed(1)},${Y(100 - p.d7).toFixed(1)}`).join(' ')
  const area = pts.length ? `${cx(pts[0]!.t)},${Y(0)} ${line} ${cx(pts[pts.length - 1]!.t)},${Y(0)}` : ''
  const resets = pts.filter((p, i) => i > 0 && p.t > x0 && p.d7 < pts[i - 1]!.d7 - 1)
  const endT = Math.min(eta, x1)
  const endRem = left - rate * (endT - now)
  const nextReset = last.r7 && last.r7 < x1 ? last.r7 : undefined
  const etaTxt = eta === Infinity ? 'no burn' : new Date(eta).toLocaleString(undefined, { weekday: 'short', hour: 'numeric' })
  const shown = pts.filter(p => p.t > x0 || p === s[firstIn])
  // Hover: each sample owns a vertical strip; hovering it reveals a guide line and a tooltip.
  const hovers = shown.map((p, i) => {
    const xa = i === 0 ? L : (X(shown[i - 1]!.t) + X(p.t)) / 2
    const xb = i === shown.length - 1 ? X(now) + 4 : (X(p.t) + X(shown[i + 1]!.t)) / 2
    const x = X(p.t), y = Y(100 - p.d7)
    const tw = 128, tx = Math.min(Math.max(x - tw / 2, L), W - R - tw), ty = y > T + 52 ? y - 50 : y + 10
    return `<g class="h"><rect x="${xa}" y="${T}" width="${Math.max(1, xb - xa)}" height="${Y(0) - T}" fill="transparent"/>
<line class="tip" x1="${x}" x2="${x}" y1="${T}" y2="${Y(0)}" stroke="#d97757" stroke-opacity=".5"/>
<circle class="dot" cx="${x}" cy="${y}" r="2.5" fill="#d97757"/>
<g class="tip"><rect x="${tx}" y="${ty}" width="${tw}" height="40" rx="5" fill="#1e1e1e" stroke="#555"/>
<text x="${tx + 8}" y="${ty + 13}" fill="#aaa">${when(p.t)}</text>
<text x="${tx + 8}" y="${ty + 26}" fill="#eee"><tspan font-weight="600">${(100 - p.d7).toFixed(0)}%</tspan> weekly left</text>
<text x="${tx + 8}" y="${ty + 36}" fill="#aaa" font-size="9">5h window ${p.h5.toFixed(0)}% used</text></g></g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif,system-ui" font-size="10">
<style>.h .tip{opacity:0;transition:opacity .12s}.h:hover .tip{opacity:1}.h:hover .dot{r:4}</style>
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d97757" stop-opacity=".35"/><stop offset="1" stop-color="#d97757" stop-opacity="0"/></linearGradient></defs>
${[0, 50, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#8884" stroke-dasharray="${v ? '2 3' : ''}"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end" fill="#888">${v}%</text>`).join('')}
${ticks(x0, x1, spanH).map(k => `<text x="${X(k.t)}" y="${H - 6}" text-anchor="middle" fill="#888">${k.label}</text>`).join('')}
<line x1="${X(now)}" x2="${X(now)}" y1="${T}" y2="${Y(0)}" stroke="#8886"/>
${resets.map(p => `<line x1="${X(p.t)}" x2="${X(p.t)}" y1="${T}" y2="${Y(0)}" stroke="#4a9" stroke-dasharray="3 2"/><text x="${X(p.t) + 3}" y="${T + 8}" fill="#4a9">reset</text>`).join('')}
${nextReset ? `<line x1="${X(nextReset)}" x2="${X(nextReset)}" y1="${T}" y2="${Y(0)}" stroke="#4a9" stroke-dasharray="3 2" opacity=".6"/><text x="${X(nextReset) + 3}" y="${T + 8}" fill="#4a9">resets</text>` : ''}
${area ? `<polygon points="${area}" fill="url(#g)"/><polyline points="${line}" fill="none" stroke="#d97757" stroke-width="2" stroke-linejoin="round"/>` : ''}
${rate > 0 ? `<line x1="${X(now)}" y1="${Y(left)}" x2="${X(endT)}" y2="${Y(Math.max(0, endRem))}" stroke="#d97757" stroke-width="1.5" stroke-dasharray="5 4" opacity=".8"/>` : ''}
<text x="${W - R}" y="${T - 3}" text-anchor="end" fill="#888">${left.toFixed(0)}% left &#183; empty &#8776; ${etaTxt}</text>
${hovers}
</svg>`
}

async function record($: EngineInterface) {
  const { rateLimits } = await $.session.usage()
  const h5 = pick(rateLimits, 'five_hour')
  const d7 = pick(rateLimits, 'seven_day')
  if (!h5 && !d7) return
  const now = await $.clock.now()
  const s = ((await $.store.get('samples')) as Sample[] | undefined) ?? []
  const sample: Sample = {
    t: now,
    h5: h5?.percentUsed ?? 0,
    d7: d7?.percentUsed ?? 0,
    r7: d7?.resetsAt ? Date.parse(d7.resetsAt) : undefined,
  }
  // Same half-hour slot as the last sample: replace it, so we keep one point per 30 min.
  const prev = s[s.length - 1]
  const same = prev && Math.floor(prev.t / SLOT) === Math.floor(now / SLOT)
  const next = [...(same ? s.slice(0, -1) : s), sample].filter(p => p.t > now - 8 * 24 * HOUR)
  await $.store.set('samples', next)
  await update($, tick, (n: number) => n + 1)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void record($)
    $.clock.every(SLOT, () => record($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await record($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, tick)
    const s = ((await $.store.get('samples')) as Sample[] | undefined) ?? []
    if (e.props.hasSurvey || s.length === 0) return next(e)
    const now = await $.clock.now()
    const open = await read($, isOpen)
    const ui = $.ui.resolve(e) as ReturnType<typeof $.ui.resolve> & { Svg?: any }
    const { Box, Text, Button } = ui
    const Svg = ui.Svg
    const h1 = spent(s, 'h5', now - HOUR)
    const h5 = spent(s, 'h5', now - 5 * HOUR)
    const z = await read($, zoom)
    const spanH = ZOOMS[z] ?? 6
    const spanTxt = spanH >= 24 ? `${spanH / 24}d` : `${spanH}h`
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="toggle" onPress={() => update($, isOpen, v => !v)}>
            <Text dimColor>
              1h {h1}% · 5h {h5}% {open ? '▾' : '▸'}
            </Text>
          </Button>
          {open && Svg && (
            z > 0
              ? <Button key="out" onPress={() => update($, zoom, (v: number) => Math.max(0, v - 1))}>−</Button>
              : <Text key="out-off" dimColor>−</Text>
          )}
          {open && Svg && <Text dimColor>{spanTxt}</Text>}
          {open && Svg && (
            z < ZOOMS.length - 1
              ? <Button key="in" onPress={() => update($, zoom, (v: number) => Math.min(ZOOMS.length - 1, v + 1))}>+</Button>
              : <Text key="in-off" dimColor>+</Text>
          )}
        </Box>
        {open && Svg && (
          <Svg
            key="chart"
            source={chart(s, now, spanH)}
            alt={`Weekly usage remaining over the last ${spanTxt}, with resets and a projected run-out line`}
            width={560}
            isInteractive
          />
        )}
        {open && !Svg && (
          <Text dimColor>{(100 - s[s.length - 1]!.d7).toFixed(0)}% weekly left (chart needs the desktop app)</Text>
        )}
      </Box>
    )
  })
}
