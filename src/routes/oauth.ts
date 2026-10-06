import type { FastifyPluginAsync } from 'fastify'
import crypto from 'crypto'
import { issueTokens, hashToken } from '../lib/tokens.js'
import { normalizeStoredPhone } from '../lib/phone.js'
import { recordServiceUsage } from '../lib/services.js'
import { cancelAccountDeletionIfPending, purgeExpiredDeletedUsers } from '../lib/account-deletion.js'
import { recordLoginEvent } from '../lib/login-events.js'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

const KAKAO_AUTH_URL = 'https://kauth.kakao.com/oauth/authorize'
const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token'
const KAKAO_USERINFO_URL = 'https://kapi.kakao.com/v2/user/me'

const PENDING_OAUTH_TTL_MS = 15 * 60 * 1000
const OAUTH_LINK_TTL_SECONDS = 10 * 60

type OAuthProvider = 'google' | 'kakao'
type OAuthAction = 'signup' | 'link'

type AuthTokens = { accessToken: string; refreshToken: string; requiresPhoneVerification?: boolean }

type OAuthIdentityInput = {
  provider: OAuthProvider
  providerId: string
  email?: string
  emailVerified: boolean
  phone?: string
  phoneVerified: boolean
  displayName: string
  avatarUrl?: string
}

type OAuthIdentitySnapshot = {
  provider: string
  providerId: string
  email?: string | null
  emailVerified: boolean
  phone?: string | null
  phoneVerified: boolean
  displayName: string
  avatarUrl?: string | null
}

type OAuthResolution =
  | { type: 'tokens'; tokens: AuthTokens; userId: string; provider: string }
  | { type: 'pending'; token: string }

type OAuthStateData = {
  redirectUri?: string
  linkToken?: string
  returnTo?: 'account'
}

type OAuthLinkClaims = {
  sub?: string
  provider?: OAuthProvider
  purpose?: string
}

class OAuthFlowError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
  }
}

const oauthRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /auth/google
  fastify.get('/google', async (request, reply) => {
    const { redirect_uri, link_token } = request.query as { redirect_uri?: string; link_token?: string }
    return reply.redirect(buildOAuthAuthorizeUrl('google', redirect_uri, link_token).toString())
  })

  // GET /auth/google/callback
  fastify.get('/google/callback', async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string }
    const oauthState = decodeOAuthState(state)
    const redirectUri = oauthState.redirectUri
    if (!code) return redirectWithOAuthError(reply, 'Google 인증 코드가 없습니다.', redirectUri, oauthState.returnTo)

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_CALLBACK_URL!,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenRes.json() as { access_token?: string }
    if (!tokenRes.ok || !tokenData.access_token) {
      fastify.log.warn({ tokenData }, 'Google token exchange failed')
      return redirectWithOAuthError(reply, 'Google 로그인에 실패했습니다.', redirectUri, oauthState.returnTo)
    }

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const profile = await userRes.json() as {
      sub?: string
      email?: string
      email_verified?: boolean | string
      name?: string
      picture?: string
    }
    if (!userRes.ok || !profile.sub) {
      fastify.log.warn({ profile }, 'Google userinfo failed')
      return redirectWithOAuthError(reply, 'Google 프로필을 가져오지 못했습니다.', redirectUri, oauthState.returnTo)
    }

    try {
      const linkUserId = await resolveOAuthLinkUserId(fastify, oauthState.linkToken, 'google')
      const result = await resolveOAuthIdentity(fastify, {
        provider: 'google',
        providerId: profile.sub,
        email: normalizeEmail(profile.email),
        emailVerified: toBoolean(profile.email_verified),
        phoneVerified: false,
        displayName: sanitizeDisplayName(profile.name) || profile.email?.split('@')[0] || `google_${profile.sub}`,
        avatarUrl: normalizeUrl(profile.picture),
      }, linkUserId)

      return redirectWithResolution(fastify, request, reply, result, redirectUri, oauthState.returnTo)
    } catch (err) {
      return handleOAuthError(fastify, reply, err, redirectUri, oauthState.returnTo)
    }
  })

  // GET /auth/kakao
  fastify.get('/kakao', async (request, reply) => {
    const { redirect_uri, link_token } = request.query as { redirect_uri?: string; link_token?: string }
    return reply.redirect(buildOAuthAuthorizeUrl('kakao', redirect_uri, link_token).toString())
  })

  // GET /auth/kakao/callback
  fastify.get('/kakao/callback', async (request, reply) => {
    const { code, state, error, error_description } = request.query as {
      code?: string
      state?: string
      error?: string
      error_description?: string
    }
    const oauthState = decodeOAuthState(state)
    const redirectUri = oauthState.redirectUri
    if (error) {
      fastify.log.warn({ error, error_description }, 'Kakao authorization failed')
      return redirectWithOAuthError(reply, 'Kakao 로그인 권한 설정을 확인해주세요.', redirectUri, oauthState.returnTo)
    }
    if (!code) return redirectWithOAuthError(reply, 'Kakao 인증 코드가 없습니다.', redirectUri, oauthState.returnTo)

    const tokenRes = await fetch(KAKAO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.KAKAO_CLIENT_ID!,
        client_secret: process.env.KAKAO_CLIENT_SECRET ?? '',
        redirect_uri: process.env.KAKAO_CALLBACK_URL!,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenRes.json() as { access_token?: string }
    if (!tokenRes.ok || !tokenData.access_token) {
      fastify.log.warn({ tokenData }, 'Kakao token exchange failed')
      return redirectWithOAuthError(reply, 'Kakao 로그인에 실패했습니다.', redirectUri, oauthState.returnTo)
    }

    const userRes = await fetch(KAKAO_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const profile = await userRes.json() as {
      id?: number
      properties?: {
        nickname?: string
        profile_image?: string
        thumbnail_image?: string
      }
      kakao_account?: {
        profile?: {
          nickname?: string
          profile_image_url?: string
          thumbnail_image_url?: string
        }
      }
    }
    if (!userRes.ok || !profile.id) {
      fastify.log.warn({ profile }, 'Kakao userinfo failed')
      return redirectWithOAuthError(reply, 'Kakao 프로필을 가져오지 못했습니다.', redirectUri, oauthState.returnTo)
    }

    const kakaoProfile = profile.kakao_account?.profile
    const displayName = sanitizeDisplayName(kakaoProfile?.nickname ?? profile.properties?.nickname) || `kakao_${profile.id}`
    const avatarUrl = normalizeUrl(
      kakaoProfile?.profile_image_url ??
      profile.properties?.profile_image ??
      kakaoProfile?.thumbnail_image_url ??
      profile.properties?.thumbnail_image
    )

    try {
      const linkUserId = await resolveOAuthLinkUserId(fastify, oauthState.linkToken, 'kakao')
      const result = await resolveOAuthIdentity(fastify, {
        provider: 'kakao',
        providerId: String(profile.id),
        emailVerified: false,
        phoneVerified: false,
        displayName,
        avatarUrl,
      }, linkUserId)

      return redirectWithResolution(fastify, request, reply, result, redirectUri, oauthState.returnTo)
    } catch (err) {
      return handleOAuthError(fastify, reply, err, redirectUri, oauthState.returnTo)
    }
  })

  // GET /auth/oauth/pending
  fastify.get('/oauth/pending', async (request, reply) => {
    const { token } = request.query as { token?: string }
    const pending = await findPendingOAuth(fastify.prisma, token)
    if (!pending) return reply.code(404).send({ error: '만료되었거나 유효하지 않은 소셜 로그인 요청입니다.' })

    const targetUser = pending.targetUserId
      ? await fastify.prisma.user.findUnique({
          where: { id: pending.targetUserId },
          select: { id: true, handle: true, displayName: true, avatarUrl: true },
        })
      : null

    return reply.send({
      action: pending.action,
      provider: pending.provider,
      email: pending.email,
      emailVerified: pending.emailVerified,
      phone: pending.phone,
      phoneVerified: pending.phoneVerified,
      displayName: pending.displayName,
      avatarUrl: pending.avatarUrl,
      suggestedHandle: pending.action === 'signup'
        ? await generateUniqueHandle(fastify.prisma, pending.displayName)
        : null,
      targetUser,
    })
  })

  // POST /auth/oauth/signup
  fastify.post('/oauth/signup', async (request, reply) => {
    const { token, handle, displayName, email, redirectUri } = request.body as {
      token?: string
      handle?: string
      displayName?: string
      email?: string
      redirectUri?: string
    }

    try {
      const result = await acceptPendingSignup(fastify.prisma, token, {
        handle,
        displayName,
        email,
      })
      await cancelAccountDeletionIfPending(fastify.prisma, result.userId)
      const tokens = await issueTokens(fastify, result.userId)
      await recordLoginEvent(fastify.prisma, request, {
        userId: result.userId,
        provider: result.provider,
        redirectUri: normalizeRedirectUri(redirectUri),
      })
      return reply.send(tokens)
    } catch (err) {
      return sendOAuthApiError(reply, err)
    }
  })

  // POST /auth/oauth/link
  fastify.post('/oauth/link', async (request, reply) => {
    const { token, redirectUri } = request.body as { token?: string; redirectUri?: string }

    try {
      const result = await acceptPendingLink(fastify.prisma, token)
      await cancelAccountDeletionIfPending(fastify.prisma, result.userId)
      const tokens = await issueTokens(fastify, result.userId)
      await recordLoginEvent(fastify.prisma, request, {
        userId: result.userId,
        provider: result.provider,
        redirectUri: normalizeRedirectUri(redirectUri),
      })
      return reply.send(tokens)
    } catch (err) {
      return sendOAuthApiError(reply, err)
    }
  })

  // POST /auth/oauth/link-intent
  fastify.post('/oauth/link-intent', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { sub: userId } = request.user as { sub: string }
    const { provider } = request.body as { provider?: string }

    if (!isOAuthProvider(provider)) {
      return reply.code(400).send({ error: '지원하지 않는 소셜 로그인입니다.' })
    }

    const existing = await fastify.prisma.oAuthAccount.findFirst({
      where: { userId, provider },
      select: { id: true },
    })
    if (existing) {
      return reply.code(409).send({ error: `${providerLabel(provider)} 계정이 이미 연결되어 있습니다.` })
    }

    const linkToken = fastify.jwt.sign(
      { sub: userId, provider, purpose: 'oauth_link' },
      { expiresIn: `${OAUTH_LINK_TTL_SECONDS}s` }
    )

    return reply.send({
      url: buildOAuthAuthorizeUrl(provider, undefined, linkToken, 'account').toString(),
    })
  })
}

