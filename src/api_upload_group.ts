import { OpenAPIRoute } from 'chanfana'
import { z } from 'zod'
import type { Context } from 'hono'
import { FileInfo, buildApiUrl, parsePhotoFiles } from './telegram'
import { validateAuth } from './auth'

export class MediaGroupUploadEndpoint extends OpenAPIRoute {
  schema = {
    tags: ['File'],
    summary: 'Upload media group to Telegram',
    request: {
      headers: z.object({
        'x-api-token': z.string(),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              urls: z.array(z.string()).min(1).max(10).describe('Array of URLs (1-10)'),
              caption: z.string().optional().describe('Caption for the first media'),
              chat_id: z.string().optional().describe('Telegram chat ID (defaults to env CHAT_ID)'),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              files: z.array(z.array(FileInfo)),
            }),
          },
        },
      },
    },
  }

  async handle(c: Context) {
    // Validate API_TOKEN or JWT
    const auth = await validateAuth(c)
    if (!auth.success) {
      return c.json({ success: false, error: auth.error || 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    const urls = body.urls as string[]
    const caption = body.caption as string | undefined
    const chatId = body.chat_id as string || c.env.CHAT_ID

    if (!urls || urls.length < 1) {
      return c.json({ success: false, error: 'At least 1 URL required' }, 400)
    }

    const media = urls.map((url, i) => ({
      type: 'photo',
      media: url,
      caption: i === 0 ? caption : undefined,
    }))

    const apiUrl = buildApiUrl(c.env.BOT_TOKEN, 'sendMediaGroup')
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, media })
    })

    const data = await res.json() as any
    if (!data.ok) {
      return c.json({ success: false, error: data.description }, 400)
    }

    const fileGroups = data.result.map((msg: any) => parsePhotoFiles(msg.photo))

    return c.json({ success: true, files: fileGroups })
  }
}
