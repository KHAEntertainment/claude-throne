import { promises as fs } from 'fs'
import * as path from 'path'

export async function updateClaudeSettings(
  workspaceDir: string,
  newEnv: Record<string, any>,
  revert = false
): Promise<void> {
  const fileNames = ['.claude/settings.json', '.claude/settings.local.json']
  
  console.log(`[ClaudeSettings] ${revert ? 'Reverting' : 'Updating'} settings in: ${workspaceDir}`)
  console.log(`[ClaudeSettings] Environment variables to ${revert ? 'remove' : 'write'}: ${JSON.stringify(newEnv, null, 2)}`)
  
  for (const fileName of fileNames) {
    const filePath = path.join(workspaceDir, fileName)
    let settings: any = {}
    let fileExistedBefore = false

    try {
      console.log(`[ClaudeSettings] Processing file: ${filePath}`)
      
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        settings = JSON.parse(content)
        fileExistedBefore = true
        console.log(`[ClaudeSettings] Existing settings loaded from ${fileName}`)
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.error(`[ClaudeSettings] Error reading ${fileName}:`, err)
          throw err
        }
        console.log(`[ClaudeSettings] File ${fileName} does not exist, will create new`)
      }

      if (revert) {
        if (settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env)) {
          for (const key in newEnv) {
            delete settings.env[key]
          }
          if (Object.keys(settings.env).length === 0) {
            delete settings.env
          }
        }
        console.log(`[ClaudeSettings] Reverted settings for ${fileName}`)
      } else {
        const baseEnv = (settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env)) ? settings.env : {}
        // Apply updates, removing keys with null values
        const updatedEnv = { ...baseEnv }
        for (const key in newEnv) {
          if (newEnv[key] === null) {
            delete updatedEnv[key]
            console.log(`[ClaudeSettings] Removing key: ${key}`)
          } else {
            updatedEnv[key] = newEnv[key]
          }
        }
        settings.env = updatedEnv
        console.log(`[ClaudeSettings] Updated settings.env for ${fileName}: ${JSON.stringify(settings.env, null, 2)}`)
      }

      const dir = path.dirname(filePath)
      await fs.mkdir(dir, { recursive: true })
      console.log(`[ClaudeSettings] Created/verified directory: ${dir}`)

      if (Object.keys(settings).length > 0) {
        const fileContent = JSON.stringify(settings, null, 2)
        console.log(`[ClaudeSettings] Writing to ${filePath}`)
        console.log(`[ClaudeSettings] Content:\n${fileContent}`)
        await fs.writeFile(filePath, fileContent)
        console.log(`[ClaudeSettings] ✅ Successfully wrote ${fileName}`)
      } else if (fileExistedBefore && Object.keys(settings).length === 0 && revert) {
        try {
          await fs.unlink(filePath)
          console.log(`[ClaudeSettings] Deleted empty file ${fileName}`)
        } catch (err) {
          // Ignore errors if file doesn't exist
          console.log(`[ClaudeSettings] Could not delete ${fileName} (may not exist)`)
        }
      }
    } catch (error) {
      const errorMsg = `Failed to update ${fileName}: ${error}`
      console.error(`[ClaudeSettings] ERROR: ${errorMsg}`)
      throw new Error(errorMsg)
    }
  }
  
  console.log('[ClaudeSettings] All files processed successfully')
}
