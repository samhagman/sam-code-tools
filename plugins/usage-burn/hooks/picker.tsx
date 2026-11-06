import type { ClientModule } from 'claude-code'

// An invisible layer laid exactly over the chart. The chart itself is a sandboxed picture
// that can't hear clicks, so this layer catches the pointer, finds the nearest dot, and
// tells the hooks module: { hover: t } as the pointer moves, { pick: t } on a click.
// Dots arrive as [t, fx, fy]: the reading's time and its position as fractions of the chart.
type Props = { dots: [number, number, number][]; w: number; h: number }
type State = { hover: number }

const Picker: ClientModule<Props, State> = (props, surface) => {
  const { Box } = surface.elements
  const nearest = (fx: number, fy: number, maxPx: number) => {
    let best = 0, bestD = maxPx
    for (const [t, x, y] of props.dots) {
      const d = Math.hypot((x - fx) * props.w, (y - fy) * props.h)
      if (d < bestD) { best = t; bestD = d }
    }
    return best
  }
  surface.onPointer(e => {
    const cols = surface.columns || 1, rows = surface.rows || 1
    const fx = (e.fine?.x ?? e.x + 0.5) / cols
    const fy = (e.fine?.y ?? e.y + 0.5) / rows
    if (e.type === 'down') return surface.post({ pick: nearest(fx, fy, 18) })
    const hover = e.type === 'leave' ? 0 : nearest(fx, fy, 40)
    if (hover !== (surface.state?.hover ?? 0)) {
      surface.setState({ hover })
      surface.post({ hover })
    }
  })
  return <Box width="100%" height="100%" />
}

export default Picker
