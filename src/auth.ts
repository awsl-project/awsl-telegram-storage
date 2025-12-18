import { Context } from 'hono'
import { verify } from 'hono/jwt'

/**
 * Authentication result interface
 */
export interface AuthResult {
  success: boolean
  error?: string
  tokenType?: 'api_token' | 'jwt'
  chatId?: string  // Chat ID extracted from JWT token (if present)
}

/**
 * Validates authentication token from request header
 * Supports both permanent API_TOKEN and temporary JWT tokens
 *
 * @param c - Hono context object
 * @returns AuthResult indicating success or failure
 *
 * @example
 * const auth = await validateAuth(c)
 * if (!auth.success) {
 *   return c.json({ success: false, error: auth.error }, 401)
 * }
 */
export async function validateAuth(c: Context): Promise<AuthResult> {
  const token = c.req.header('X-Api-Token')

  // Check if token exists
  if (!token) {
    return {
      success: false,
      error: 'Missing X-Api-Token header'
    }
  }

  // Check if it's a JWT token (format: xxx.yyy.zzz)
  const isJWT = token.split('.').length === 3

  if (isJWT) {
    // Validate JWT token
    try {
      const payload = await verify(token, c.env.API_TOKEN)

      // Check if token has expired (additional safety check)
      const now = Math.floor(Date.now() / 1000)
      if (payload.exp && payload.exp < now) {
        return {
          success: false,
          error: 'JWT token has expired'
        }
      }

      // Verify token scope is for upload operations
      if (payload.scope !== 'upload') {
        return {
          success: false,
          error: 'JWT token does not have upload permission'
        }
      }

      return {
        success: true,
        tokenType: 'jwt',
        chatId: payload.chat_id as string | undefined  // Extract chat_id from JWT payload
      }
    } catch (error) {
      console.error('JWT verification error:', error)
      return {
        success: false,
        error: 'Invalid or expired JWT token'
      }
    }
  } else {
    // Validate as permanent API_TOKEN
    if (token === c.env.API_TOKEN) {
      return {
        success: true,
        tokenType: 'api_token'
      }
    } else {
      return {
        success: false,
        error: 'Invalid API token'
      }
    }
  }
}
