import { describe, it, expect, vi, beforeEach } from 'vitest'

// callClaude uses the streaming API (client.messages.stream(...).finalMessage())
// to avoid HTTP timeouts on long scanner/analysis responses. The mock captures
// the request params and returns a MessageStream-like object.
const mockStream = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = {
      stream: (params: any) => ({ finalMessage: () => mockStream(params) }),
    }
    constructor(_opts: any) {}
  },
}))

describe('callClaude', () => {
  beforeEach(() => {
    vi.resetModules()
    mockStream.mockReset()
  })

  it('returns text from a successful response', async () => {
    mockStream.mockResolvedValue({
      content: [{ type: 'text', text: 'Analysis complete' }],
    })
    const { callClaude } = await import('@/lib/claude')

    const result = await callClaude('sk-test', 'system prompt', 'user message')
    expect(result).toBe('Analysis complete')
  })

  it('returns the text block even when thinking blocks precede it', async () => {
    // Adaptive thinking puts thinking blocks before the text block —
    // callClaude must find the text block by type, not assume content[0].
    mockStream.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'Let me reason about this...' },
        { type: 'text', text: 'Final answer' },
      ],
    })
    const { callClaude } = await import('@/lib/claude')

    const result = await callClaude('sk-test', 'sys', 'msg')
    expect(result).toBe('Final answer')
  })

  it('passes system prompt as a cache-controlled block and user message to the API', async () => {
    mockStream.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    })
    const { callClaude } = await import('@/lib/claude')

    await callClaude('sk-key', 'my system prompt', 'my user message')

    const callArgs = mockStream.mock.calls[0][0]
    // System prompt is sent as a block array with ephemeral caching
    expect(Array.isArray(callArgs.system)).toBe(true)
    expect(callArgs.system[0].type).toBe('text')
    expect(callArgs.system[0].text).toBe('my system prompt')
    expect(callArgs.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(callArgs.messages[0].content).toBe('my user message')
    expect(callArgs.messages[0].role).toBe('user')
  })

  it('uses the claude-opus-4-8 model', async () => {
    mockStream.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    })
    const { callClaude } = await import('@/lib/claude')

    await callClaude('sk-key', 'sys', 'msg')

    const callArgs = mockStream.mock.calls[0][0]
    expect(callArgs.model).toBe('claude-opus-4-8')
  })

  it('uses max_tokens 32000 with adaptive thinking at default effort', async () => {
    // 32K (not 16K) so adaptive thinking on a large scan can't consume the
    // whole budget before the JSON answer — the "unexpected response" bug.
    mockStream.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    })
    const { callClaude } = await import('@/lib/claude')

    await callClaude('sk-key', 'sys', 'msg')

    const callArgs = mockStream.mock.calls[0][0]
    expect(callArgs.max_tokens).toBe(32000)
    expect(callArgs.thinking).toEqual({ type: 'adaptive' })
  })

  it('raises max_tokens to 64000 at xhigh/max effort so thinking cannot truncate the answer', async () => {
    mockStream.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    })
    const { callClaude } = await import('@/lib/claude')

    await callClaude('sk-key', 'sys', 'msg', { effort: 'max' })
    expect(mockStream.mock.calls[0][0].max_tokens).toBe(64000)

    await callClaude('sk-key', 'sys', 'msg', { effort: 'xhigh' })
    expect(mockStream.mock.calls[1][0].max_tokens).toBe(64000)
  })

  it('honors an explicit maxTokens override, clamped to [4096, 128000]', async () => {
    mockStream.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    })
    const { callClaude } = await import('@/lib/claude')

    // Scaled request (e.g. a 40-market scan) exceeds the flat effort default
    await callClaude('sk-key', 'sys', 'msg', { maxTokens: 72000 })
    expect(mockStream.mock.calls[0][0].max_tokens).toBe(72000)

    // Clamped at the model ceiling, never sent above it
    await callClaude('sk-key', 'sys', 'msg', { maxTokens: 500000 })
    expect(mockStream.mock.calls[1][0].max_tokens).toBe(128000)

    // Clamped at the floor, never sent below it
    await callClaude('sk-key', 'sys', 'msg', { maxTokens: 100 })
    expect(mockStream.mock.calls[2][0].max_tokens).toBe(4096)
  })

  it('surfaces the token limit that was actually used when a response truncates', async () => {
    mockStream.mockResolvedValue({
      content: [],
      stop_reason: 'max_tokens',
    })
    const { callClaude } = await import('@/lib/claude')

    await expect(callClaude('sk-key', 'sys', 'msg', { maxTokens: 60000 })).rejects.toThrow(
      /60,000-token/
    )
  })

  it('defaults effort to high and honors an explicit effort override', async () => {
    mockStream.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    })
    const { callClaude } = await import('@/lib/claude')

    await callClaude('sk-key', 'sys', 'msg')
    expect(mockStream.mock.calls[0][0].output_config).toEqual({ effort: 'high' })

    await callClaude('sk-key', 'sys', 'msg', { effort: 'max' })
    expect(mockStream.mock.calls[1][0].output_config).toEqual({ effort: 'max' })
  })

  it('throws when the response contains no text block', async () => {
    mockStream.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tool-1', name: 'some_tool', input: {} }],
    })
    const { callClaude } = await import('@/lib/claude')

    await expect(callClaude('sk-key', 'sys', 'msg')).rejects.toThrow(
      'Unexpected response type from Claude'
    )
  })

  it('propagates API errors', async () => {
    mockStream.mockRejectedValue(new Error('Rate limit exceeded'))
    const { callClaude } = await import('@/lib/claude')

    await expect(callClaude('sk-key', 'sys', 'msg')).rejects.toThrow('Rate limit exceeded')
  })
})
