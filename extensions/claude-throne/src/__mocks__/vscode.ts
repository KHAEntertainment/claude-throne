export const workspace = {
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => defaultValue,
    update: (key: string, value: any, target?: typeof ConfigurationTarget[keyof typeof ConfigurationTarget]) => Promise.resolve()
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
