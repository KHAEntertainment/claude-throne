import { promises as fs } from 'fs'
import * as path from 'path'

export async function updateClaudeSettings(
  workspaceDir: string,
  newEnv: Record<string, any>,
  revert = false
): Promise<void> {
  const fileNames = ['.claude/settings.json', '.claude/settings.local.json']
  
  for (const fileName of fileNames) {
    const filePath = path.join(workspaceDir, fileName)
    let settings: any = {}
    let fileExistedBefore = false

    try {
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        settings = JSON.parse(content)
        fileExistedBefore = true
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err
      }

      if (revert) {
        if (settings.env) {
          for (const key in newEnv) {
            delete settings.env[key]
          }
          if (Object.keys(settings.env).length === 0) {
            delete settings.env
          }
        }
      } else {
        settings.env = { ...(settings.env || {}), ...newEnv }
      }

      const dir = path.dirname(filePath)
      await fs.mkdir(dir, { recursive: true })

      if (Object.keys(settings).length > 0) {
        await fs.writeFile(filePath, JSON.stringify(settings, null, 2))
      } else if (fileExistedBefore && Object.keys(settings).length === 0 && revert) {
        try {
          await fs.unlink(filePath)
        } catch (err) {
          // Ignore errors if file doesn't exist
        }
      }
    } catch (error) {
      console.error(`Failed to update ${fileName}:`, error)
    }
  }
}