async function resolveOAuthIdentity(
  fastify: any,
  identity: OAuthIdentityInput,
  explicitLinkUserId?: string
): Promise<OAuthResolution> {
  const now = new Date()
  await cleanupExpiredPendingOAuth(fastify.prisma, now)
  await purgeExpiredDeletedUsers(fastify.prisma, now)

  if (explicitLinkUserId) {
    return resolveExplicitOAuthLink(fastify, identity, explicitLinkUserId, now)
  }

  const existing = await fastify.prisma.oAuthAccount.findUnique({
    where: { provider_providerId: { provider: identity.provider, providerId: identity.providerId } },
  })
  if (existing) {
    await fastify.prisma.$transaction(async (tx: any) => {
      await tx.oAuthAccount.update({
        where: { provider_providerId: { provider: identity.provider, providerId: identity.providerId } },
        data: oauthAccountData(identity, now),
      })
      await syncUserFromProvider(tx, existing.userId, identity, now)
    })
    await cancelAccountDeletionIfPending(fastify.prisma, existing.userId)
    return { type: 'tokens', tokens: await issueTokens(fastify, existing.userId), userId: existing.userId, provider: identity.provider }
  }

  const userForLink = await findUserForAutoLink(fastify.prisma, identity)
  if (userForLink) {
    return {
      type: 'pending',
      token: await createPendingOAuth(fastify.prisma, 'link', identity, userForLink.id, now),
    }
  }

  if (identity.email) {
    const userByEmail = await fastify.prisma.user.findUnique({ where: { email: identity.email } })
    if (userByEmail) {
      throw new OAuthFlowError('이미 가입된 이메일입니다. 이메일 인증 기능이 준비된 뒤 기존 계정과 연결할 수 있습니다.', 409)
    }
  }

  return {
    type: 'pending',
    token: await createPendingOAuth(fastify.prisma, 'signup', identity, null, now),
  }
}

