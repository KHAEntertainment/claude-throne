import { describe, it, expect } from 'vitest'

import { validateWebviewMessage } from '../extensions/claude-throne/src/schemas/messages.ts'

describe('Webview toggle mode message schema', () => {
  it('accepts canonical toggleThreeModelMode message', () => {
    const message = { type: 'toggleThreeModelMode', enabled: true }

    expect(() => validateWebviewMessage(message)).not.toThrow()
  })

  it('accepts legacy toggleTwoModelMode message', () => {
    const message = { type: 'toggleTwoModelMode', enabled: false }

    expect(() => validateWebviewMessage(message)).not.toThrow()
  })

  it('accepts toggleOpusPlan message', () => {
    const message = { type: 'toggleOpusPlan', enabled: true }

    expect(() => validateWebviewMessage(message)).not.toThrow()
  })

  it('rejects toggleThreeModelMode without enabled flag', () => {
    const message = { type: 'toggleThreeModelMode' } as any

    expect(() => validateWebviewMessage(message)).toThrow()
  })

  it('rejects toggleOpusPlan without enabled flag', () => {
    const message = { type: 'toggleOpusPlan' } as any

    expect(() => validateWebviewMessage(message)).toThrow()
  })
})

