import { OpenAPIRoute, Str, Num } from 'chanfana'
import { Context } from 'hono'
import { sign } from 'hono/jwt'
import { z } from 'zod'

/**
 * JWT payload structure for upload tokens
 */
interface UploadJWTPayload {
  iss: string    // Issuer
  sub: string    // Subject
  iat: number    // Issued at
  exp: number    // Expiration time
  scope: string  // Allowed operations
  chat_id?: string  // Optional Telegram chat ID
}

/**
 * API endpoint to generate temporary JWT tokens for upload authentication
 * Requires the main API_TOKEN for authorization
 * Generated JWTs have a maximum validity of 24 hours
 */
export class TokenGenerate extends OpenAPIRoute {
  schema = {
    tags: ['Authentication'],
    summary: 'Generate temporary JWT token',
    description: 'Generate a temporary JWT token for upload operations. Requires API_TOKEN authentication. Maximum validity: 24 hours.',
    request: {
      headers: z.object({
        'x-api-token': Str({ description: 'API Token for authentication', required: true })
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              expires_in: Num({
                description: 'Token validity duration in seconds (max: 86400 = 24 hours)',
                required: false,
                default: 3600,
                example: 3600
              }),
              chat_id: Str({
                description: 'Telegram chat ID to embed in the token (optional, for use in subsequent uploads)',
                required: false,
                example: '-1001234567890'
              })
            })
          }
        }
      }
    },
    responses: {
      '200': {
        description: 'JWT token generated successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              token: z.string(),
              expires_in: z.number(),
              expires_at: z.string()
            })
          }
        }
      },
      '401': {
        description: 'Unauthorized - Invalid API token',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              error: z.string()
            })
          }
        }
      },
      '400': {
        description: 'Bad Request - Invalid expiration time',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              error: z.string()
            })
          }
        }
      }
    }
  }

  async handle(c: Context) {
    // Validate API_TOKEN
    const token = c.req.header('X-Api-Token')
    if (!token || token !== c.env.API_TOKEN) {
      return c.json({ success: false, error: 'Unauthorized' }, 401)
    }

    // Parse and validate request body
    const data = await this.getValidatedData<typeof this.schema>()
    let expiresIn = data.body.expires_in || 3600 // Default: 1 hour
    const chatId = data.body.chat_id // Optional chat_id parameter

    // Enforce maximum validity of 24 hours (86400 seconds)
    const MAX_EXPIRY = 86400
    if (expiresIn > MAX_EXPIRY) {
      return c.json(
        {
          success: false,
          error: `Token validity cannot exceed 24 hours (86400 seconds). Requested: ${expiresIn} seconds`
        },
        400
      )
    }

    // Ensure positive expiration time
    if (expiresIn <= 0) {
      return c.json(
        {
          success: false,
          error: 'Token validity must be greater than 0 seconds'
        },
        400
      )
    }

    // Generate JWT token
    const now = Math.floor(Date.now() / 1000)
    const exp = now + expiresIn

    const payload: UploadJWTPayload = {
      iss: 'awsl-telegram-storage', // Issuer
      sub: 'upload',                 // Subject: upload operations
      iat: now,                      // Issued at
      exp: exp,                      // Expiration time
      scope: 'upload',               // Allowed operations
      ...(chatId && { chat_id: chatId })  // Include chat_id if provided
    }

    try {
      // Sign JWT with API_TOKEN as secret
      const jwt = await sign(payload, c.env.API_TOKEN)

      return c.json({
        success: true,
        token: jwt,
        expires_in: expiresIn,
        expires_at: new Date(exp * 1000).toISOString()
      })
    } catch (error) {
      console.error('JWT generation error:', error)
      return c.json(
        {
          success: false,
          error: 'Failed to generate JWT token'
        },
        500
      )
    }
  }
}