async function resolveExplicitOAuthLink(
  fastify: any,
  identity: OAuthIdentityInput,
  userId: string,
  now: Date
): Promise<OAuthResolution> {
  await fastify.prisma.$transaction(async (tx: any) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true },
    })
    if (!user) throw new OAuthFlowError('계정을 찾을 수 없습니다. 다시 로그인해주세요.', 404)

    const existingOAuth = await tx.oAuthAccount.findUnique({
      where: { provider_providerId: { provider: identity.provider, providerId: identity.providerId } },
      select: { id: true, userId: true },
    })
    if (existingOAuth) {
      await moveExistingOAuthToTargetUser(tx, existingOAuth, userId, identity, now)
      return
    }

    const existingProvider = await tx.oAuthAccount.findFirst({
      where: { userId, provider: identity.provider },
      select: { id: true },
    })
    if (existingProvider) {
      throw new OAuthFlowError(`${providerLabel(identity.provider)} 계정이 이미 연결되어 있습니다.`, 409)
    }

    await assertIdentityNotOwnedByAnotherUser(tx, identity, userId)
    await tx.oAuthAccount.create({
      data: {
        userId,
        ...oauthAccountData(identity, now),
      },
    })
    await syncUserFromProvider(tx, userId, identity, now)
  })

  await cancelAccountDeletionIfPending(fastify.prisma, userId)
  return { type: 'tokens', tokens: await issueTokens(fastify, userId), userId, provider: identity.provider }
}

async function findUserForAutoLink(prisma: any, identity: OAuthIdentityInput): Promise<any | null> {
  const candidates = new Map<string, any>()

  if (identity.email && identity.emailVerified) {
    const userByEmail = await prisma.user.findUnique({ where: { email: identity.email } })
    if (userByEmail?.emailVerifiedAt || userByEmail?.isEmailVerified) {
      candidates.set(userByEmail.id, userByEmail)
    }
  }

  if (identity.phone && identity.phoneVerified) {
    const usersByPhone = await prisma.user.findMany({
      where: { phone: identity.phone, phoneVerifiedAt: { not: null } },
      take: 2,
    })
    if (usersByPhone.length > 1) {
      throw new OAuthFlowError('같은 전화번호로 인증된 계정이 여러 개 있어 자동 연결할 수 없습니다.', 409)
    }
    if (usersByPhone.length === 1) candidates.set(usersByPhone[0].id, usersByPhone[0])
  }

  if (candidates.size > 1) {
    throw new OAuthFlowError('이메일과 전화번호가 서로 다른 기존 계정에 연결되어 있어 자동 연결할 수 없습니다.', 409)
  }

  return candidates.values().next().value ?? null
}

async function createPendingOAuth(
  prisma: any,
  action: OAuthAction,
  identity: OAuthIdentityInput,
  targetUserId: string | null,
  now: Date
) {
  const token = crypto.randomBytes(32).toString('base64url')
  await prisma.oAuthPendingSession.create({
    data: {
      tokenHash: hashToken(token),
      action,
      targetUserId,
      provider: identity.provider,
      providerId: identity.providerId,
      email: identity.email ?? null,
      emailVerified: Boolean(identity.email && identity.emailVerified),
      phone: identity.phone ?? null,
      phoneVerified: Boolean(identity.phone && identity.phoneVerified),
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl ?? null,
      expiresAt: new Date(now.getTime() + PENDING_OAUTH_TTL_MS),
    },
  })
  return token
}

async function findPendingOAuth(prisma: any, token?: string) {
  if (!token) return null
  const pending = await prisma.oAuthPendingSession.findUnique({
    where: { tokenHash: hashToken(token) },
  })
  if (!pending) return null

  if (pending.expiresAt <= new Date()) {
    await prisma.oAuthPendingSession.delete({ where: { id: pending.id } }).catch(() => {})
    return null
  }

  return pending
}

