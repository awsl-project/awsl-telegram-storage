import { OpenAPIRoute } from 'chanfana'
import { z } from 'zod'
import type { Context } from 'hono'
import { validateAuth } from './auth'
import { buildApiUrl } from './telegram'

/**
 * Chunk information returned for each uploaded chunk
 */
const ChunkInfo = z.object({
  chunk_index: z.number(),
  file_id: z.string(),
  file_size: z.number(),
  file_name: z.string(),
})

/**
 * True streaming file upload endpoint with chunking
 * Reads file stream incrementally and uploads chunks to Telegram in parallel
 * This allows uploading large files without loading entire file into memory
 */
export class StreamingUploadEndpoint extends OpenAPIRoute {
  schema = {
    tags: ['File'],
    summary: 'Streaming upload with automatic chunking',
    description: 'Upload files with true streaming support. The file is read in chunks (default 10MB) and uploaded to Telegram progressively. Supports files larger than 50MB by splitting into multiple documents.',
    request: {
      headers: z.object({
        'x-api-token': z.string().describe('API Token or JWT for authentication'),
        'content-type': z.string().optional().describe('Should be multipart/form-data'),
      }),
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              file: z.any().describe('File to upload (required)'),
              chat_id: z.string().optional().describe('Telegram chat ID (defaults to env CHAT_ID)'),
              chunk_size: z.string().optional().describe('Chunk size in bytes (default: 10MB, max: 50MB)'),
              filename: z.string().optional().describe('Original filename'),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Success - File uploaded in chunks',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              total_size: z.number(),
              chunk_size: z.number(),
              total_chunks: z.number(),
              chunks: z.array(ChunkInfo),
              filename: z.string(),
            }),
          },
        },
      },
      400: {
        description: 'Bad Request',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
            }),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
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

    try {
      // Parse multipart form data
      const body = await c.req.parseBody()
      const file = body['file']
      // Use chat_id from request body, fallback to token chat_id, then env CHAT_ID
      const chatId = (body['chat_id'] as string) || auth.chatId || c.env.CHAT_ID
      const chunkSizeParam = body['chunk_size'] as string | undefined
      const filename = (body['filename'] as string) || (file instanceof File ? file.name : 'unknown')

      // Validate file is provided
      if (!file || !(file instanceof File)) {
        return c.json({ success: false, error: 'File is required for streaming upload' }, 400)
      }

      // Parse and validate chunk size
      const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024 // 10MB
      const MAX_CHUNK_SIZE = 50 * 1024 * 1024 // 50MB (Telegram limit)
      let chunkSize = DEFAULT_CHUNK_SIZE

      if (chunkSizeParam) {
        chunkSize = parseInt(chunkSizeParam, 10)
        if (isNaN(chunkSize) || chunkSize <= 0) {
          return c.json({ success: false, error: 'Invalid chunk_size parameter' }, 400)
        }
        if (chunkSize > MAX_CHUNK_SIZE) {
          return c.json(
            {
              success: false,
              error: `Chunk size cannot exceed 50MB. Requested: ${chunkSize} bytes`,
            },
            400
          )
        }
      }

      // Process file with streaming
      const result = await this.processFileStream(file, filename, chunkSize, chatId, c.env.BOT_TOKEN)

      return c.json(result)
    } catch (error) {
      console.error('Streaming upload error:', error)
      return c.json(
        {
          success: false,
          error: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
        500
      )
    }
  }

  /**
   * Process file stream and upload chunks
   * Reads the file incrementally and uploads each chunk as it's read
   */
  private async processFileStream(
    file: File,
    filename: string,
    chunkSize: number,
    chatId: string,
    botToken: string
  ): Promise<any> {
    const fileSize = file.size
    const totalChunks = Math.ceil(fileSize / chunkSize)
    const apiUrl = buildApiUrl(botToken, 'sendDocument')

    const chunks: Array<{
      chunk_index: number
      file_id: string
      file_size: number
      file_name: string
    }> = []

    // Read and upload file in chunks
    let chunkIndex = 0
    let bytesRead = 0

    // Get file stream
    const stream = file.stream()
    const reader = stream.getReader()

    let buffer = new Uint8Array(0)

    try {
      while (true) {
        const { done, value } = await reader.read()

        // Append new data to buffer
        if (value) {
          const newBuffer = new Uint8Array(buffer.length + value.length)
          newBuffer.set(buffer)
          newBuffer.set(value, buffer.length)
          buffer = newBuffer
        }

        // Process complete chunks or final chunk
        while (buffer.length >= chunkSize || (done && buffer.length > 0)) {
          const currentChunkSize = Math.min(chunkSize, buffer.length)
          const chunkData = buffer.slice(0, currentChunkSize)
          buffer = buffer.slice(currentChunkSize)

          // Upload this chunk
          const chunkBlob = new Blob([chunkData])
          const chunkFilename = totalChunks > 1 ? `${filename}.part${chunkIndex + 1}` : filename

          const formData = new FormData()
          formData.append('chat_id', chatId)
          formData.append('document', chunkBlob, chunkFilename)

          // Upload chunk to Telegram
          const res = await fetch(apiUrl, {
            method: 'POST',
            body: formData,
          })

          const data = (await res.json()) as any

          if (!data.ok) {
            throw new Error(`Failed to upload chunk ${chunkIndex + 1}/${totalChunks}: ${data.description}`)
          }

          // Store chunk info
          chunks.push({
            chunk_index: chunkIndex,
            file_id: data.result.document.file_id,
            file_size: currentChunkSize,
            file_name: chunkFilename,
          })

          bytesRead += currentChunkSize
          chunkIndex++

          // If done and no more data, break
          if (done && buffer.length === 0) {
            break
          }
        }

        if (done && buffer.length === 0) {
          break
        }
      }
    } finally {
      reader.releaseLock()
    }

    return {
      success: true,
      total_size: fileSize,
      chunk_size: chunkSize,
      total_chunks: totalChunks,
      chunks: chunks,
      filename: filename,
    }
  }

  /**
   * Format file size in human-readable format
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }
}
