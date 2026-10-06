import type { FastifyRequest } from 'fastify'
import { registeredServiceForRedirect } from './services.js'

type LoginEventInput = {
  userId: string
  provider?: string | null
  redirectUri?: string | null
}

export async function recordLoginEvent(prisma: any, request: FastifyRequest, input: LoginEventInput) {
  const service = registeredServiceForRedirect(input.redirectUri)
  const client = clientContext(request)

  await prisma.loginEvent.create({
    data: {
      userId: input.userId,
      provider: clean(input.provider),
      serviceKey: service?.key ?? (input.redirectUri ? clean(originKey(input.redirectUri)) : 'unipass'),
      serviceName: service?.name ?? (input.redirectUri ? clean(originName(input.redirectUri)) : 'Unipass'),
      serviceOrigin: service?.origin ?? clean(originValue(input.redirectUri)),
      ip: client.ip,
      country: client.country,
      region: client.region,
      city: client.city,
      userAgent: client.userAgent,
    },
  }).catch(() => {
    // Login should not fail because audit logging failed.
  })
}

function clientContext(request: FastifyRequest) {
  return {
    ip: firstHeader(request, 'cf-connecting-ip') ??
      firstForwardedFor(request) ??
      firstHeader(request, 'x-real-ip') ??
      clean(request.ip),
    country: firstHeader(request, 'cf-ipcountry') ??
      firstHeader(request, 'x-vercel-ip-country') ??
      firstHeader(request, 'x-country-code'),
    region: firstHeader(request, 'cf-region') ??
      firstHeader(request, 'cf-region-code') ??
      firstHeader(request, 'x-vercel-ip-country-region'),
    city: firstHeader(request, 'cf-ipcity') ??
      firstHeader(request, 'x-vercel-ip-city'),
    userAgent: firstHeader(request, 'user-agent'),
  }
}

function firstForwardedFor(request: FastifyRequest) {
  const value = firstHeader(request, 'x-forwarded-for')
  return clean(value?.split(',')[0])
}

function firstHeader(request: FastifyRequest, name: string) {
  const value = request.headers[name]
  if (Array.isArray(value)) return clean(value[0])
  return clean(value)
}

function clean(value?: string | null) {
  const text = value?.trim()
  return text ? text.slice(0, 500) : null
}

function originValue(value?: string | null) {
  try {
    return value ? new URL(value).origin : null
  } catch {
    return null
  }
}

function originKey(value?: string | null) {
  try {
    const host = value ? new URL(value).hostname : ''
    return host.split('.')[0] || null
  } catch {
    return null
  }
}

function originName(value?: string | null) {
  const key = originKey(value)
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : null
}
