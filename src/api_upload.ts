import { OpenAPIRoute } from 'chanfana'
import { z } from 'zod'
import type { Context } from 'hono'

export class FileUploadEndpoint extends OpenAPIRoute {
  schema = {
    tags: ['File'],
    summary: 'Upload file to Telegram',
    request: {
      headers: z.object({
        'x-api-token': z.string(),
      }),
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              file: z.any().optional().describe('File to upload'),
              url: z.string().optional().describe('URL of file to upload'),
              type: z.enum(['photo', 'document']).optional().default('document').describe('File type'),
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
              file_id: z.string(),
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

    const body = await c.req.parseBody()
    const file = body['file']
    const url = body['url'] as string | undefined
    const type = (body['type'] as string) || 'document'

    if (file instanceof File) {
      const formData = new FormData()
      formData.append('chat_id', c.env.CHAT_ID)

      if (type === 'photo') {
        formData.append('photo', file, file.name)
        const res = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/sendPhoto`, {
          method: 'POST',
          body: formData
        })
        const data = await res.json() as any
        if (!data.ok) {
          return c.json({ success: false, error: data.description }, 400)
        }
        const photo = data.result.photo[data.result.photo.length - 1]
        return c.json({ success: true, file_id: photo.file_id })
      } else {
        formData.append('document', file, file.name)
        const res = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/sendDocument`, {
          method: 'POST',
          body: formData
        })
        const data = await res.json() as any
        if (!data.ok) {
          return c.json({ success: false, error: data.description }, 400)
        }
        return c.json({ success: true, file_id: data.result.document.file_id })
      }
    } else if (url) {
      if (type === 'photo') {
        const res = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: c.env.CHAT_ID, photo: url })
        })
        const data = await res.json() as any
        if (!data.ok) {
          return c.json({ success: false, error: data.description }, 400)
        }
        const photo = data.result.photo[data.result.photo.length - 1]
        return c.json({ success: true, file_id: photo.file_id })
      } else {
        const res = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/sendDocument`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: c.env.CHAT_ID, document: url })
        })
        const data = await res.json() as any
        if (!data.ok) {
          return c.json({ success: false, error: data.description }, 400)
        }
        return c.json({ success: true, file_id: data.result.document.file_id })
      }
    }
    return c.json({ success: false, error: 'No file or URL provided' }, 400)
  }
}