async function acceptPendingSignup(
  prisma: any,
  token: string | undefined,
  input: { handle?: string; displayName?: string; email?: string }
) {
  if (!token) throw new OAuthFlowError('소셜 로그인 요청이 없습니다.', 400)
  const tokenHash = hashToken(token)

  return prisma.$transaction(async (tx: any) => {
    const pending = await findPendingOAuth(tx, token)
    if (!pending || pending.tokenHash !== tokenHash || pending.action !== 'signup') {
      throw new OAuthFlowError('만료되었거나 유효하지 않은 회원가입 요청입니다.', 410)
    }

    const existingOAuth = await tx.oAuthAccount.findUnique({
      where: { provider_providerId: { provider: pending.provider, providerId: pending.providerId } },
    })
    if (existingOAuth) {
      await tx.oAuthPendingSession.delete({ where: { id: pending.id } })
      await cancelAccountDeletionIfPending(tx, existingOAuth.userId)
      return { userId: existingOAuth.userId, provider: pending.provider }
    }

    const displayName = sanitizeDisplayName(input.displayName) || pending.displayName
    const handle = sanitizeHandle(input.handle) || await generateUniqueHandle(tx, displayName)
    const email = pending.email && pending.emailVerified
      ? pending.email
      : normalizeEmail(input.email) || normalizeEmail(pending.email)
    const emailVerified = Boolean(email && pending.email === email && pending.emailVerified)

    if (!email) {
      throw new OAuthFlowError('이메일을 입력해주세요.', 400)
    }
    if (!isValidHandle(handle)) {
      throw new OAuthFlowError('아이디는 영문 소문자, 숫자, _만 사용해 2~20자로 입력해주세요.', 400)
    }

    const handleConflict = await tx.user.findUnique({ where: { handle } })
    if (handleConflict) throw new OAuthFlowError('이미 사용 중인 아이디입니다.', 409)

    const emailConflict = await tx.user.findUnique({ where: { email } })
    if (emailConflict) {
      throw new OAuthFlowError('이미 가입된 이메일입니다. 다시 소셜 로그인을 시도해주세요.', 409)
    }

    const now = new Date()
    const user = await tx.user.create({
      data: {
        email,
        isEmailVerified: emailVerified,
        emailVerifiedAt: emailVerified ? now : null,
        phone: pending.phone,
        phoneVerifiedAt: pending.phone && pending.phoneVerified ? now : null,
        handle,
        displayName,
        avatarUrl: pending.avatarUrl,
        lastLoginAt: now,
        oauthAccounts: { create: oauthAccountData(pending, now) },
      },
    })
    await tx.oAuthPendingSession.delete({ where: { id: pending.id } })
    return { userId: user.id, provider: pending.provider }
  })
}

async function acceptPendingLink(prisma: any, token?: string) {
  if (!token) throw new OAuthFlowError('소셜 로그인 요청이 없습니다.', 400)

  return prisma.$transaction(async (tx: any) => {
    const pending = await findPendingOAuth(tx, token)
    if (!pending || pending.action !== 'link' || !pending.targetUserId) {
      throw new OAuthFlowError('만료되었거나 유효하지 않은 계정 연결 요청입니다.', 410)
    }

    const existingOAuth = await tx.oAuthAccount.findUnique({
      where: { provider_providerId: { provider: pending.provider, providerId: pending.providerId } },
      select: { id: true, userId: true },
    })
    if (existingOAuth) {
      await tx.oAuthPendingSession.delete({ where: { id: pending.id } })
      await moveExistingOAuthToTargetUser(tx, existingOAuth, pending.targetUserId, pending, new Date())
      return { userId: pending.targetUserId, provider: pending.provider }
    }

    const existingProvider = await tx.oAuthAccount.findFirst({
      where: { userId: pending.targetUserId, provider: pending.provider },
      select: { id: true },
    })
    if (existingProvider) {
      throw new OAuthFlowError(`${providerLabel(pending.provider)} 계정이 이미 연결되어 있습니다.`, 409)
    }

    await assertIdentityNotOwnedByAnotherUser(tx, pending, pending.targetUserId)
    const now = new Date()
    await tx.oAuthAccount.create({
      data: {
        userId: pending.targetUserId,
        ...oauthAccountData(pending, now),
      },
    })
    await syncUserFromProvider(tx, pending.targetUserId, pending, now)
    await tx.oAuthPendingSession.delete({ where: { id: pending.id } })
    return { userId: pending.targetUserId, provider: pending.provider }
  })
}

