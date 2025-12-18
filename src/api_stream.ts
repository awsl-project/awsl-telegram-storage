import { OpenAPIRoute } from 'chanfana'
import { z } from 'zod'
import type { Context } from 'hono'

/**
 * Chunk information parsed from URL parameters
 */
interface ChunkInfo {
  fileId: string
  size: number
}

/**
 * Decompress base64url-encoded deflate data
 */
async function decompressData(base64urlData: string): Promise<string> {
  // Convert base64url to base64
  const base64 = base64urlData.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Padded = base64 + padding

  // Decode base64 to binary
  const binaryString = atob(base64Padded)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  // Decompress using DecompressionStream
  const ds = new DecompressionStream('deflate-raw')
  const writer = ds.writable.getWriter()
  writer.write(bytes)
  writer.close()

  const reader = ds.readable.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  // Combine chunks and decode as UTF-8
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return new TextDecoder().decode(result)
}

/**
 * Parse chunk parameters from URL
 * Supports two formats:
 * 1. Plain: file_id1:size1,file_id2:size2,...
 * 2. Compressed: base64url-encoded deflate data (auto-detected)
 */
async function parseChunks(chunksParam: string): Promise<ChunkInfo[]> {
  let data = chunksParam

  // Auto-detect compressed format (no colons or commas in base64url)
  // Plain format always has colons, compressed doesn't
  if (!chunksParam.includes(':')) {
    try {
      data = await decompressData(chunksParam)
    } catch {
      throw new Error('Failed to decompress chunks data')
    }
  }

  return data.split(',').map(chunk => {
    const [fileId, sizeStr] = chunk.split(':')
    return {
      fileId,
      size: parseInt(sizeStr, 10)
    }
  })
}

/**
 * Video Stream Endpoint
 *
 * Supports HTTP Range requests for video seeking.
 * Accepts multiple file chunks via URL parameter and streams them as a single video.
 *
 * Usage with HTML5 video:
 * <video src="/stream/video?chunks=fileId1:size1,fileId2:size2" />
 */
