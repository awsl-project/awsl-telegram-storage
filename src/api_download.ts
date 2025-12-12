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
    },
    responses: {
      200: {
        description: 'File stream',
        content: { 'application/octet-stream': { schema: z.any() } },
      },
    },
  }

  async handle(c: Context) {
    const fileId = c.req.param('file_id')

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

    return new Response(response.body, { status: 200, headers })
  }
}
