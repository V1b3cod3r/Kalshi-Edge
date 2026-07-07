import Anthropic from '@anthropic-ai/sdk'

// A streaming request to Claude can hold a connection open for 30-60+ seconds
// on a large scan — exactly the kind of long-lived connection a flaky Wi-Fi,
// VPN, or proxy drops mid-stream. Unlike kalshi.ts's short-lived request/
// response calls, nothing here retried a dropped connection, so the raw
// unwrapped Node error (e.g. "read ECONNRESET") reached the user directly.
// Retries only cover connection-level failures — never a genuine API error
// (bad key, rate limit, content policy) or our own "no text block" checks,
// which retrying blindly would not fix and would just waste tokens on.
const MAX_CLAUDE_RETRIES = 2
const RETRY_BASE_DELAY_MS = 1000

function isRetryableNetworkError(err: any): boolean {
  const code = err?.cause?.code ?? err?.code
  const msg = String(err?.message ?? err?.cause?.message ?? '')
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE' ||
    code === 'ENOTFOUND' ||
    err?.name === 'AbortError' ||
    err?.name === 'APIConnectionError' ||
    /fetch failed/i.test(msg) ||
    /network/i.test(msg) ||
    /socket hang up/i.test(msg) ||
    /ECONNRESET/i.test(msg)
  )
}

// Streams can't be resumed mid-flight, so "retry" means re-issuing the whole
// request from scratch. Safe here because callClaude/callClaudeStream are
// read-only analysis calls with no side effects — never used for placeOrder.
async function streamFinalMessageWithRetry(
  client: Anthropic,
  params: Record<string, any>
): Promise<any> {
  let lastErr: any
  for (let attempt = 0; attempt <= MAX_CLAUDE_RETRIES; attempt++) {
    try {
      const stream = client.messages.stream(params as any)
      return await stream.finalMessage()
    } catch (err: any) {
      lastErr = err
      if (!isRetryableNetworkError(err)) {
        throw err // a real API error (bad key, rate limit, etc.) — never retry
      }
      if (attempt >= MAX_CLAUDE_RETRIES) {
        throw new Error(
          `Connection to Claude was interrupted after ${attempt + 1} attempt(s): ` +
          `${err?.message || err}. This is usually a network blip — check your ` +
          'connection and try again.'
        )
      }
      await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** attempt))
    }
  }
  throw lastErr
}

export interface ClaudeOptions {
  // Controls reasoning depth and token spend. 'high' is the default; 'max' for
  // the deepest analysis (slower, pricier). 'xhigh' is Opus 4.7-specific between
  // high and max. Maps to output_config.effort on 4.7.
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  // Model override. Default is Opus 4.8 (deep analysis). The scanner may pass
  // Sonnet 5 for breadth triage — ~2.5x cheaper per token, near-Opus on this
  // kind of structured estimation; both models share the same request shape
  // (adaptive thinking + output_config.effort).
  model?: string
  // When set, the API constrains the response to this JSON Schema (structured
  // outputs). Guarantees parseable JSON — no markdown fences, no prose
  // preamble — eliminating "unexpected format" failures at the source.
  jsonSchema?: Record<string, any>
  // Explicit output-token ceiling, overriding the effort-based default below.
  // Callers whose response size scales with an input (e.g. the scanner: one
  // rationale/reason per market) should compute this from that input rather
  // than rely on a flat per-effort number — a fixed ceiling was too small on
  // larger batches regardless of effort level. Clamped to [4096, 128000].
  maxTokens?: number
}

export interface StreamCallbacks {
  onThinking?: (chunk: string) => void
  onText?: (chunk: string) => void
}

