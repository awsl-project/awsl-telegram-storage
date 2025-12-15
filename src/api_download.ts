import { OpenAPIRoute } from 'chanfana'
import { z } from 'zod'
import type { Context } from 'hono'

export class FileDownloadEndpoint extends OpenAPIRoute {
  schema = {
    tags: ['File'],
    summary: 'Download file from Telegram',
    request: {
      params: z.object({
        file_id: z.string(),
      }),
      query: z.object({
        cache: z.enum(['true', 'false']).optional().default('true').describe('Enable browser caching (default: true)'),
      }),
    },
    responses: {
      200: {
        description: 'File stream with cache control headers (X-Cache-Status: ENABLED/DISABLED)',
        content: { 'application/octet-stream': { schema: z.any() } },
      },
    },
  }

  async handle(c: Context) {
    const fileId = c.req.param('file_id')
    const enableCache = c.req.query('cache') !== 'false'

    const fileRes = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/getFile?file_id=${fileId}`)
    const fileData = await fileRes.json() as any

    if (!fileData.ok) {
      return c.json({ success: false, error: fileData.description }, 400)
    }

    const filePath = fileData.result.file_path
    const response = await fetch(`https://api.telegram.org/file/bot${c.env.BOT_TOKEN}/${filePath}`)

    const headers = new Headers()
    headers.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream')
    if (response.headers.get('content-length')) {
      headers.set('Content-Length', response.headers.get('content-length')!)
    }

    if (enableCache) {
      // Enable browser caching for 7 days
      headers.set('Cache-Control', 'public, max-age=604800, immutable')
      headers.set('X-Cache-Status', 'ENABLED')
    } else {
      // Disable browser caching
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
      headers.set('X-Cache-Status', 'DISABLED')
    }

    return new Response(response.body, { status: 200, headers })
  }
}