export class VideoStreamEndpoint extends OpenAPIRoute {
  schema = {
    tags: ['Video'],
    summary: 'Stream video from multiple Telegram file chunks',
    description: `
Stream video with HTTP Range request support for seeking.

**Supports two formats:**

1. **Plain format** (for short videos):
   \`/stream/video?chunks=fileId1:size1,fileId2:size2\`

2. **Compressed format** (for large videos):
   \`/stream/video?chunks=<base64url-deflate-compressed>\`

**Parameters:**
- chunks: Plain or compressed chunk data

**Compression (recommended for >5 chunks):**
\`\`\`javascript
async function compressChunks(chunks) {
  const data = chunks.map(c => c.file_id + ':' + c.size).join(',')
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const compressed = await new Response(stream).arrayBuffer()
  const base64 = btoa(String.fromCharCode(...new Uint8Array(compressed)))
  return base64.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
}
\`\`\`
    `,
    request: {
      query: z.object({
        chunks: z.string().describe('Plain (file_id:size,...) or compressed (base64url deflate) chunk data'),
      }),
    },
    responses: {
      200: {
        description: 'Full video stream',
        content: { 'application/octet-stream': { schema: z.any() } },
      },
      206: {
        description: 'Partial video stream (Range request)',
        content: { 'application/octet-stream': { schema: z.any() } },
      },
      400: {
        description: 'Invalid request',
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
    const chunksParam = c.req.query('chunks')

    if (!chunksParam) {
      return c.json({ success: false, error: 'Missing chunks parameter' }, 400)
    }

    // Parse chunk information
    let chunks: ChunkInfo[]
    try {
      chunks = await parseChunks(chunksParam)
      if (chunks.length === 0 || chunks.some(ch => !ch.fileId || isNaN(ch.size))) {
        throw new Error('Invalid chunk format')
      }
    } catch {
      return c.json({ success: false, error: 'Invalid chunks format. Expected: file_id:size,file_id:size,... or compressed base64url' }, 400)
    }

    // Calculate total size
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0)

    // Parse Range header
    const rangeHeader = c.req.header('range')
    let start = 0
    let end = totalSize - 1
    let statusCode = 200

    if (rangeHeader) {
      const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/)
      if (rangeMatch) {
        const [, startStr, endStr] = rangeMatch
        start = startStr ? parseInt(startStr, 10) : 0
        end = endStr ? Math.min(parseInt(endStr, 10), totalSize - 1) : totalSize - 1
        statusCode = 206
      }
    }

    // Validate range
    if (start >= totalSize || start > end) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: {
          'Content-Range': `bytes */${totalSize}`,
        },
      })
    }

    // Pre-calculate tasks to validate the range and compute actual content length
    const tasks = calculateTasks(chunks, start, end)

    // If no data in the requested range, return 416 Range Not Satisfiable
    if (tasks.length === 0) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: {
          'Content-Range': `bytes */${totalSize}`,
        },
      })
    }

    // Calculate actual content length from tasks
    const contentLength = tasks.reduce((sum, task) => sum + (task.sliceEnd - task.sliceStart), 0)

    // Build response headers
    const headers = new Headers()
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Content-Length', String(contentLength))
    headers.set('Content-Type', 'video/mp4')

    // Add cache control for better seeking performance
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')

    if (statusCode === 206) {
      headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`)
    }

    // Create readable stream
    const botToken = c.env.BOT_TOKEN
    const stream = createVideoStreamFromTasks(tasks, botToken)

    return new Response(stream, { status: statusCode, headers })
  }
}

/**
 * Task information for streaming a chunk
 */
interface ChunkTask {
  fileId: string
  sliceStart: number
  sliceEnd: number
  fullChunk: boolean  // true = can pipe directly, false = need to slice
}

/**
 * Calculate which chunks and byte ranges are needed for a given request range
 */
function calculateTasks(
  chunks: ChunkInfo[],
  start: number,
  end: number
): ChunkTask[] {
  const tasks: ChunkTask[] = []
  let currentPos = 0

  for (const chunk of chunks) {
    const chunkStart = currentPos
    const chunkEnd = currentPos + chunk.size - 1
    currentPos += chunk.size

    // Skip chunks entirely before the requested range
    if (chunkEnd < start) continue
    // Stop processing chunks entirely after the requested range
    if (chunkStart > end) break

    // Calculate slice boundaries relative to this chunk
    const sliceStart = Math.max(0, start - chunkStart)
    const sliceEnd = Math.min(chunk.size, end - chunkStart + 1)

    // Only add task if there's actual data to return
    if (sliceEnd > sliceStart) {
      tasks.push({
        fileId: chunk.fileId,
        sliceStart,
        sliceEnd,
        fullChunk: sliceStart === 0 && sliceEnd === chunk.size
      })
    }
  }

  return tasks
}

/**
 * Create a ReadableStream from pre-calculated chunk tasks
 */
function createVideoStreamFromTasks(
  tasks: ChunkTask[],
  botToken: string
): ReadableStream<Uint8Array> {
  let taskIndex = 0

  return new ReadableStream({
    async pull(controller) {
      // Check if all tasks are completed
      if (taskIndex >= tasks.length) {
        controller.close()
        return
      }

      const task = tasks[taskIndex++]

      try {
        const response = await fetchChunkResponse(task.fileId, botToken)

        if (task.fullChunk) {
          // Pipe entire chunk directly without loading into memory
          const reader = response.body!.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(value)
          }
        } else {
          // Need to slice, load into memory
          const arrayBuffer = await response.arrayBuffer()
          if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            throw new Error(`Empty response from Telegram for chunk ${task.fileId}`)
          }

          const data = new Uint8Array(arrayBuffer)

          // Validate slice boundaries
          if (task.sliceEnd > data.length) {
            throw new Error(`Slice end ${task.sliceEnd} exceeds data length ${data.length}`)
          }

          const slicedData = data.slice(task.sliceStart, task.sliceEnd)

          if (slicedData.length === 0) {
            throw new Error(`Sliced data is empty: slice(${task.sliceStart}, ${task.sliceEnd}) from ${data.length} bytes`)
          }

          controller.enqueue(slicedData)
        }
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

/**
 * Fetch chunk response from Telegram with Cloudflare Cache optimization
 */
async function fetchChunkResponse(
  fileId: string,
  botToken: string
): Promise<Response> {
  // Get file path (will be cached by Cloudflare Cache API)
  const filePath = await getFilePath(fileId, botToken)

  // Fetch the file
  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)

  if (!response.ok) {
    throw new Error(`Failed to download chunk: ${response.statusText}`)
  }

  return response
}

/**
 * Get file path from Telegram API with Cloudflare Cache API caching
 */
async function getFilePath(fileId: string, botToken: string): Promise<string> {
  // Use Cloudflare Cache API for persistent caching across requests
  // Cache key must be a valid URL format (doesn't need to be real)
  const cache = caches.default
  const cacheKey = new Request(`https://cache/telegram/file-path/${fileId}`)

  // Try to get from cache first
  const cachedResponse = await cache.match(cacheKey)
  if (cachedResponse) {
    return await cachedResponse.text()
  }

  // Cache miss, fetch from Telegram API
  const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)
  const fileData = await fileRes.json() as any

  if (!fileData.ok) {
    throw new Error(`Failed to get file info: ${fileData.description}`)
  }

  const filePath = fileData.result.file_path

  // Store in cache for 24 hours (file paths are immutable)
  const cacheResponse = new Response(filePath, {
    headers: {
      'Cache-Control': 'public, max-age=86400',
      'Content-Type': 'text/plain',
    },
  })
  await cache.put(cacheKey, cacheResponse)

  return filePath
}
