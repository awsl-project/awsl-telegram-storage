import { OpenAPIRoute } from 'chanfana'
import { z } from 'zod'
import type { Context } from 'hono'

const FileInfo = z.object({
  file_id: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
})

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
              media_type: z.enum(['photo', 'document']).optional().default('photo').describe('Media type'),
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
              files: z.array(FileInfo),
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
    const mediaType = (body['media_type'] as string) || 'photo'

    if (!file && !url) {
      return c.json({ success: false, error: 'No file or URL provided' }, 400)
    }

    const endpoint = mediaType === 'photo' ? 'sendPhoto' : 'sendDocument'
    const apiUrl = `https://api.telegram.org/bot${c.env.BOT_TOKEN}/${endpoint}`
    const fetchOptions = this.buildFetchOptions(c.env.CHAT_ID, mediaType, file, url)

    const res = await fetch(apiUrl, fetchOptions)
    const data = await res.json() as any

    if (!data.ok) {
      return c.json({ success: false, error: data.description }, 400)
    }

    return c.json({ success: true, files: this.parseFiles(data.result, mediaType) })
  }

  private buildFetchOptions(chatId: string, mediaType: string, file: unknown, url?: string): RequestInit {
    if (file instanceof File) {
      const formData = new FormData()
      formData.append('chat_id', chatId)
      formData.append(mediaType, file, file.name)
      return { method: 'POST', body: formData }
    }
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, [mediaType]: url })
    }
  }

  private parseFiles(result: any, mediaType: string) {
    if (mediaType === 'photo') {
      return result.photo.map((p: any) => ({ file_id: p.file_id, width: p.width, height: p.height }))
    }
    return [{ file_id: result.document.file_id }]
  }
}
