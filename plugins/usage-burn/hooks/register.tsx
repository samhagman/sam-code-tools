import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

// One reading: five-hour and weekly window % used, plus when the weekly window resets.
type Sample = { t: number; h5?: number; d7: number; r7?: number }

const HOUR = 3_600_000
const SLOT = HOUR / 2
const isOpen = atom({ plugin: 'usage-burn', key: 'isOpen' } as const, false)
const zoom = atom({ plugin: 'usage-burn', key: 'zoomIdx' } as const, 4)
const tick = atom({ plugin: 'usage-burn', key: 'tick' } as const, 0)
const selected = atom({ plugin: 'usage-burn', key: 'selectedT' } as const, 0)

const pick = (limits: SessionRateLimit[], kind: string) => limits.find(l => l.kind === kind)

// Each weekly reading, judged against its neighbours:
//   reset  - usage dropped AND the reset time moved on (a real new week)
//   glitch - a one-off reading that disagrees with both neighbours, or a drop with no reset
//   inc    - how much weekly usage this reading adds over the last good one
type Judged = { p: Sample; inc: number; isReset: boolean; isGlitch: boolean }

function judge(s: Sample[]): Judged[] {
  const out: Judged[] = []
  let base: Sample | undefined
  for (let i = 0; i < s.length; i++) {
    const p = s[i]!
    const a = s[i - 1], c = s[i + 1]
    // A lone spike or dip: both neighbours agree with each other, this one doesn't.
    const isSpike = a !== undefined && c !== undefined &&
      Math.abs(a.d7 - c.d7) <= 1 && Math.abs(p.d7 - a.d7) > 2 && Math.abs(p.d7 - c.d7) > 2 &&
      (a.r7 ?? 0) === (c.r7 ?? 0)
    if (isSpike) { out.push({ p, inc: 0, isReset: false, isGlitch: true }); continue }
    if (!base) { out.push({ p, inc: 0, isReset: false, isGlitch: false }); base = p; continue }
    if (p.d7 >= base.d7) {
      out.push({ p, inc: p.d7 - base.d7, isReset: false, isGlitch: false }); base = p; continue
    }
    const isNewWeek = (p.r7 ?? 0) > (base.r7 ?? 0) + HOUR || (base.r7 === undefined && p.d7 <= 10)
    if (isNewWeek) { out.push({ p, inc: p.d7, isReset: true, isGlitch: false }); base = p }
    else out.push({ p, inc: 0, isReset: false, isGlitch: true })
  }
  return out
}

// Usage spent since `from`. Weekly: from judged readings (glitches ignored). 5-hour: rises,
// with any drop treated as that window rolling over.
function spent(s: Sample[], key: 'h5' | 'd7', from: number) {
  let sum = 0
  if (key === 'd7') {
    for (const j of judge(s)) if (j.p.t > from) sum += j.inc
  } else {
    for (let i = 1; i < s.length; i++) {
      if (s[i]!.t <= from) continue
      const a = s[i - 1]!.h5, b = s[i]!.h5
      if (a === undefined || b === undefined) continue
      sum += b >= a ? b - a : b
    }
  }
  return Math.round(sum * 10) / 10
}

// Weekly burn in %/ms: total usage added / time elapsed over the last 7 days, each stretch
// weighted by how recent it is (half-life 48h). Glitches add nothing; real resets add the
// usage spent since the reset. Time with no readings (machine asleep) still counts as time,
// and usage from other machines arrives in the next reading, so long-run averages stay honest.
const BASIS = 7 * 24 * HOUR
const HALF_LIFE = 48 * HOUR

function burnRate(s: Sample[], now: number) {
  const good = judge(s).filter(j => !j.isGlitch)
  let num = 0
  let den = 0
  for (let i = 1; i < good.length; i++) {
    const cur = good[i]!, prev = good[i - 1]!
    if (now - cur.p.t > BASIS) continue
    const w = Math.pow(0.5, (now - cur.p.t) / HALF_LIFE)
    num += w * cur.inc
    den += w * (cur.p.t - prev.p.t)
  }
  return den > 0 ? num / den : 0
}

const ZOOMS = [720, 168, 72, 24, 6] // hours of history shown, widest first

