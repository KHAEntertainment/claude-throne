/**
 * Webview Syntax and Parse Error Tests
 * 
 * These tests ensure the webview JavaScript files can be parsed without syntax errors.
 * This prevents blank panels caused by duplicate case statements or other parse errors.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Webview JavaScript Syntax Tests', () => {
  it('should parse webview/main.js without SyntaxError', () => {
    // Read the webview main.js file
    const webviewPath = join(__dirname, '..', 'webview', 'main.js')
    const content = readFileSync(webviewPath, 'utf-8')
    
    // Attempt to parse as a function to detect syntax errors
    // This will throw if there are duplicate case statements or other parse errors
    expect(() => {
      // Use Function constructor to parse the code
      // Wrap in IIFE pattern like the actual webview uses
      new Function(content)
    }).not.toThrow()
  })
  
  it('should not contain duplicate case statements', () => {
    const webviewPath = join(__dirname, '..', 'webview', 'main.js')
    const content = readFileSync(webviewPath, 'utf-8')
    
    // Look for switch statements and check for duplicate cases
    // This is a simple heuristic but should catch obvious duplicates
    const switchBlocks = content.split('switch')
    
    for (const block of switchBlocks.slice(1)) { // Skip first element (before any switch)
      const caseBlock = block.split('}')[0] // Get content up to first closing brace
      const cases = caseBlock.match(/case\s+['"]([^'"]+)['"]\s*:/g) || []
      
      // Extract case values
      const caseValues = cases.map(c => {
        const match = c.match(/case\s+['"]([^'"]+)['"]\s*:/)
        return match ? match[1] : null
      }).filter(Boolean)
      
      // Check for duplicates
      const uniqueCases = new Set(caseValues)
      
      if (caseValues.length !== uniqueCases.size) {
        const duplicates = caseValues.filter((val, idx) => caseValues.indexOf(val) !== idx)
        throw new Error(`Duplicate case statement(s) found: ${duplicates.join(', ')}`)
      }
    }
  })
  
  it('should have consistent message type handling', () => {
    const webviewPath = join(__dirname, '..', 'webview', 'main.js')
    const content = readFileSync(webviewPath, 'utf-8')
    
    // Ensure canonical message types are used
    const canonicalTypes = ['keysLoaded', 'keyStored', 'modelsLoaded', 'combosLoaded']
    const legacyTypes = ['keys', 'anthropicKeyStored']
    
    for (const legacyType of legacyTypes) {
      // Check that legacy types are not in case statements
      const legacyCasePattern = new RegExp(`case\\s+['"]${legacyType}['"]\\s*:`, 'g')
      const matches = content.match(legacyCasePattern) || []
      
      if (matches.length > 0) {
        throw new Error(`Legacy message type '${legacyType}' found in case statement. Use canonical type instead.`)
      }
    }
  })
})