async function moveExistingOAuthToTargetUser(
  prisma: any,
  existingOAuth: { id: string; userId: string },
  targetUserId: string,
  identity: OAuthIdentitySnapshot,
  now: Date
) {
  if (existingOAuth.userId === targetUserId) {
    await prisma.oAuthAccount.update({
      where: { provider_providerId: { provider: identity.provider, providerId: identity.providerId } },
      data: oauthAccountData(identity, now),
    })
    await syncUserFromProvider(prisma, targetUserId, identity, now)
    return
  }

  const sourceUserId = existingOAuth.userId
  const sourceAccounts = await prisma.oAuthAccount.findMany({
    where: { userId: sourceUserId },
    select: { id: true, provider: true },
  })
  const targetAccounts = await prisma.oAuthAccount.findMany({
    where: { userId: targetUserId },
    select: { id: true, provider: true },
  })
  const targetProviders = new Set(targetAccounts.map((account: { provider: string }) => account.provider))

  for (const account of sourceAccounts) {
    if (account.id !== existingOAuth.id && targetProviders.has(account.provider)) {
      throw new OAuthFlowError(
        `현재 계정에도 ${providerLabel(account.provider)} 계정이 이미 연결되어 있어 자동 병합할 수 없습니다.`,
        409
      )
    }
  }

  await releaseTransferredProviderContacts(prisma, sourceUserId, identity)

  for (const account of sourceAccounts) {
    if (account.id === existingOAuth.id) {
      await prisma.oAuthAccount.update({
        where: { id: account.id },
        data: {
          userId: targetUserId,
          ...oauthAccountData(identity, now),
        },
      })
    } else {
      await prisma.oAuthAccount.update({
        where: { id: account.id },
        data: { userId: targetUserId },
      })
    }
  }

  // The source account no longer owns these social login methods.
  await prisma.refreshToken.deleteMany({ where: { userId: sourceUserId } })
  await syncUserFromProvider(prisma, targetUserId, identity, now)
}

async function releaseTransferredProviderContacts(
  prisma: any,
  sourceUserId: string,
  identity: Pick<OAuthIdentitySnapshot, 'email' | 'phone'>
) {
  const source = await prisma.user.findUnique({
    where: { id: sourceUserId },
    select: { email: true, phone: true },
  })
  if (!source) return

  const data: Record<string, unknown> = {}
  if (identity.email && normalizeEmail(source.email) === normalizeEmail(identity.email)) {
    data.email = null
    data.isEmailVerified = false
    data.emailVerifiedAt = null
  }
  if (identity.phone && normalizeStoredPhone(source.phone) === normalizeStoredPhone(identity.phone)) {
    data.phone = null
    data.phoneCountry = null
    data.phoneVerifiedAt = null
  }

  if (Object.keys(data).length > 0) {
    await prisma.user.update({
      where: { id: sourceUserId },
      data,
    })
  }
}

async function assertIdentityNotOwnedByAnotherUser(
  prisma: any,
  identity: Pick<OAuthIdentitySnapshot, 'email' | 'emailVerified' | 'phone' | 'phoneVerified'>,
  userId: string
) {
  if (identity.email && identity.emailVerified) {
    const emailOwner = await prisma.user.findUnique({
      where: { email: identity.email },
      select: { id: true },
    })
    if (emailOwner && emailOwner.id !== userId) {
      throw new OAuthFlowError('이 이메일은 이미 다른 Unipass 계정에 연결되어 있습니다.', 409)
    }
  }

  if (identity.phone && identity.phoneVerified) {
    const phoneOwner = await prisma.user.findUnique({
      where: { phone: identity.phone },
      select: { id: true },
    })
    if (phoneOwner && phoneOwner.id !== userId) {
      throw new OAuthFlowError('이 전화번호는 이미 다른 Unipass 계정에 연결되어 있습니다.', 409)
    }
  }
}

async function syncUserFromProvider(
  prisma: any,
  userId: string,
  identity: Pick<OAuthIdentitySnapshot, 'email' | 'emailVerified' | 'phone' | 'phoneVerified' | 'avatarUrl'>,
  now: Date
) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return

  const data: Record<string, unknown> = { lastLoginAt: now }

  if (identity.avatarUrl && !user.avatarUrl) data.avatarUrl = identity.avatarUrl

  if (identity.email && identity.emailVerified) {
    if (!user.email) data.email = identity.email
    if (normalizeEmail(user.email) === identity.email || !user.email) {
      data.isEmailVerified = true
      data.emailVerifiedAt = user.emailVerifiedAt ?? now
    }
  }

  if (identity.phone && identity.phoneVerified) {
    const normalizedUserPhone = normalizeStoredPhone(user.phone)
    if (!user.phone || normalizedUserPhone === identity.phone) {
      data.phone = identity.phone
      data.phoneVerifiedAt = user.phoneVerifiedAt ?? now
    }
  }

  await prisma.user.update({ where: { id: userId }, data })
}

