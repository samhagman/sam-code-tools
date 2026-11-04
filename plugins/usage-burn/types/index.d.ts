declare module 'claude-code' {
  interface PluginState {
    'usage-burn': { isOpen: boolean; tick: number; zoomLevel: number }
  }
}
export type UsageBurn = true
