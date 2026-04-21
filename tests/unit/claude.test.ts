import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: mockCreate }
    constructor(_opts: any) {}
  },
}))

describe('callClaude', () => {
  beforeEach(() => {
    vi.resetModules()
    mockCreate.mockReset()
  })

  it('returns text from a successful response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Analysis complete' }],
    })
    const { callClaude } = await import('@/lib/claude')

    const result = await callClaude('sk-test', 'system prompt', 'user message')
    expect(result).toBe('Analysis complete')
  })

  it('passes system prompt and user message to the API', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    })
    const { callClaude } = await import('@/lib/claude')

    await callClaude('sk-key', 'my system prompt', 'my user message')

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.system).toBe('my system prompt')
    expect(callArgs.messages[0].content).toBe('my user message')
    expect(callArgs.messages[0].role).toBe('user')
  })

  it('uses the claude-sonnet-4-6 model', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    })
    const { callClaude } = await import('@/lib/claude')

    await callClaude('sk-key', 'sys', 'msg')

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.model).toBe('claude-sonnet-4-6')
  })

  it('uses max_tokens 4096', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    })
    const { callClaude } = await import('@/lib/claude')

    await callClaude('sk-key', 'sys', 'msg')

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.max_tokens).toBe(4096)
  })

  it('throws when content type is not text', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tool-1', name: 'some_tool', input: {} }],
    })
    const { callClaude } = await import('@/lib/claude')

    await expect(callClaude('sk-key', 'sys', 'msg')).rejects.toThrow(
      'Unexpected response type from Claude'
    )
  })

  it('propagates API errors', async () => {
    mockCreate.mockRejectedValue(new Error('Rate limit exceeded'))
    const { callClaude } = await import('@/lib/claude')

    await expect(callClaude('sk-key', 'sys', 'msg')).rejects.toThrow('Rate limit exceeded')
  })
})
