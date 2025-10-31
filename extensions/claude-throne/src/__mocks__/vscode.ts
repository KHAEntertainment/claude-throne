import type * as vscode from 'vscode'

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => defaultValue,
    update: (key: string, value: any, target?: typeof ConfigurationTarget[keyof typeof ConfigurationTarget]) => Promise.resolve()
  })
}
export const window = {
  createOutputChannel: (name: string): vscode.OutputChannel => ({
    name,
    append: (value: string): void => {},
    appendLine: (message: string): void => {},
    clear: (): void => {},
    show: (columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void => {},
    hide: (): void => {},
    dispose: (): void => {},
    replace: (value: string): void => {}
  })
}
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2
}
