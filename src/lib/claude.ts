import Anthropic from '@anthropic-ai/sdk'

export interface ClaudeOptions {
  extendedThinking?: boolean
  thinkingBudget?: number  // token budget for thinking (default 8000)
}

export async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options: ClaudeOptions = {}
): Promise<string> {
  const client = new Anthropic({ apiKey })

  const { extendedThinking = false, thinkingBudget = 8000 } = options

  const createParams: any = {
    model: 'claude-sonnet-4-6',
    max_tokens: extendedThinking ? Math.max(16000, thinkingBudget * 2) : 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  }

  if (extendedThinking) {
    createParams.thinking = { type: 'enabled', budget_tokens: thinkingBudget }
  }

  const message = await client.messages.create(createParams)

  // Extended thinking returns multiple content blocks (thinking + text).
  // Always find the first text block rather than assuming content[0] is text.
  const textBlock = message.content.find((block: any) => block.type === 'text')
  if (!textBlock || (textBlock as any).type !== 'text') {
    throw new Error('Unexpected response type from Claude')
  }

  return (textBlock as any).text
}
