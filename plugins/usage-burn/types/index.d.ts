declare module 'claude-code' {
  interface PluginState {
    'usage-burn': { isOpen: boolean; tick: number; zoomIdx: number }
  }
}
export type UsageBurn = true