function ticks(x0: number, x1: number, spanH: number) {
  const out: { t: number; label: string }[] = []
  if (spanH >= 48) {
    // Step by calendar day (setDate), so DST changes never duplicate a label.
    const d = new Date(x0); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1)
    const every = spanH > 200 ? 5 : 1
    for (; d.getTime() < x1; d.setDate(d.getDate() + 1))
      if (every === 1 || d.getDate() % every === 0)
        out.push({
          t: d.getTime(),
          label: every === 1
            ? d.toLocaleDateString(undefined, { weekday: 'short' })
            : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        })
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

// The run-out projection, shared by the band and the chart.
function projection(s: Sample[], now: number) {
  const good = judge(s).filter(j => !j.isGlitch).map(j => j.p)
  const recent = good.filter(p => p.t > now - BASIS)
  const basisH = recent.length > 1 ? (recent[recent.length - 1]!.t - recent[0]!.t) / HOUR : 0
  const rate = burnRate(s, now)
  const last = good[good.length - 1] ?? s[s.length - 1]!
  const left = 100 - last.d7
  const eta = rate > 0 ? now + left / rate : Infinity
  const reset = last.r7 && last.r7 > now ? last.r7 : undefined
  return { basisH, isWarmingUp: basisH < 3, rate, left, eta, reset, isResetFirst: reset !== undefined && reset < eta }
}

const etaShort = (eta: number) =>
  new Date(eta).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

function chart(s: Sample[], now: number, spanH: number, selectedT: number) {
  const W = 560, H = 184, L = 30, R = 10, T = 28, B = 22
  const x0 = now - spanH * HOUR
  const x1 = now + (spanH * HOUR * 2) / 7
  const { basisH, isWarmingUp, rate, left, eta, reset, isResetFirst } = projection(s, now)
  const X = (t: number) => L + ((t - x0) / (x1 - x0)) * (W - L - R)
  const Y = (rem: number) => T + (1 - rem / 100) * (H - T - B)
  const judged = judge(s)
  const good = judged.filter(j => !j.isGlitch)
  // The line runs through good readings only, split at each weekly reset: the old week holds
  // its level until the reset time, then the new week starts at 0% used.
  const segs: Sample[][] = [[]]
  for (let i = 0; i < good.length; i++) {
    const j = good[i]!, prev = good[i - 1]
    if (j.isReset && prev) {
      const at = prev.p.r7 && prev.p.r7 > prev.p.t && prev.p.r7 < j.p.t ? prev.p.r7 : j.p.t
      segs[segs.length - 1]!.push({ t: at, d7: prev.p.d7 })
      segs.push([{ t: at, d7: 0 }])
    }
    segs[segs.length - 1]!.push(j.p)
  }
  const cx = (t: number) => Math.min(Math.max(X(t), L), X(now))
  const paths = segs.filter(g => g.length > 0 && g[g.length - 1]!.t >= x0).map(g => {
    // Enter from the left edge, interpolated between the readings either side of it.
    const k = g.findIndex(p => p.t >= x0)
    const inside = g.slice(k)
    const b = g[k - 1]
    if (b && inside[0]) {
      const f = (x0 - b.t) / (inside[0].t - b.t)
      inside.unshift({ t: x0, d7: b.d7 + f * (inside[0].d7 - b.d7) })
    }
    const line = inside.map(p => `${cx(p.t).toFixed(1)},${Y(100 - p.d7).toFixed(1)}`).join(' ')
    const area = `${cx(inside[0]!.t)},${Y(0)} ${line} ${cx(inside[inside.length - 1]!.t)},${Y(0)}`
    return `<polygon points="${area}" fill="url(#g)"/><polyline points="${line}" fill="none" stroke="#d97757" stroke-width="2" stroke-linejoin="round"/>`
  }).join('')
  const resets = segs.slice(1).map(g => g[0]!).filter(p => p.t > x0)
  // The projection stops at whichever comes first: empty, the weekly reset, or the chart edge.
  const endT = Math.min(eta, reset ?? Infinity, x1)
  const endRem = left - rate * (endT - now)
  const etaTxt = isWarmingUp
    ? `projection after 3h of data (${basisH.toFixed(1)}h so far)`
    : eta === Infinity
      ? 'no burn in the last 7 days'
      : isResetFirst
        ? `resets ${etaShort(reset!)} before empty (${etaShort(eta)})`
        : `empty &#8776; ${etaShort(eta)}`
  const shown = judged.filter(j => j.p.t > x0)
  // Hover: each reading owns a vertical strip; hovering it reveals a guide line and a tooltip.
  const hovers = shown.map((j, i) => {
    const p = j.p
    const xa = i === 0 ? L : (X(shown[i - 1]!.p.t) + X(p.t)) / 2
    const xb = i === shown.length - 1 ? X(now) + 4 : (X(p.t) + X(shown[i + 1]!.p.t)) / 2
    const x = X(p.t), y = Y(100 - p.d7)
    const tw = 140, tx = Math.min(Math.max(x - tw / 2, L), W - R - tw), ty = y > T + 52 ? y - 50 : y + 10
    const dot = j.isGlitch
      ? `<circle class="dot" cx="${x}" cy="${y}" r="3" fill="none" stroke="#e5534b" stroke-width="1.5"/>`
      : `<circle class="dot" cx="${x}" cy="${y}" r="2.5" fill="#d97757"/>`
    const ring = p.t === selectedT ? `<circle cx="${x}" cy="${y}" r="6.5" fill="none" stroke="#fff" stroke-width="1.5"/>` : ''
    return `<g class="h"><rect x="${xa}" y="${T}" width="${Math.max(1, xb - xa)}" height="${Y(0) - T}" fill="transparent"/>
<line class="tip" x1="${x}" x2="${x}" y1="${T}" y2="${Y(0)}" stroke="#d97757" stroke-opacity=".5"/>
${dot}${ring}
<g class="tip"><rect x="${tx}" y="${ty}" width="${tw}" height="40" rx="5" fill="#1e1e1e" stroke="#555"/>
<text x="${tx + 8}" y="${ty + 13}" fill="#aaa">${when(p.t)}${j.isGlitch ? ' &#183; <tspan fill="#e5534b">ignored</tspan>' : ''}</text>
<text x="${tx + 8}" y="${ty + 26}" fill="#eee"><tspan font-weight="600">${(100 - p.d7).toFixed(0)}%</tspan> weekly left</text>
<text x="${tx + 8}" y="${ty + 36}" fill="#aaa" font-size="9">${p.h5 === undefined ? 'no 5h window reported' : `5h window ${p.h5.toFixed(0)}% used`}</text></g></g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif,system-ui" font-size="10">
<style>.h .tip{opacity:0;transition:opacity .12s}.h:hover .tip{opacity:1}.h:hover .dot{r:4}</style>
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d97757" stop-opacity=".35"/><stop offset="1" stop-color="#d97757" stop-opacity="0"/></linearGradient>
<clipPath id="plot"><rect x="${L}" y="0" width="${W - L - R}" height="${H}"/></clipPath></defs>
${[0, 50, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#8884" stroke-dasharray="${v ? '2 3' : ''}"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end" fill="#888">${v}%</text>`).join('')}
${ticks(x0, x1, spanH).map(k => `<text x="${X(k.t)}" y="${H - 6}" text-anchor="middle" fill="#888">${k.label}</text>`).join('')}
<line x1="${X(now)}" x2="${X(now)}" y1="${T}" y2="${Y(0)}" stroke="#8886"/>
<g clip-path="url(#plot)">
${resets.map(p => `<line x1="${X(p.t)}" x2="${X(p.t)}" y1="${T}" y2="${Y(0)}" stroke="#4a9" stroke-dasharray="3 2"/><text x="${X(p.t) + 3}" y="${T + 8}" fill="#4a9">reset</text>`).join('')}
${reset && reset < x1 ? `<line x1="${X(reset)}" x2="${X(reset)}" y1="${T}" y2="${Y(0)}" stroke="#4a9" stroke-dasharray="3 2" opacity=".6"/><text x="${X(reset) + 3}" y="${T + 8}" fill="#4a9">resets</text>` : ''}
${paths}
${!isWarmingUp ? `<line x1="${X(now)}" y1="${Y(left)}" x2="${X(endT)}" y2="${Y(Math.max(0, endRem))}" stroke="#d97757" stroke-width="1.5" stroke-dasharray="5 4" opacity=".8"/>` : ''}
</g>
<text x="${W - R}" y="14" text-anchor="end" fill="#888">${left.toFixed(0)}% left &#183; ${etaTxt}</text>
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
    h5: h5?.percentUsed,
    d7: d7?.percentUsed ?? 0,
    r7: d7?.resetsAt ? Date.parse(d7.resetsAt) : undefined,
  }
  // Every reading is kept as-is (no merging or thinning) for 30 days.
  const next = [...s, sample].filter(p => p.t > now - 30 * 24 * HOUR)
  await $.store.set('samples', next)
  await update($, tick, (n: number) => n + 1)
}

