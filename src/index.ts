import 'dotenv/config'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import fastifyMultipart from '@fastify/multipart'
import { fileURLToPath } from 'url'
import { basename, join, dirname } from 'path'
import prismaPlugin from './plugins/prisma.js'
import authRoutes from './routes/auth.js'
import oauthRoutes from './routes/oauth.js'
import phoneRoutes from './routes/phone.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const fastify = Fastify({ logger: true, trustProxy: true })

// JWT
await fastify.register(fastifyJwt, {
  secret: process.env.JWT_SECRET!,
})

// Cookie
await fastify.register(fastifyCookie)

// Multipart uploads
await fastify.register(fastifyMultipart, {
  limits: {
    files: 1,
    fileSize: 5 * 1024 * 1024,
  },
})

// authenticate 데코레이터
fastify.decorate('authenticate', async function (request: any, reply: any) {
  try {
    await request.jwtVerify()
  } catch {
    reply.code(401).send({ error: '인증이 필요합니다.' })
  }
})

fastify.addHook('onSend', async (request, reply, payload) => {
  const path = request.url.split('?')[0]
  if (['/', '/account', '/login-history', '/index.html', '/app.js', '/design.css'].includes(path)) {
    reply.header('Cache-Control', 'no-store')
  }
  return payload
})

// Static files (login page)
await fastify.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
  setHeaders: (res, pathName) => {
    if (['index.html', 'app.js', 'design.css'].includes(basename(pathName))) {
      res.header('Cache-Control', 'no-store')
    }
  },
})

fastify.get('/account', async (_request, reply) => {
  return reply.header('Cache-Control', 'no-store').sendFile('index.html')
})

fastify.get('/login-history', async (_request, reply) => {
  return reply.header('Cache-Control', 'no-store').sendFile('index.html')
})

// Prisma
await fastify.register(prismaPlugin)

// Routes
await fastify.register(authRoutes, { prefix: '/auth' })
await fastify.register(oauthRoutes, { prefix: '/auth' })
await fastify.register(phoneRoutes, { prefix: '/auth' })

// Health check
fastify.get('/health', async () => ({ ok: true }))

try {
  await fastify.listen({ port: Number(process.env.PORT ?? 4000), host: '0.0.0.0' })
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
