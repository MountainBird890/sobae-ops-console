import { Hono } from 'hono'
import { cors } from 'hono/cors'
import organizations from './routes/organizations.js'
import { requireAuth, type AuthVariables } from './auth/middleware.js'

const app = new Hono<{ Variables: AuthVariables }>()

const allowedOrigin = process.env.ALLOWED_ORIGIN
app.use(
  '/api/*',
  cors({
    origin: allowedOrigin ? allowedOrigin.split(',').map((origin) => origin.trim()) : [],
  }),
)
app.use('/api/*', requireAuth)

const welcomeStrings = [
  'Hello Hono!',
  'To learn more about Hono on Vercel, visit https://vercel.com/docs/frameworks/backend/hono'
]

app.get('/', (c) => {
  return c.text(welcomeStrings.join('\n\n'))
})

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

app.route('/api/organizations', organizations)

export default app
