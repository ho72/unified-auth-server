import type { FastifyPluginAsync } from 'fastify'
import crypto from 'crypto'
import { createWriteStream } from 'fs'
import { mkdir, rename, unlink } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { pipeline } from 'stream/promises'
import { fileURLToPath } from 'url'
import { issueTokens, hashToken } from '../lib/tokens.js'
import { normalizePhoneNumber, PhoneValidationError } from '../lib/phone.js'
import { recordServiceUsage } from '../lib/services.js'
import { ACCOUNT_DELETION_GRACE_DAYS, deletionScheduledAt, purgeExpiredDeletedUsers } from '../lib/account-deletion.js'

const AVATAR_MAX_BYTES = 5 * 1024 * 1024
const AVATAR_PUBLIC_PREFIX = '/uploads/avatars/'
const AVATAR_UPLOAD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'uploads', 'avatars')
const AVATAR_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])
const LOCAL_AVATAR_NAME_RE = /^[a-f0-9]{48}\.(jpg|png|webp|gif)$/

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /auth/profiles/:id
  fastify.get('/profiles/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    await purgeExpiredDeletedUsers(fastify.prisma)
    const { id } = request.params as { id: string }
    const claims = request.user as {
      sub?: string
      aud?: string
      scope?: string
      profileSub?: string
    }
    const canReadOwnProfile = claims.sub === id && !claims.scope
    const canReadServiceProfile = claims.aud === 'unipass' &&
      claims.scope === 'unipass:profile:read' &&
      claims.profileSub === id

    if (!canReadOwnProfile && !canReadServiceProfile) {
      return reply.code(403).send({ error: '프로필을 조회할 권한이 없습니다.' })
    }

    const user = await fastify.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        handle: true,
        displayName: true,
        avatarUrl: true,
      },
    })
    if (!user) return reply.code(404).send({ error: '사용자를 찾을 수 없습니다.' })
    return reply.send(user)
  })

  // GET /auth/check-handle
  fastify.get('/check-handle', async (request, reply) => {
    const { handle } = request.query as { handle: string }
    if (!handle) return reply.code(400).send({ error: 'handle이 필요합니다.' })
    const existing = await fastify.prisma.user.findUnique({ where: { handle } })
    return reply.send({ available: !existing })
  })

  // POST /auth/register
  fastify.post('/register', async (request, reply) => {
    return reply.code(410).send({ error: '이메일/비밀번호 회원가입은 지원하지 않습니다. Google 또는 Kakao로 계속해주세요.' })
  })

  // POST /auth/login
  fastify.post('/login', async (request, reply) => {
    return reply.code(410).send({ error: '이메일/비밀번호 로그인은 지원하지 않습니다. Google 또는 Kakao로 계속해주세요.' })
  })

  // POST /auth/logout
  fastify.post('/logout', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string }
    const tokenHash = hashToken(refreshToken)
    await fastify.prisma.refreshToken.deleteMany({ where: { tokenHash } })
    return reply.send({ ok: true })
  })

  // POST /auth/refresh
  fastify.post('/refresh', async (request, reply) => {
    await purgeExpiredDeletedUsers(fastify.prisma)
    const { refreshToken } = request.body as { refreshToken: string }
    const tokenHash = hashToken(refreshToken)

    const stored = await fastify.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: {
        user: {
          select: {
            deletionScheduledAt: true,
          },
        },
      },
    })

    if (!stored || stored.expiresAt < new Date()) {
      await fastify.prisma.refreshToken.deleteMany({ where: { tokenHash } })
      return reply.code(401).send({ error: '유효하지 않은 토큰입니다.' })
    }
    if (stored.user?.deletionScheduledAt) {
      await fastify.prisma.refreshToken.deleteMany({ where: { tokenHash } })
      return reply.code(403).send({ error: '계정 삭제가 예약되어 있습니다. 다시 로그인하면 삭제 예약이 취소됩니다.' })
    }

    await fastify.prisma.refreshToken.delete({ where: { id: stored.id } })
    const tokens = await issueTokens(fastify, stored.userId)
    return reply.send(tokens)
  })

  // GET /auth/me
  fastify.get('/me', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    await purgeExpiredDeletedUsers(fastify.prisma)
    const { sub } = request.user as { sub: string }
    const user = await fastify.prisma.user.findUnique({
      where: { id: sub },
      select: {
        id: true, email: true, handle: true, displayName: true,
        avatarUrl: true, phone: true, phoneCountry: true, locale: true,
        isEmailVerified: true, emailVerifiedAt: true, phoneVerifiedAt: true,
        lastLoginAt: true, createdAt: true,
        deletionRequestedAt: true, deletionScheduledAt: true,
        oauthAccounts: {
          select: {
            provider: true,
            email: true,
            emailVerified: true,
            displayName: true,
            avatarUrl: true,
            lastLoginAt: true,
            createdAt: true,
          },
          orderBy: { provider: 'asc' },
        },
        connectedServices: {
          select: {
            firstUsedAt: true,
            lastUsedAt: true,
            loginCount: true,
            service: {
              select: {
                key: true,
                name: true,
                origin: true,
                iconUrl: true,
              },
            },
          },
          orderBy: { lastUsedAt: 'desc' },
        },
      },
    })
    if (!user) return reply.code(404).send({ error: '사용자를 찾을 수 없습니다.' })
    return reply.send(user)
  })

  // GET /auth/me/login-events
  fastify.get('/me/login-events', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    await purgeExpiredDeletedUsers(fastify.prisma)
    const { sub } = request.user as { sub: string }
    const events = await fastify.prisma.loginEvent.findMany({
      where: { userId: sub },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        provider: true,
        serviceKey: true,
        serviceName: true,
        serviceOrigin: true,
        ip: true,
        country: true,
        region: true,
        city: true,
        userAgent: true,
        createdAt: true,
      },
    })
    return reply.send({ events })
  })

  // PATCH /auth/me
  fastify.patch('/me', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    await purgeExpiredDeletedUsers(fastify.prisma)
    const { sub } = request.user as { sub: string }
    const { handle, displayName, avatarUrl, phone, phoneCountry, locale } = request.body as {
      handle?: string
      displayName?: string
      avatarUrl?: string
      phone?: string
      phoneCountry?: string
      locale?: string
    }

    let normalizedPhone: { e164: string; country: 'KR' | 'US' } | null | undefined
    try {
      normalizedPhone = phone !== undefined
        ? (phone.trim() ? normalizePhoneNumber(phone, phoneCountry ?? 'KR') : null)
        : undefined
    } catch (err) {
      if (err instanceof PhoneValidationError) {
        return reply.code(400).send({ error: '올바른 전화번호 형식이 아닙니다.' })
      }
      throw err
    }

    const normalizedAvatarUrl = normalizeAvatarUrl(avatarUrl)
    if (avatarUrl !== undefined && normalizedAvatarUrl === undefined) {
      return reply.code(400).send({ error: '프로필 사진 주소를 확인해주세요.' })
    }

    if (handle) {
      const conflict = await fastify.prisma.user.findFirst({
        where: { handle, NOT: { id: sub } },
      })
      if (conflict) return reply.code(409).send({ error: '이미 사용 중인 아이디입니다.' })
    }

    if (normalizedPhone?.e164) {
      const phoneConflict = await fastify.prisma.user.findFirst({
        where: { phone: normalizedPhone.e164, NOT: { id: sub } },
      })
      if (phoneConflict) return reply.code(409).send({ error: '이미 다른 계정에 연결된 전화번호입니다.' })
    }

    const user = await fastify.prisma.user.update({
      where: { id: sub },
      data: {
        ...(handle && { handle }),
        ...(displayName && { displayName }),
        ...(avatarUrl !== undefined && { avatarUrl: normalizedAvatarUrl }),
        ...(phone !== undefined && {
          phone: normalizedPhone?.e164 ?? null,
          phoneCountry: normalizedPhone?.country ?? null,
          phoneVerifiedAt: null,
        }),
        ...(locale && { locale }),
      },
      select: {
        id: true, email: true, handle: true, displayName: true,
        avatarUrl: true, phone: true, phoneCountry: true, phoneVerifiedAt: true, locale: true,
      },
    })
    return reply.send(user)
  })

  // POST /auth/me/avatar
  fastify.post('/me/avatar', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    await purgeExpiredDeletedUsers(fastify.prisma)
    const { sub } = request.user as { sub: string }

    let part: any
    try {
      part = await (request as any).file({
        limits: {
          files: 1,
          fileSize: AVATAR_MAX_BYTES,
        },
      })
    } catch (err) {
      if (isFileTooLargeError(err)) {
        return reply.code(413).send({ error: '프로필 사진은 5MB 이하로 업로드해주세요.' })
      }
      throw err
    }

    if (!part) {
      return reply.code(400).send({ error: '업로드할 프로필 사진을 선택해주세요.' })
    }

    const ext = AVATAR_TYPES.get(part.mimetype)
    if (!ext) {
      part.file.resume()
      return reply.code(400).send({ error: 'JPG, PNG, WebP, GIF 이미지만 업로드할 수 있습니다.' })
    }

    await mkdir(AVATAR_UPLOAD_DIR, { recursive: true })

    const previous = await fastify.prisma.user.findUnique({
      where: { id: sub },
      select: { avatarUrl: true },
    })
    if (!previous) {
      part.file.resume()
      return reply.code(404).send({ error: '사용자를 찾을 수 없습니다.' })
    }

    const filename = `${crypto.randomBytes(24).toString('hex')}.${ext}`
    const tempPath = join(AVATAR_UPLOAD_DIR, `${filename}.tmp`)
    const finalPath = join(AVATAR_UPLOAD_DIR, filename)
    let reachedLimit = false
    part.file.on('limit', () => {
      reachedLimit = true
    })

    try {
      await pipeline(part.file, createWriteStream(tempPath))

      if (reachedLimit || part.file.truncated) {
        await unlink(tempPath).catch(() => {})
        return reply.code(413).send({ error: '프로필 사진은 5MB 이하로 업로드해주세요.' })
      }

      await rename(tempPath, finalPath)
      const avatarUrl = `${AVATAR_PUBLIC_PREFIX}${filename}`
      const user = await fastify.prisma.user.update({
        where: { id: sub },
        data: { avatarUrl },
        select: {
          id: true,
          email: true,
          handle: true,
          displayName: true,
          avatarUrl: true,
          phone: true,
          phoneCountry: true,
          phoneVerifiedAt: true,
          locale: true,
        },
      })

      await deleteLocalAvatar(previous.avatarUrl, avatarUrl)
      return reply.send(user)
    } catch (err) {
      await unlink(tempPath).catch(() => {})
      fastify.log.error({ err }, 'Avatar upload failed')
      return reply.code(500).send({ error: '프로필 사진을 업로드하지 못했습니다.' })
    }
  })

  // DELETE /auth/me/avatar
  fastify.delete('/me/avatar', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    await purgeExpiredDeletedUsers(fastify.prisma)
    const { sub } = request.user as { sub: string }

    const previous = await fastify.prisma.user.findUnique({
      where: { id: sub },
      select: { avatarUrl: true },
    })
    if (!previous) return reply.code(404).send({ error: '사용자를 찾을 수 없습니다.' })

    const user = await fastify.prisma.user.update({
      where: { id: sub },
      data: { avatarUrl: null },
      select: {
        id: true,
        email: true,
        handle: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        phoneCountry: true,
        phoneVerifiedAt: true,
        locale: true,
      },
    })
    await deleteLocalAvatar(previous.avatarUrl, undefined)
    return reply.send(user)
  })

  // POST /auth/me/services/usage
  fastify.post('/me/services/usage', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    await purgeExpiredDeletedUsers(fastify.prisma)
    const { sub } = request.user as { sub: string }
    const { redirectUri } = request.body as { redirectUri?: string }
    const usage = await recordServiceUsage(fastify.prisma, sub, redirectUri)
    return reply.send({ ok: true, recorded: Boolean(usage) })
  })

  // POST /auth/me/deletion
  fastify.post('/me/deletion', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    await purgeExpiredDeletedUsers(fastify.prisma)
    const { sub } = request.user as { sub: string }
    const { confirm } = request.body as { confirm?: string }

    const user = await fastify.prisma.user.findUnique({
      where: { id: sub },
      select: {
        id: true,
        handle: true,
        deletionScheduledAt: true,
      },
    })
    if (!user) return reply.code(404).send({ error: '사용자를 찾을 수 없습니다.' })

    const normalizedConfirm = confirm?.trim().replace(/^@/, '').toLowerCase()
    if (normalizedConfirm !== user.handle.toLowerCase()) {
      return reply.code(400).send({ error: '삭제하려면 Unipass ID를 정확히 입력해주세요.' })
    }

    if (user.deletionScheduledAt) {
      return reply.send({
        ok: true,
        scheduledAt: user.deletionScheduledAt,
        graceDays: ACCOUNT_DELETION_GRACE_DAYS,
        message: '이미 계정 삭제가 예약되어 있습니다. 다시 로그인하면 삭제 예약이 취소됩니다.',
      })
    }

    const now = new Date()
    const scheduledAt = deletionScheduledAt(now)
    await fastify.prisma.$transaction(async (tx: any) => {
      await tx.user.update({
        where: { id: sub },
        data: {
          deletionRequestedAt: now,
          deletionScheduledAt: scheduledAt,
        },
      })
      await tx.refreshToken.deleteMany({ where: { userId: sub } })
    })

    return reply.send({
      ok: true,
      scheduledAt,
      graceDays: ACCOUNT_DELETION_GRACE_DAYS,
      message: '계정 삭제가 예약되었습니다. 30일 안에 다시 로그인하면 삭제 예약이 취소됩니다.',
    })
  })
}

function normalizeAvatarUrl(value?: string): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString()
  } catch {}

  return undefined
}

async function deleteLocalAvatar(previousUrl?: string | null, nextUrl?: string) {
  if (!previousUrl?.startsWith(AVATAR_PUBLIC_PREFIX) || previousUrl === nextUrl) return

  const filename = basename(previousUrl.slice(AVATAR_PUBLIC_PREFIX.length))
  if (!LOCAL_AVATAR_NAME_RE.test(filename)) return

  await unlink(join(AVATAR_UPLOAD_DIR, filename)).catch(() => {})
}

function isFileTooLargeError(err: unknown) {
  return typeof err === 'object' && err !== null && 'code' in err &&
    (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE'
}

export default authRoutes
