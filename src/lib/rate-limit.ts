type FixedWindowEntry = {
  count: number
  resetAt: number
}

type FailureEntry = FixedWindowEntry & {
  blockedUntil?: number
}

export type RateLimitResult = {
  allowed: boolean
  retryAfterSeconds?: number
}

// Development-only in-memory limits. Replace with Redis/KV before running multiple app instances.
const fixedWindows = new Map<string, FixedWindowEntry>()
const cooldowns = new Map<string, number>()
const failures = new Map<string, FailureEntry>()

export function consumeFixedWindow(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const entry = fixedWindows.get(key)

  if (!entry || entry.resetAt <= now) {
    fixedWindows.set(key, { count: 1, resetAt: now + windowMs })
    cleanupMap(fixedWindows, now)
    return { allowed: true }
  }

  if (entry.count >= limit) {
    return { allowed: false, retryAfterSeconds: secondsUntil(entry.resetAt, now) }
  }

  entry.count += 1
  return { allowed: true }
}

export function consumeCooldown(key: string, cooldownMs: number): RateLimitResult {
  const now = Date.now()
  const retryAt = cooldowns.get(key)

  if (retryAt && retryAt > now) {
    return { allowed: false, retryAfterSeconds: secondsUntil(retryAt, now) }
  }

  cooldowns.set(key, now + cooldownMs)
  cleanupCooldowns(now)
  return { allowed: true }
}

export function getFailureBlock(key: string): RateLimitResult {
  const now = Date.now()
  const entry = failures.get(key)
  if (!entry?.blockedUntil || entry.blockedUntil <= now) return { allowed: true }
  return { allowed: false, retryAfterSeconds: secondsUntil(entry.blockedUntil, now) }
}

export function recordFailure(key: string, limit: number, windowMs: number, blockMs: number): RateLimitResult {
  const now = Date.now()
  let entry = failures.get(key)

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs }
    failures.set(key, entry)
  }

  entry.count += 1
  if (entry.count >= limit) {
    entry.blockedUntil = now + blockMs
    return { allowed: false, retryAfterSeconds: secondsUntil(entry.blockedUntil, now) }
  }

  cleanupFailures(now)
  return { allowed: true }
}

export function resetFailures(key: string) {
  failures.delete(key)
}

function cleanupMap(map: Map<string, FixedWindowEntry>, now: number) {
  if (map.size < 1000) return
  for (const [key, entry] of map) {
    if (entry.resetAt <= now) map.delete(key)
  }
}

function cleanupCooldowns(now: number) {
  if (cooldowns.size < 1000) return
  for (const [key, retryAt] of cooldowns) {
    if (retryAt <= now) cooldowns.delete(key)
  }
}

function cleanupFailures(now: number) {
  if (failures.size < 1000) return
  for (const [key, entry] of failures) {
    const retryAt = entry.blockedUntil ?? entry.resetAt
    if (retryAt <= now) failures.delete(key)
  }
}

function secondsUntil(timestamp: number, now: number) {
  return Math.max(1, Math.ceil((timestamp - now) / 1000))
}
