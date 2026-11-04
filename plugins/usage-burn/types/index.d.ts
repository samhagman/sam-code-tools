declare module 'claude-code' {
  interface PluginState {
    'usage-burn': { isOpen: boolean; tick: number; zoom: number }
  }
}
export type UsageBurn = true
