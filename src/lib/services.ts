type RegisteredService = {
  key: string
  name: string
  origin: string
  iconUrl: string | null
}

function serviceOrigin(envName: string, fallback: string): string {
  return normalizedOrigin(process.env[envName] ?? fallback) ?? fallback
}

const REGISTERED_SERVICES: RegisteredService[] = [
  { key: 'nook', name: 'Nook', origin: serviceOrigin('NOOK_ORIGIN', 'http://localhost:5173'), iconUrl: null },
  { key: 'ouri', name: 'Ouri', origin: serviceOrigin('OURI_ORIGIN', 'http://localhost:5174'), iconUrl: null },
  { key: 'devi', name: 'Devi', origin: serviceOrigin('DEVI_ORIGIN', 'http://localhost:4050'), iconUrl: null },
]

export function registeredServiceForRedirect(redirectUri?: string | null): RegisteredService | null {
  const origin = normalizedOrigin(redirectUri)
  if (!origin) return null
  return REGISTERED_SERVICES.find((service) => service.origin === origin) ?? null
}

export async function recordServiceUsage(prisma: any, userId: string, redirectUri?: string | null) {
  const registered = registeredServiceForRedirect(redirectUri)
  if (!registered) return null

  const service = await prisma.service.upsert({
    where: { key: registered.key },
    create: {
      key: registered.key,
      name: registered.name,
      origin: registered.origin,
      iconUrl: registered.iconUrl,
      enabled: true,
    },
    update: {
      name: registered.name,
      origin: registered.origin,
      iconUrl: registered.iconUrl,
      enabled: true,
    },
    select: { id: true },
  })

  return prisma.userService.upsert({
    where: {
      userId_serviceId: {
        userId,
        serviceId: service.id,
      },
    },
    create: {
      userId,
      serviceId: service.id,
      loginCount: 1,
    },
    update: {
      lastUsedAt: new Date(),
      loginCount: { increment: 1 },
    },
  })
}

function normalizedOrigin(value?: string | null) {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}
