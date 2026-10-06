type TwilioVerifyConfig = {
  accountSid: string
  apiKeySid: string
  apiKeySecret: string
  verifyServiceSid: string
}

type TwilioVerifyResponse = {
  status?: string
  sid?: string
  to?: string
}

type TwilioErrorResponse = {
  code?: number
  message?: string
  status?: number
}

export class TwilioVerifyConfigError extends Error {}

export class TwilioVerifyRequestError extends Error {
  statusCode: number
  twilioCode?: number

  constructor(message: string, statusCode: number, twilioCode?: number) {
    super(message)
    this.statusCode = statusCode
    this.twilioCode = twilioCode
  }
}

export async function startTwilioVerification(to: string) {
  return twilioVerifyPost<TwilioVerifyResponse>('Verifications', {
    To: to,
    Channel: 'sms',
  })
}

export async function checkTwilioVerification(to: string, code: string) {
  return twilioVerifyPost<TwilioVerifyResponse>('VerificationCheck', {
    To: to,
    Code: code,
  })
}

function getTwilioVerifyConfig(): TwilioVerifyConfig {
  return {
    accountSid: requireEnv('TWILIO_ACCOUNT_SID'),
    apiKeySid: requireEnv('TWILIO_API_KEY_SID'),
    apiKeySecret: requireEnv('TWILIO_API_KEY_SECRET'),
    verifyServiceSid: requireEnv('TWILIO_VERIFY_SERVICE_SID'),
  }
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new TwilioVerifyConfigError(`${name} is required`)
  return value
}

async function twilioVerifyPost<T>(path: 'Verifications' | 'VerificationCheck', body: Record<string, string>): Promise<T> {
  const config = getTwilioVerifyConfig()
  const url = new URL(`https://verify.twilio.com/v2/Services/${encodeURIComponent(config.verifyServiceSid)}/${path}`)
  const auth = Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`).toString('base64')

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  })

  const data = await parseTwilioJson(res)
  if (!res.ok) {
    throw new TwilioVerifyRequestError('Twilio Verify request failed', res.status, data?.code)
  }

  return data as T
}

async function parseTwilioJson(res: Response): Promise<TwilioErrorResponse & TwilioVerifyResponse> {
  const text = await res.text()
  if (!text) return {}

  try {
    return JSON.parse(text) as TwilioErrorResponse & TwilioVerifyResponse
  } catch {
    return {}
  }
}
