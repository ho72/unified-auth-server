import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

export const SUPPORTED_PHONE_COUNTRIES = ['KR', 'US'] as const
export type SupportedPhoneCountry = typeof SUPPORTED_PHONE_COUNTRIES[number]

export type NormalizedPhoneNumber = {
  country: SupportedPhoneCountry
  e164: string
}

export class PhoneValidationError extends Error {}

export function normalizePhoneCountry(country?: string | null): SupportedPhoneCountry {
  const normalized = country?.trim().toUpperCase()
  if (normalized === 'KR' || normalized === 'US') return normalized
  throw new PhoneValidationError('지원하지 않는 국가입니다.')
}

export function normalizePhoneNumber(phone?: string | null, country?: string | null): NormalizedPhoneNumber {
  const normalizedCountry = normalizePhoneCountry(country)
  const value = phone?.trim()
  if (!value) throw new PhoneValidationError('전화번호를 입력해주세요.')

  const parsed = parsePhoneNumberFromString(value, normalizedCountry as CountryCode)
  if (!parsed || !parsed.isValid()) {
    throw new PhoneValidationError('전화번호 형식이 올바르지 않아요.')
  }

  if (parsed.country && parsed.country !== normalizedCountry) {
    throw new PhoneValidationError('전화번호 국가가 일치하지 않아요.')
  }

  return { country: normalizedCountry, e164: parsed.number }
}

export function normalizeStoredPhone(phone?: string | null) {
  const value = phone?.trim()
  if (!value) return undefined

  const parsed = parsePhoneNumberFromString(value)
  return parsed?.isValid() ? parsed.number : undefined
}