function oauthAccountData(input: OAuthIdentitySnapshot, now: Date) {
  return {
    provider: input.provider,
    providerId: input.providerId,
    email: input.email ?? null,
    emailVerified: Boolean(input.email && input.emailVerified),
    phone: input.phone ?? null,
    phoneVerified: Boolean(input.phone && input.phoneVerified),
    displayName: input.displayName,
    avatarUrl: input.avatarUrl ?? null,
    lastLoginAt: now,
  }
}

async function generateUniqueHandle(prisma: any, displayName: string) {
  const base = displayName
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 16) || 'user'

  let handle = base
  let suffix = 0

  while (true) {
    const conflict = await prisma.user.findUnique({ where: { handle } })
    if (!conflict) break
    suffix++
    handle = `${base}_${suffix}`
  }

  return handle
}

async function cleanupExpiredPendingOAuth(prisma: any, now: Date) {
  await prisma.oAuthPendingSession.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => {})
}

function normalizeEmail(email?: string | null) {
  const value = email?.trim().toLowerCase()
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return undefined
  return value
}

function normalizeUrl(url?: string | null) {
  const value = url?.trim()
  if (!value) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

function sanitizeDisplayName(displayName?: string | null) {
  return displayName?.trim().replace(/\s+/g, ' ').slice(0, 40) || ''
}

function sanitizeHandle(handle?: string | null) {
  return handle?.trim().toLowerCase().replace(/^@/, '') || ''
}

function isValidHandle(handle: string) {
  return /^[a-z0-9_]{2,20}$/.test(handle)
}

function toBoolean(value: unknown) {
  return value === true || value === 'true'
}

async function redirectWithResolution(fastify: any, request: any, reply: any, result: OAuthResolution, redirectUri?: string, returnTo?: OAuthStateData['returnTo']) {
  if (result.type === 'tokens') return redirectWithTokens(fastify, request, reply, result, redirectUri, returnTo)
  return redirectWithPending(reply, result.token, redirectUri, returnTo)
}

async function redirectWithTokens(fastify: any, request: any, reply: any, result: Extract<OAuthResolution, { type: 'tokens' }>, redirectUri?: string, returnTo?: OAuthStateData['returnTo']) {
  const { tokens, userId, provider } = result
  await recordLoginEvent(fastify.prisma, request, { userId, provider, redirectUri })
  if (redirectUri && returnTo !== 'account' && !tokens.requiresPhoneVerification) {
    await recordServiceUsage(fastify.prisma, userId, redirectUri)
    const url = new URL(redirectUri)
    url.searchParams.set('access_token', tokens.accessToken)
    url.searchParams.set('refresh_token', tokens.refreshToken)
    return reply.redirect(url.toString())
  }

  const params = new URLSearchParams({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  })
  if (tokens.requiresPhoneVerification && returnTo !== 'account') params.set('phone_required', '1')
  if (redirectUri) params.set('redirect_uri', redirectUri)
  const path = returnTo === 'account' ? '/account' : '/'
  return reply.redirect(`${path}?${params}`)
}

function redirectWithPending(reply: any, token: string, redirectUri?: string, returnTo?: OAuthStateData['returnTo']) {
  const params = new URLSearchParams({ oauth_pending: token })
  if (redirectUri) params.set('redirect_uri', redirectUri)
  const path = returnTo === 'account' ? '/account' : '/'
  return reply.redirect(`${path}?${params}`)
}

function redirectWithOAuthError(reply: any, message: string, redirectUri?: string, returnTo?: OAuthStateData['returnTo']) {
  const params = new URLSearchParams({ error: message })
  if (redirectUri) params.set('redirect_uri', redirectUri)
  const path = returnTo === 'account' ? '/account' : '/'
  return reply.redirect(`${path}?${params}`)
}

function handleOAuthError(fastify: any, reply: any, err: unknown, redirectUri?: string, returnTo?: OAuthStateData['returnTo']) {
  if (err instanceof OAuthFlowError) {
    return redirectWithOAuthError(reply, err.message, redirectUri, returnTo)
  }

  fastify.log.error({ err }, 'OAuth callback failed')
  return redirectWithOAuthError(reply, '소셜 로그인 처리 중 오류가 발생했습니다.', redirectUri, returnTo)
}

function sendOAuthApiError(reply: any, err: unknown) {
  if (err instanceof OAuthFlowError) {
    return reply.code(err.statusCode).send({ error: err.message })
  }
  return reply.code(500).send({ error: '소셜 로그인 처리 중 오류가 발생했습니다.' })
}

function buildOAuthAuthorizeUrl(
  provider: OAuthProvider,
  redirectUri?: string,
  linkToken?: string,
  returnTo?: OAuthStateData['returnTo']
) {
  const callbackUrl = provider === 'google'
    ? process.env.GOOGLE_CALLBACK_URL!
    : process.env.KAKAO_CALLBACK_URL!
  const params = new URLSearchParams({
    client_id: provider === 'google' ? process.env.GOOGLE_CLIENT_ID! : process.env.KAKAO_CLIENT_ID!,
    redirect_uri: callbackUrl,
    response_type: 'code',
  })

  if (provider === 'google') {
    params.set('scope', 'openid email profile')
    params.set('access_type', 'offline')
  } else {
    const scope = process.env.KAKAO_SCOPE ?? process.env.KAKAO_SCOPES ?? ''
    if (scope) params.set('scope', scope)
  }

  const state = encodeOAuthState({ redirectUri, linkToken, returnTo })
  if (state) params.set('state', state)

  return new URL(`${provider === 'google' ? GOOGLE_AUTH_URL : KAKAO_AUTH_URL}?${params}`)
}

function encodeOAuthState(input: OAuthStateData) {
  const normalizedRedirectUri = normalizeRedirectUri(input.redirectUri)
  const linkToken = normalizeLinkToken(input.linkToken)
  const returnTo = input.returnTo === 'account' ? input.returnTo : undefined
  if (!normalizedRedirectUri && !linkToken && !returnTo) return undefined

  return Buffer.from(JSON.stringify({
    ...(normalizedRedirectUri && { redirect_uri: normalizedRedirectUri }),
    ...(linkToken && { link_token: linkToken }),
    ...(returnTo && { return_to: returnTo }),
  })).toString('base64url')
}

function decodeOAuthState(state?: string): OAuthStateData {
  if (!state) return {}
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as {
      redirect_uri?: string
      link_token?: string
      return_to?: string
    }
    return {
      redirectUri: normalizeRedirectUri(parsed.redirect_uri),
      linkToken: normalizeLinkToken(parsed.link_token),
      returnTo: parsed.return_to === 'account' ? 'account' : undefined,
    }
  } catch {
    return {}
  }
}

async function resolveOAuthLinkUserId(fastify: any, token: string | undefined, provider: OAuthProvider) {
  if (!token) return undefined

  try {
    const claims = await fastify.jwt.verify(token) as OAuthLinkClaims
    if (claims.purpose !== 'oauth_link' || claims.provider !== provider || !claims.sub) {
      throw new OAuthFlowError('유효하지 않은 계정 연결 요청입니다.', 410)
    }
    return claims.sub
  } catch (err) {
    if (err instanceof OAuthFlowError) throw err
    throw new OAuthFlowError('계정 연결 요청이 만료되었습니다. 다시 시도해주세요.', 410)
  }
}

function normalizeRedirectUri(redirectUri?: string | null) {
  if (!redirectUri) return undefined
  try {
    const parsed = new URL(redirectUri)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

function normalizeLinkToken(token?: string | null) {
  const value = token?.trim()
  if (!value || value.length > 2000) return undefined
  return value
}

function isOAuthProvider(provider: unknown): provider is OAuthProvider {
  return provider === 'google' || provider === 'kakao'
}

function providerLabel(provider: string) {
  return provider === 'google' ? 'Google' : provider === 'kakao' ? 'Kakao' : provider
}

export default oauthRoutes
