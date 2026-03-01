import { OpenAPIRoute } from 'chanfana'
import { z } from 'zod'
import type { Context } from 'hono'

function normalizeMimeType(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed || /[\r\n]/.test(trimmed)) return undefined
  if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:\s*;\s*[\w!#$&^.+-]+=[^;\r\n]+)*$/.test(trimmed)) {
    return undefined
  }
  return trimmed
}

function buildContentDisposition(filename: string | undefined): string | undefined {
  if (!filename) return undefined
  const trimmed = filename.trim()
  if (!trimmed || /[\r\n]/.test(trimmed)) return undefined
  const asciiName = trimmed.replace(/["\\;]/g, '_')
  const encoded = encodeURIComponent(trimmed)
  return `inline; filename="${asciiName}"; filename*=UTF-8''${encoded}`
}

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
        mime_type: z.string().optional().describe('Optional MIME type for Content-Type, e.g. video/mp4'),
        filename: z.string().optional().describe('Optional filename for Content-Disposition, e.g. movie.mp4'),
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
    const mimeType = normalizeMimeType(c.req.query('mime_type'))
    const filename = c.req.query('filename')

    const fileRes = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/getFile?file_id=${fileId}`)
    const fileData = await fileRes.json() as any

    if (!fileData.ok) {
      return c.json({ success: false, error: fileData.description }, 400)
    }

    const filePath = fileData.result.file_path
    const response = await fetch(`https://api.telegram.org/file/bot${c.env.BOT_TOKEN}/${filePath}`)

    const headers = new Headers()
    headers.set('Content-Type', mimeType || response.headers.get('content-type') || 'application/octet-stream')
    const contentDisposition = buildContentDisposition(filename)
    if (contentDisposition) {
      headers.set('Content-Disposition', contentDisposition)
    }
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
