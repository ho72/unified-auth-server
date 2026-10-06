import crypto from 'crypto'

export async function issueTokens(fastify: any, userId: string) {
  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, handle: true, displayName: true, avatarUrl: true, phoneVerifiedAt: true },
  })
  if (!user) throw new Error('User not found')

  const accessToken = fastify.jwt.sign(
    { sub: user.id, handle: user.handle, displayName: user.displayName, avatarUrl: user.avatarUrl },
    { expiresIn: '15m' }
  )

  const refreshToken = crypto.randomBytes(40).toString('hex')
  const tokenHash = hashToken(refreshToken)
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  await fastify.prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  })

  return { accessToken, refreshToken, requiresPhoneVerification: !user.phoneVerifiedAt }
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}