// Removes readings by timestamp; the next draw recomputes everything from what's left.
async function remove($: EngineInterface, ts: number[]) {
  const s = ((await $.store.get('samples')) as Sample[] | undefined) ?? []
  const gone = new Set(ts)
  await $.store.set('samples', s.filter(p => !gone.has(p.t)))
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
    const Select = (ui as { Select?: any }).Select
    const Svg = ui.Svg
    // Some accounts report no 5-hour window (or only ever 0%): then show weekly limit spent.
    const has5h = s.some(p => p.t > now - 5 * HOUR && (p.h5 ?? 0) > 0)
    const key = has5h ? 'h5' : 'd7'
    const h1 = spent(s, key, now - HOUR)
    const h5 = spent(s, key, now - 5 * HOUR)
    const p = projection(s, now)
    const etaBand = p.isWarmingUp
      ? ''
      : p.eta === Infinity
        ? ' · no burn'
        : p.isResetFirst
          ? ` · resets ${etaShort(p.reset!)} first`
          : ` · empty ≈ ${etaShort(p.eta)}`
    const z = await read($, zoom)
    const spanH = ZOOMS[z] ?? 6
    const spanTxt = spanH >= 24 ? `${spanH / 24}d` : `${spanH}h`
    // Reading editor: the readings in view, newest first; flagged ones marked.
    const inView = judge(s).filter(j => j.p.t > now - spanH * HOUR).reverse().slice(0, 150)
    const flagged = judge(s).filter(j => j.isGlitch).map(j => j.p.t)
    const chosen = await read($, selected)
    const selT = inView.some(j => j.p.t === chosen) ? chosen : (inView[0]?.p.t ?? 0)
    const options = inView.map(j => ({
      value: String(j.p.t),
      label: `${when(j.p.t)} · ${j.p.d7}% used${j.isGlitch ? ' · ⚠ ignored' : ''}`,
    }))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="toggle" onPress={() => update($, isOpen, v => !v)}>
            <Text dimColor>
              1h {h1}% · 5h {h5}%{etaBand} {open ? '▾' : '▸'}
            </Text>
          </Button>
          {open && Svg && (
            // Always a Button so its width never changes; at the limit it's a dimmed no-op.
            <Button key="out" label="−" dimColor={z === 0} onPress={() => update($, zoom, (v: number) => Math.max(0, v - 1))} />
          )}
          {open && Svg && <Text dimColor>{spanTxt}</Text>}
          {open && Svg && (
            <Button key="in" label="+" dimColor={z === ZOOMS.length - 1} onPress={() => update($, zoom, (v: number) => Math.min(ZOOMS.length - 1, v + 1))} />
          )}
          {open && (
            // Re-reads the latest limits and redraws (record bumps `tick`).
            <Button key="refresh" label="↻" dimColor onPress={() => record($)} />
          )}
        </Box>
        {open && Svg && (
          <Box marginTop={1}>
          <Svg
            key="chart"
            source={chart(s, now, spanH, selT)}
            alt={`Weekly usage remaining over the last ${spanTxt}, with resets and a projected run-out line`}
            width={560}
            isInteractive
          />
          </Box>
        )}
        {open && Svg && Select && options.length > 0 && (
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Select
              key="reading"
              label="Reading"
              options={options}
              value={String(selT)}
              onSelect={(v: string) => update($, selected, () => Number(v))}
            />
            <Button
              key="delete"
              label="Delete reading"
              onPress={async () => {
                const i = inView.findIndex(j => j.p.t === selT)
                const neighbour = inView[i + 1] ?? inView[i - 1]
                await remove($, [selT])
                await update($, selected, () => neighbour?.p.t ?? 0)
              }}
            />
            {flagged.length > 0 && (
              <Button key="delete-flagged" label={`Delete ${flagged.length} flagged`} dimColor onPress={() => remove($, flagged)} />
            )}
          </Box>
        )}
        {open && !Svg && (
          <Text dimColor>{(100 - s[s.length - 1]!.d7).toFixed(0)}% weekly left (chart needs the desktop app)</Text>
        )}
      </Box>
    )
  })
}
