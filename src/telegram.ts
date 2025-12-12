import { z } from 'zod'

export const FileInfo = z.object({
  file_id: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
})

export const ENDPOINT_MAP: Record<string, string> = {
  photo: 'sendPhoto',
  document: 'sendDocument',
}

export function buildApiUrl(botToken: string, endpoint: string): string {
  return `https://api.telegram.org/bot${botToken}/${endpoint}`
}

export function parsePhotoFiles(photos: any[]) {
  return photos.map((p: any) => ({ file_id: p.file_id, width: p.width, height: p.height }))
}

export function parseDocumentFile(document: any) {
  return [{ file_id: document.file_id }]
}
