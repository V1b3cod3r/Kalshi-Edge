import Anthropic from '@anthropic-ai/sdk'

export interface ClaudeOptions {
  // Controls reasoning depth and token spend. 'high' is the default; 'max' for
  // the deepest analysis (slower, pricier). Maps to output_config.effort on 4.7.
  effort?: 'low' | 'medium' | 'high' | 'max'
}

export async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options: ClaudeOptions = {}
): Promise<string> {
  const client = new Anthropic({ apiKey })
  const { effort = 'high' } = options

  // Streaming prevents HTTP timeouts on long analysis/scanner responses.
  // finalMessage() collects the complete response including thinking blocks.
  const stream = client.messages.stream({
    model: 'claude-opus-4-7',
    max_tokens: 16000,
    // Adaptive thinking: Opus 4.7 only supports adaptive (not enabled+budget_tokens).
    // Claude decides when and how much to think based on task complexity.
    thinking: { type: 'adaptive' } as any,
    output_config: { effort } as any,
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
    throw new Error('Unexpected response type from Claude')
  }

  return (textBlock as any).text
}
