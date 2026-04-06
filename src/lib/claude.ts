import Anthropic from '@anthropic-ai/sdk'

export async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const client = new Anthropic({ apiKey })

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userMessage,
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude')
  }

  return content.text
}
