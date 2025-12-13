import { OpenAPIRoute } from 'chanfana'
import { z } from 'zod'
import type { Context } from 'hono'
import { FileInfo, buildApiUrl, parsePhotoFiles } from './telegram'

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
    const token = c.req.header('X-Api-Token')
    if (!token || token !== c.env.API_TOKEN) {
      return c.json({ success: false, error: 'Unauthorized' }, 401)
    }

    const body = await c.req.json()
    const urls = body.urls as string[]
    const caption = body.caption as string | undefined

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
      body: JSON.stringify({ chat_id: c.env.CHAT_ID, media })
    })

    const data = await res.json() as any
    if (!data.ok) {
      return c.json({ success: false, error: data.description }, 400)
    }

    const fileGroups = data.result.map((msg: any) => parsePhotoFiles(msg.photo))

    return c.json({ success: true, files: fileGroups })
  }
}
