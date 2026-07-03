import { NextRequest } from 'next/server'
import { runScan, ScanError } from '@/lib/scan'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      }

      try {
        const body = await req.json()
        const {
          category,
          limit = 15,
          min_volume = 0,
        }: {
          category?: string
          limit?: number
          min_volume?: number
        } = body

        const result = await runScan({
          category,
          limit,
          min_volume,
          onProgress: (event) => {
            send({ type: 'progress', ...event })
          },
        })

        send({
          type: 'done',
          opportunities: result.opportunities,
          screened_out: result.screened_out,
          session_notes: result.session_notes,
          markets_scanned: result.markets_scanned,
        })
        controller.close()
      } catch (error: any) {
        if (!(error instanceof ScanError)) {
          console.error('Auto-scan stream error:', error)
        }
        try {
          send({ type: 'error', message: error?.message || 'Auto-scan failed' })
        } catch {
          // controller may already be closed
        }
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
