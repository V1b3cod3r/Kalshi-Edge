import Anthropic from '@anthropic-ai/sdk'

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
  // many markets emits opportunities + screened_out for each). 16K was too
  // tight: on a big scan, thinking alone hit the cap and no text block was ever
  // produced. Since we stream, a high ceiling costs nothing when unused
  // (billing is on actual output tokens) and only prevents truncation.
  const maxTokens = effort === 'xhigh' || effort === 'max' ? 64000 : 32000

  // Streaming prevents HTTP timeouts on long analysis/scanner responses.
  // finalMessage() collects the complete response including thinking blocks.
  const stream = client.messages.stream({
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
    ] as any,
    messages: [{ role: 'user', content: userMessage }],
  } as any)

  const message = await stream.finalMessage()

  // Adaptive thinking returns thinking blocks before the text block.
  // Always find by type rather than assuming content[0] is text.
  const textBlock = message.content.find((block: any) => block.type === 'text')
  if (!textBlock) {
    // No text block almost always means the response was truncated: thinking
    // consumed the whole budget before the answer began. Give an actionable
    // message instead of a generic one so the user knows the lever to pull.
    if ((message as any).stop_reason === 'max_tokens') {
      throw new Error(
        'The request was too large to complete within the token limit — ' +
        'reduce "Markets to scan" to 25–40 and try again.'
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

  const stream = await client.messages.stream({
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
    ] as any,
    messages: [{ role: 'user', content: userMessage }],
  } as any)

  let accumulatedText = ''
  let accumulatedThinking = ''

  for await (const event of stream) {
    if (event.type === 'content_block_delta') {
      const delta = (event as any).delta
      if (delta?.type === 'thinking_delta') {
        const chunk: string = delta.thinking || ''
        accumulatedThinking += chunk
        onThinking?.(chunk)
      } else if (delta?.type === 'text_delta') {
        const chunk: string = delta.text || ''
        accumulatedText += chunk
        onText?.(chunk)
      }
    }
  }

  return { text: accumulatedText, thinking: accumulatedThinking }
}
