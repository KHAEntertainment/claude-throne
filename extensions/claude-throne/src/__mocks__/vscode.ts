export const workspace = {
  getConfiguration: () => ({
    get: () => undefined,
    update: () => Promise.resolve()
  })
}
export const window = {
  createOutputChannel: () => ({
    appendLine: () => {},
    clear: () => {},
    dispose: () => {}
  })
}
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2
}
