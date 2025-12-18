import { fromHono } from 'chanfana'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { FileUploadEndpoint } from './api_upload'
import { MediaGroupUploadEndpoint } from './api_upload_group'
import { FileDownloadEndpoint } from './api_download'
import { VideoStreamEndpoint } from './api_stream'
import { TokenGenerate } from './api_token_generate'
import { StreamingUploadEndpoint } from './api_upload_stream'

type Bindings = {
  BOT_TOKEN: string
  CHAT_ID: string
  API_TOKEN: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/*', cors())

app.onError((err, c) => {
  console.error(err)
  return c.text(`${err.name} ${err.message}`, 500)
})

const openapi = fromHono(app, {
  docs_url: '/docs',
  openapi_url: '/openapi.json',
})

openapi.post('/api/upload', FileUploadEndpoint)
openapi.post('/api/upload/stream', StreamingUploadEndpoint)
openapi.post('/api/upload/group', MediaGroupUploadEndpoint)
openapi.post('/api/token/generate', TokenGenerate)
openapi.get('/file/:file_id', FileDownloadEndpoint)
openapi.get('/stream/video', VideoStreamEndpoint)

export default app
