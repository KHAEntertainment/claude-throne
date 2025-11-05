import { promises as fs } from 'fs'
import * as path from 'path'

/**
 * Settings Architecture:
 * 
 * 1. .vscode/settings.json (workspace settings):
 *    - Extension config: claudeThrone.provider, claudeThrone.reasoningModel, etc.
 *    - Optional terminal env (only if applyToTerminal: true, defaults to false)
 *    - Purpose: Store workspace preferences for the extension
 * 
 * 2. .claude/settings.json (Claude Code runtime):
 *    - Runtime config for Claude Code extension/CLI
 *    - Always managed when autoApply: true (default)
 *    - Purpose: Configure Claude Code to use the proxy
 *    - Supports OpusPlan mode: writes ANTHROPIC_MODEL='opusplan' when enabled
 *      via claudeThrone.opusPlanMode configuration
 * 
 * Terminal env vars in .vscode/settings.json are OPTIONAL and disabled by default.
 * Most users should NOT have terminal env vars - they're only for CLI usage in integrated terminal.
 */

/**
 * Update or revert environment variables stored in a workspace's Claude settings files.
 *
 * When `revert` is false, merges `newEnv` into the `env` object of each file (`.claude/settings.json`
 * and `.claude/settings.local.json`), creating `env` if missing. When a value in `newEnv` is `null`,
 * the corresponding key is removed from the target `env`. When `revert` is true, removes the keys
 * present in `newEnv` from each file's `env` and removes `env` (and the file) if it becomes empty.
 * The function creates parent directories and files as needed.
 *
 * @param workspaceDir - Path to the workspace root that contains the `.claude` directory
 * @param newEnv - Key/value pairs to apply; keys with `null` values are deleted when merging. When `revert` is true, the keys of this object are removed from existing `env`
 * @param revert - If true, remove keys from settings instead of adding/updating them; defaults to `false`
 */
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
    
    // Process each file independently with its own scope to prevent contamination
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
            console.log(`[ClaudeSettings] Removed key from ${fileName}: ${key}`)
          }
          if (Object.keys(settings.env).length === 0) {
            delete settings.env
          }
        }
        console.log(`[ClaudeSettings] Reverted settings for ${fileName}`)
      } else {
        // CLONE the current env to prevent mutation across files
        const baseEnv = (settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env)) 
          ? { ...settings.env }
          : {}
        
        // Apply updates to THIS file's env independently
        for (const key in newEnv) {
          if (newEnv[key] === null) {
            delete baseEnv[key]
            console.log(`[ClaudeSettings] Removing key from ${fileName}: ${key}`)
          } else {
            baseEnv[key] = newEnv[key]
            console.log(`[ClaudeSettings] Setting ${key} in ${fileName}: ${baseEnv[key]}`)
          }
        }
        
        settings.env = baseEnv
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