export async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options: ClaudeOptions = {}
): Promise<string> {
  const client = new Anthropic({ apiKey })
  const { effort = 'high', model = 'claude-opus-4-8', jsonSchema } = options

  // Adaptive thinking spends output tokens on reasoning BEFORE the answer, so
  // the ceiling must cover thinking + a potentially large JSON body (a scan of
  // many markets emits opportunities + screened_out for each). A flat number
  // here was too small on large batches regardless of effort — the caller
  // should pass maxTokens explicitly when response size scales with an input.
  // Since we stream, a high ceiling costs nothing when unused (billing is on
  // actual output tokens) and only prevents truncation.
  const defaultMaxTokens = effort === 'xhigh' || effort === 'max' ? 64000 : 32000
  const maxTokens = Math.min(128000, Math.max(4096, options.maxTokens ?? defaultMaxTokens))

  // Streaming prevents HTTP timeouts on long analysis/scanner responses.
  // finalMessage() collects the complete response including thinking blocks.
  const message = await streamFinalMessageWithRetry(client, {
    model,
    max_tokens: maxTokens,
    // Adaptive thinking: Opus 4.7+ only supports adaptive (not enabled+budget_tokens).
    // Claude decides when and how much to think based on task complexity.
    thinking: { type: 'adaptive' } as any,
    output_config: {
      effort,
      ...(jsonSchema ? { format: { type: 'json_schema', schema: jsonSchema } } : {}),
    } as any,
    // Cache the system prompt — the analysis/scanner prompts are 3K+ tokens and
    // stable within a session, so caching saves ~90% of those input tokens on
    // repeated calls (scanner iterates the same prompt across many markets).
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  })

  // Adaptive thinking returns thinking blocks before the text block.
  // Always find by type rather than assuming content[0] is text.
  const textBlock = message.content.find((block: any) => block.type === 'text')
  if (!textBlock) {
    // No text block almost always means the response was truncated: thinking
    // consumed the whole budget before the answer began. Give an actionable
    // message instead of a generic one so the user knows the lever to pull.
    if ((message as any).stop_reason === 'max_tokens') {
      throw new Error(
        `The response hit the ${maxTokens.toLocaleString()}-token output limit before finishing — ` +
        'reduce "Markets to scan" (or the size of the request) and try again.'
      )
    }
    throw new Error('Unexpected response type from Claude (no text output)')
  }

  return (textBlock as any).text
}

export async function callClaudeStream(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options: ClaudeOptions & StreamCallbacks = {}
): Promise<{ text: string; thinking: string }> {
  const client = new Anthropic({ apiKey })
  const { effort = 'high', onThinking, onText } = options

  const requestParams = {
    model: 'claude-opus-4-8',
    // Match callClaude's headroom so adaptive thinking never starves the answer.
    max_tokens: effort === 'xhigh' || effort === 'max' ? 64000 : 32000,
    // 'summarized' display shows the user a condensed view of Claude's reasoning
    thinking: { type: 'adaptive', display: 'summarized' } as any,
    output_config: { effort } as any,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  }

  let accumulatedText = ''
  let accumulatedThinking = ''

  for (let attempt = 0; attempt <= MAX_CLAUDE_RETRIES; attempt++) {
    // Fresh accumulators per attempt: only a clean failure before any content
    // streamed (below) is eligible for retry, so nothing here is ever partial.
    accumulatedText = ''
    accumulatedThinking = ''
    let emittedAny = false
    try {
      const stream = await client.messages.stream(requestParams as any)
      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          const delta = (event as any).delta
          if (delta?.type === 'thinking_delta') {
            emittedAny = true
            const chunk: string = delta.thinking || ''
            accumulatedThinking += chunk
            onThinking?.(chunk)
          } else if (delta?.type === 'text_delta') {
            emittedAny = true
            const chunk: string = delta.text || ''
            accumulatedText += chunk
            onText?.(chunk)
          }
        }
      }
      return { text: accumulatedText, thinking: accumulatedThinking }
    } catch (err: any) {
      // A connection drop after content already reached the UI can't be
      // silently retried — the caller would see streamed text reset/duplicate.
      // Surface a clear error instead of a raw one and stop.
      if (emittedAny || !isRetryableNetworkError(err) || attempt >= MAX_CLAUDE_RETRIES) {
        if (isRetryableNetworkError(err)) {
          throw new Error(
            `Connection to Claude was interrupted${emittedAny ? ' mid-response' : ''} — ` +
            `${err?.message || err}. This is usually a network blip — try again.`
          )
        }
        throw err
      }
      await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** attempt))
    }
  }

  // Unreachable — every loop iteration returns or throws.
  return { text: accumulatedText, thinking: accumulatedThinking }
}
