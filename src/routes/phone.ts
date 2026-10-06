import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { normalizePhoneNumber, PhoneValidationError } from '../lib/phone.js'
import {
  checkTwilioVerification,
  startTwilioVerification,
  TwilioVerifyConfigError,
  TwilioVerifyRequestError,
} from '../lib/twilio-verify.js'
import {
  consumeCooldown,
  consumeFixedWindow,
  getFailureBlock,
  recordFailure,
  resetFailures,
} from '../lib/rate-limit.js'

const TEN_MINUTES_MS = 10 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const CHECK_BLOCK_MS = 15 * 60 * 1000
const CHECK_FAILURE_WINDOW_MS = 10 * 60 * 1000

type PhoneStartBody = {
  phone?: string
  country?: string
}

type PhoneCheckBody = PhoneStartBody & {
  code?: string
}

const phoneRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /auth/phone/start
  fastify.post('/phone/start', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { sub: userId } = request.user as { sub: string }
    const body = request.body as PhoneStartBody
    const phone = parsePhoneInput(body)
    if (!phone.ok) return reply.code(400).send({ ok: false, message: phone.message })

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, phoneVerifiedAt: true },
    })
    if (!user) return reply.code(404).send({ ok: false, message: '사용자를 찾을 수 없습니다.' })

    if (user.phone === phone.e164 && user.phoneVerifiedAt) {
      return reply.send({
        ok: true,
        alreadyVerified: true,
        message: '이미 인증된 전화번호입니다.',
        cooldownSeconds: 0,
      })
    }

    const duplicate = await fastify.prisma.user.findFirst({
      where: { phone: phone.e164, NOT: { id: userId } },
      select: { id: true },
    })
    if (duplicate) {
      return reply.code(409).send({ ok: false, message: '이미 다른 계정에 연결된 전화번호입니다.' })
    }

    const rateLimited = [
      consumeFixedWindow(`phone:start:ip:${clientIp(request)}`, 3, TEN_MINUTES_MS),
      consumeFixedWindow(`phone:start:phone:${phone.e164}`, 3, TEN_MINUTES_MS),
      consumeFixedWindow(`phone:start:user:${userId}`, 5, ONE_HOUR_MS),
      consumeCooldown(`phone:start:cooldown:${userId}:${phone.e164}`, RESEND_COOLDOWN_MS),
    ].find((result) => !result.allowed)

    if (rateLimited) {
      return reply.code(429).send({
        ok: false,
        message: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.',
        cooldownSeconds: rateLimited.retryAfterSeconds ?? 60,
      })
    }

    try {
      await startTwilioVerification(phone.e164)
      return reply.send({
        ok: true,
        message: '인증번호를 발송했어요.',
        cooldownSeconds: 60,
      })
    } catch (err) {
      if (err instanceof TwilioVerifyConfigError) {
        fastify.log.error({ err: err.message }, 'Twilio Verify is not configured')
        return reply.code(500).send({ ok: false, message: '전화번호 인증 설정을 확인해주세요.' })
      }

      if (err instanceof TwilioVerifyRequestError) {
        fastify.log.warn({
          statusCode: err.statusCode,
          twilioCode: err.twilioCode,
          to: maskPhone(phone.e164),
          country: phone.country,
        }, 'Twilio verification start failed')
        if (err.twilioCode === 21608) {
          return reply.code(403).send({
            ok: false,
            message: '현재 SMS를 발송할 수 없는 번호예요. Twilio 수신 번호 설정을 확인해주세요.',
          })
        }
      } else {
        fastify.log.error({ err }, 'Twilio verification start failed')
      }

      return reply.code(502).send({
        ok: false,
        message: '인증번호를 발송하지 못했어요. 잠시 후 다시 시도해주세요.',
      })
    }
  })

  // POST /auth/phone/check
  fastify.post('/phone/check', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { sub: userId } = request.user as { sub: string }
    const body = request.body as PhoneCheckBody
    const phone = parsePhoneInput(body)
    if (!phone.ok) return reply.code(400).send({ ok: false, message: phone.message })

    const code = body.code?.trim()
    if (!code || !/^\d{4,10}$/.test(code)) {
      return reply.code(400).send({ ok: false, message: '인증번호 형식이 올바르지 않아요.' })
    }

    const failureKey = `phone:check:failure:${userId}:${phone.e164}`
    const blocked = getFailureBlock(failureKey)
    if (!blocked.allowed) {
      return reply.code(429).send({
        ok: false,
        message: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.',
        retryAfterSeconds: blocked.retryAfterSeconds,
      })
    }

    try {
      const verification = await checkTwilioVerification(phone.e164, code)
      if (verification.status !== 'approved') {
        const failure = recordFailure(failureKey, 5, CHECK_FAILURE_WINDOW_MS, CHECK_BLOCK_MS)
        if (!failure.allowed) {
          return reply.code(429).send({
            ok: false,
            message: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.',
            retryAfterSeconds: failure.retryAfterSeconds,
          })
        }

        return reply.code(400).send({
          ok: false,
          message: verification.status === 'expired'
            ? '인증번호가 만료되었어요. 다시 받아주세요.'
            : '인증번호가 올바르지 않아요.',
        })
      }
    } catch (err) {
      if (err instanceof TwilioVerifyConfigError) {
        fastify.log.error({ err: err.message }, 'Twilio Verify is not configured')
        return reply.code(500).send({ ok: false, message: '전화번호 인증 설정을 확인해주세요.' })
      }

      if (err instanceof TwilioVerifyRequestError) {
        fastify.log.warn({ statusCode: err.statusCode, twilioCode: err.twilioCode }, 'Twilio verification check failed')
        if (err.statusCode === 404 || err.twilioCode === 20404) {
          recordFailure(failureKey, 5, CHECK_FAILURE_WINDOW_MS, CHECK_BLOCK_MS)
          return reply.code(400).send({ ok: false, message: '인증번호가 만료되었어요. 다시 받아주세요.' })
        }
      } else {
        fastify.log.error({ err }, 'Twilio verification check failed')
      }

      return reply.code(502).send({
        ok: false,
        message: '인증번호를 확인하지 못했어요. 잠시 후 다시 시도해주세요.',
      })
    }

    const duplicate = await fastify.prisma.user.findFirst({
      where: { phone: phone.e164, NOT: { id: userId } },
      select: { id: true },
    })
    if (duplicate) {
      return reply.code(409).send({ ok: false, message: '이미 다른 계정에 연결된 전화번호입니다.' })
    }

    try {
      await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          phone: phone.e164,
          phoneCountry: phone.country,
          phoneVerifiedAt: new Date(),
        },
      })
      resetFailures(failureKey)
      return reply.send({ ok: true, message: '전화번호 인증이 완료되었어요.' })
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return reply.code(409).send({ ok: false, message: '이미 다른 계정에 연결된 전화번호입니다.' })
      }

      fastify.log.error({ err }, 'Phone verification update failed')
      return reply.code(500).send({ ok: false, message: '전화번호 인증 상태를 저장하지 못했어요.' })
    }
  })
}

type ParsedPhoneInput =
  | { ok: true; e164: string; country: 'KR' | 'US' }
  | { ok: false; message: string }

function parsePhoneInput(body: PhoneStartBody): ParsedPhoneInput {
  try {
    const phone = normalizePhoneNumber(body.phone, body.country)
    return { ok: true, ...phone }
  } catch (err) {
    if (err instanceof PhoneValidationError) {
      return { ok: false, message: '전화번호 형식이 올바르지 않아요.' }
    }
    return { ok: false, message: '전화번호를 확인해주세요.' }
  }
}

function clientIp(request: FastifyRequest) {
  return request.ip || 'unknown'
}

function isUniqueConstraintError(err: unknown) {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002'
}

function maskPhone(phone: string) {
  return phone.replace(/\d(?=\d{4})/g, '*')
}

export default phoneRoutes
