const API = ''
const providerNames = { google: 'Google', kakao: 'Kakao' }
const providerButtonLabels = {
  google: { idle: 'Google로 계속하기', loading: 'Google 연결 중...' },
  kakao: { idle: '카카오로 계속하기', loading: '카카오 연결 중...' },
}
const TOKEN_STORAGE_KEY = 'unipass.authTokens'
const PHONE_VALIDITY_SECONDS = 180

let pendingToken = null
let pendingData = null
let handleTimer = null
let oauthLoadingProvider = null
let authTokens = null
let authCompletion = null
let accountData = null
let socialLinkLoadingProvider = null
let phoneCodeTimer = null
let phoneCodeSecondsLeft = 0
let phoneResendSecondsLeft = 0
let phoneRequestSent = false
let toastTimer = null

function $(id) {
  return document.getElementById(id)
}

const iconSvg = {
  google: '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
  kakao: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#191919" d="M12 3C6.99 3 3 6.2 3 10.13c0 2.5 1.67 4.7 4.2 5.96-.16.55-.86 2.98-.88 3.18 0 0-.02.16.09.22.1.06.23.01.23.01.3-.04 3.46-2.27 4.01-2.65.43.06.88.09 1.35.09 5.01 0 9-3.2 9-7.13S17.01 3 12 3z"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.6V8.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.2" r="1" fill="currentColor"/></svg>',
  'chevron-left': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 5L8 12L15 19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'chevron-right': '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 5L16 12L9 19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  camera: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 8.5C3 7.4 3.9 6.5 5 6.5H7L8.2 4.6C8.4 4.2 8.8 4 9.2 4H14.8C15.2 4 15.6 4.2 15.8 4.6L17 6.5H19C20.1 6.5 21 7.4 21 8.5V17C21 18.1 20.1 19 19 19H5C3.9 19 3 18.1 3 17V8.5Z" stroke="#1B2030" stroke-width="1.8"/><circle cx="12" cy="12.5" r="3.2" stroke="#1B2030" stroke-width="1.8"/></svg>',
  phone: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 18.3H13.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  mail: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M4 7L11.1 12.1C11.66 12.5 12.34 12.5 12.9 12.1L20 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  lock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 10.5V8C7.5 5.5 9.5 3.5 12 3.5C14.5 3.5 16.5 5.5 16.5 8V10.5" stroke="currentColor" stroke-width="1.8"/></svg>',
  refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12C4 7.6 7.6 4 12 4C14.7 4 17.1 5.35 18.5 7.4M20 12C20 16.4 16.4 20 12 20C9.3 20 6.9 18.65 5.5 16.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M18.5 3.5V7.5H14.5M5.5 20.5V16.5H9.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  at: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M16 8.5V13C16 14.4 17 15.5 18.2 15.5C19.5 15.5 20.3 14.3 20.4 13C20.8 8.3 17.5 4 12.3 4C7.2 4 3.5 8 3.5 12.3C3.5 16.7 7 20 12 20C13.7 20 15.2 19.6 16.4 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  link: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.5 14.5L14.5 9.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M11 7L12.5 5.5C14.2 3.8 16.8 3.8 18.5 5.5C20.2 7.2 20.2 9.8 18.5 11.5L17 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M13 17L11.5 18.5C9.8 20.2 7.2 20.2 5.5 18.5C3.8 16.8 3.8 14.2 5.5 12.5L7 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  clock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.8V12L14.8 13.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sparkle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3L13.4 8.6L19 10L13.4 11.4L12 17L10.6 11.4L5 10L10.6 8.6L12 3Z" fill="currentColor"/></svg>',
  shield: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3L19 6V11C19 15.5 16 19 12 21C8 19 5 15.5 5 11V6L12 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12L11 14L15 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

function renderStaticIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const icon = iconSvg[el.dataset.icon]
    if (icon) el.innerHTML = icon
  })
}

function show(view) {
  document.documentElement.classList.remove('auth-returning')
  $('return-view').classList.toggle('hidden', view !== 'return')
  $('main-view').classList.toggle('hidden', view !== 'main')
  $('pending-view').classList.toggle('hidden', view !== 'pending')
  $('phone-view').classList.toggle('hidden', view !== 'phone')
  $('account-view').classList.toggle('hidden', view !== 'account')
  $('login-history-view').classList.toggle('hidden', view !== 'login-history')
  if (view !== 'main') resetProviderLoading()
}

function showReturnView(redirectUrl) {
  const label = serviceLabelFromUrl(redirectUrl)
  $('return-title').textContent = '로그인 완료'
  $('return-copy').textContent = label
    ? `${label}로 돌아가는 중입니다.`
    : '요청한 서비스로 돌아가는 중입니다.'
  $('return-target').textContent = '잠시만 기다려 주세요.'
  show('return')
}

function setMsg(el, text, type) {
  if (!el) return
  el.textContent = text || ''
  el.className = 'message' + (text ? ` show ${type}` : '')
}

function showToast(text, icon = iconSvg.check) {
  const toast = $('toast')
  clearTimeout(toastTimer)
  toast.innerHTML = `${icon || ''}<span>${escapeHtml(text)}</span>`
  toast.classList.remove('hidden')
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2200)
}

function getAccessToken() {
  ensureStoredTokens()
  return authTokens?.accessToken
}

function storeAuthTokens(tokens) {
  authTokens = tokens
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens))
  } catch {}
}

function ensureStoredTokens() {
  if (authTokens?.accessToken) return authTokens
  try {
    const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    if (stored) authTokens = JSON.parse(stored)
  } catch {
    authTokens = null
  }
  return authTokens
}

function clearAuthTokens() {
  authTokens = null
  authCompletion = null
  accountData = null
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {}
}

function getOAuthErrorMessage(error) {
  const fallback = '로그인을 완료하지 못했어요. 다시 시도해주세요.'
  if (!error) return fallback
  const normalized = error.trim().toLowerCase()
  if (['access_denied', 'cancelled', 'canceled', 'oauth_error', 'auth_error', 'error'].includes(normalized)) {
    return fallback
  }
  return error
}

function setProviderLoading(provider) {
  oauthLoadingProvider = provider
  for (const key of Object.keys(providerButtonLabels)) {
    const button = document.querySelector(`[data-provider-button="${key}"]`)
    if (!button) continue
    const isLoading = key === provider
    const label = button.querySelector('.button-label')
    button.disabled = true
    button.classList.toggle('is-loading', isLoading)
    button.setAttribute('aria-busy', isLoading ? 'true' : 'false')
    if (label) label.textContent = isLoading ? providerButtonLabels[key].loading : providerButtonLabels[key].idle
  }
}

function resetProviderLoading() {
  oauthLoadingProvider = null
  for (const key of Object.keys(providerButtonLabels)) {
    const button = document.querySelector(`[data-provider-button="${key}"]`)
    if (!button) continue
    const label = button.querySelector('.button-label')
    button.disabled = false
    button.classList.remove('is-loading')
    button.removeAttribute('aria-busy')
    if (label) label.textContent = providerButtonLabels[key].idle
  }
}

function resetTransientLoadingState() {
  resetProviderLoading()
  if (socialLinkLoadingProvider) {
    socialLinkLoadingProvider = null
    if (accountData) renderSocialAccounts(accountData.oauthAccounts || [])
  }
}

function handleSocial(provider) {
  if (oauthLoadingProvider) return
  const params = new URLSearchParams(window.location.search)
  const redirect = params.get('redirect_uri')
  const url = new URL(`${API}/auth/${provider}`, window.location.origin)
  if (redirect) url.searchParams.set('redirect_uri', redirect)
  setProviderLoading(provider)
  window.location.href = url.toString()
}

async function loadPending(token) {
  pendingToken = token
  pendingData = null
  show('pending')
  $('pending-title').textContent = '확인 중'
  $('pending-profile-sub').textContent = ''
  $('pending-primary').disabled = true
  $('signup-fields').classList.add('hidden')
  $('pending-proofs').innerHTML = ''
  setMsg($('pending-message'), '', '')

  try {
    const res = await fetch(`${API}/auth/oauth/pending?token=${encodeURIComponent(token)}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '소셜 로그인 요청을 확인할 수 없습니다.')
    pendingData = data
    renderPending(data)
  } catch (err) {
    show('main')
    setMsg($('main-message'), err.message || '소셜 로그인 요청을 확인할 수 없습니다.', 'err')
  }
}

function renderPending(data) {
  const provider = providerNames[data.provider] || data.provider
  const isSignup = data.action === 'signup'
  const target = data.targetUser || {}
  const profileName = isSignup
    ? (data.displayName || provider)
    : (target.displayName || data.displayName || provider)
  const profileSub = isSignup
    ? `${provider} 계정으로 새 Unipass 계정을 만들고 있어요.`
    : (target.handle ? `@${target.handle}` : `${provider} 계정 연결`)

  $('pending-title').textContent = isSignup ? '계정 정보를 확인해 주세요' : '계정을 연결할까요?'
  $('pending-profile-sub').textContent = profileSub
  $('pending-primary').textContent = isSignup ? '가입하고 시작하기' : `${provider} 연결하기`
  $('pending-primary').disabled = false
  $('signup-fields').classList.toggle('hidden', !isSignup)
  $('pending-stepper').classList.toggle('hidden', !isSignup)

  const banner = $('pending-banner')
  banner.classList.toggle('is-link', !isSignup)
  $('pending-banner-icon').dataset.icon = isSignup ? 'sparkle' : 'link'
  $('pending-banner-copy').innerHTML = isSignup
    ? `<b>${escapeHtml(provider)}</b> 계정으로 새 Unipass 계정을 만들고 있어요.`
    : `기존 Unipass 계정에 <b>${escapeHtml(provider)}</b>을(를) 연결합니다.`
  renderStaticIcons(banner)

  renderAvatar($('pending-avatar'), target.avatarUrl || data.avatarUrl, profileName)
  renderProofs(data)

  if (isSignup) {
    $('display-name').value = data.displayName || ''
    $('email').value = data.email || ''
    $('email').readOnly = Boolean(data.email && data.emailVerified)
    $('email-wrap').classList.toggle('is-readonly', $('email').readOnly)
    $('handle').value = data.suggestedHandle || ''
    setHandleHint(
      data.suggestedHandle ? `'@${data.suggestedHandle}' 사용할 수 있어요.` : '영문 소문자, 숫자, 밑줄(_)로 2~20자까지 사용할 수 있어요.',
      data.suggestedHandle ? 'ok' : 'hint'
    )
  }
}

function renderProofs(data) {
  const proofs = []
  if (data.email) proofs.push(data.email)
  if (data.phone) proofs.push(formatStoredPhone(data.phone))

  const root = $('pending-proofs')
  root.innerHTML = ''
  for (const text of proofs) {
    const item = document.createElement('div')
    item.className = 'proof'
    item.innerHTML = `${iconSvg.check}<span>${escapeHtml(text)}</span>`
    root.appendChild(item)
  }
}

function onHandleInput() {
  const input = $('handle')
  input.value = input.value.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '').slice(0, 20)
  const value = input.value

  clearTimeout(handleTimer)
  $('handle-suffix').innerHTML = ''
  $('handle-wrap').classList.remove('is-ok', 'is-error')

  if (!value) return setHandleHint('아이디를 입력해주세요.', 'err')
  if (!/^[a-z0-9_]{2,20}$/.test(value)) {
    $('handle-wrap').classList.add('is-error')
    return setHandleHint('영문 소문자, 숫자, _만 사용해 2~20자로 입력해주세요.', 'err')
  }

  setHandleHint('사용 가능한지 확인하고 있어요...', 'hint')
  $('handle-suffix').innerHTML = '<span class="spinner dark" style="width:17px;height:17px"></span>'
  handleTimer = setTimeout(async () => {
    try {
      const res = await fetch(`${API}/auth/check-handle?handle=${encodeURIComponent(value)}`)
      const data = await res.json()
      $('handle-wrap').classList.toggle('is-ok', Boolean(data.available))
      $('handle-wrap').classList.toggle('is-error', !data.available)
      $('handle-suffix').innerHTML = data.available ? iconSvg.check : iconSvg.alert
      setHandleHint(
        data.available ? `'@${value}' 사용할 수 있어요.` : '이미 사용 중인 아이디예요. 다른 아이디를 입력해 주세요.',
        data.available ? 'ok' : 'err'
      )
    } catch {
      $('handle-suffix').innerHTML = ''
      setHandleHint('아이디 확인을 완료하지 못했어요. 가입 시 다시 확인합니다.', 'hint')
    }
  }, 300)
}

function setHandleHint(text, type) {
  const hint = $('handle-hint')
  hint.innerHTML = `${type === 'err' ? iconSvg.alert : type === 'ok' ? iconSvg.check : ''}<span>${escapeHtml(text || '')}</span>`
  hint.className = `field-msg ${type || 'hint'}`
}

async function submitPending() {
  if (!pendingToken || !pendingData) return

  const isSignup = pendingData.action === 'signup'
  const body = isSignup
    ? {
        token: pendingToken,
        displayName: $('display-name').value.trim(),
        email: $('email').value.trim(),
        handle: $('handle').value.trim(),
      }
    : { token: pendingToken }
  const redirectUri = new URLSearchParams(window.location.search).get('redirect_uri')
  if (redirectUri) body.redirectUri = redirectUri

  if (isSignup) {
    if (!body.displayName) return setMsg($('pending-message'), '이름을 입력해주세요.', 'err')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return setMsg($('pending-message'), '이메일을 확인해주세요.', 'err')
    }
    if (!/^[a-z0-9_]{2,20}$/.test(body.handle)) {
      return setMsg($('pending-message'), '아이디를 확인해주세요.', 'err')
    }
  }

  const endpoint = isSignup ? '/auth/oauth/signup' : '/auth/oauth/link'
  const button = $('pending-primary')
  button.disabled = true
  button.classList.add('is-loading')
  setMsg($('pending-message'), '', '')

  try {
    const res = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '처리하지 못했습니다.')
    onSuccess(data)
  } catch (err) {
    setMsg($('pending-message'), err.message || '처리하지 못했습니다.', 'err')
  } finally {
    button.disabled = false
    button.classList.remove('is-loading')
  }
}

function cancelPending() {
  pendingToken = null
  pendingData = null
  history.replaceState(null, '', '/')
  setMsg($('main-message'), '', '')
  show('main')
}

function currentAuthCompletion() {
  const params = new URLSearchParams(window.location.search)
  return {
    opener: Boolean(window.opener),
    redirect: params.get('redirect_uri'),
    phoneRequired: params.get('phone_required') === '1',
    accountReturn: false,
  }
}

function needsPhoneVerification(tokens, completion) {
  return completion.phoneRequired || tokens.requiresPhoneVerification === true || tokens.requiresPhoneVerification === 'true'
}

function continueAfterVerification(tokens, completion = authCompletion || currentAuthCompletion()) {
  if (completion.opener && window.opener) {
    showReturnView()
    window.opener.postMessage({
      type: 'UNIPASS_AUTH',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }, '*')
    window.close()
    return
  }

  if (completion.redirect) {
    showReturnView(completion.redirect)
    const url = new URL(completion.redirect)
    url.searchParams.set('access_token', tokens.accessToken)
    url.searchParams.set('refresh_token', tokens.refreshToken)
    recordServiceUsageForRedirect(completion.redirect, tokens)
      .finally(() => {
        window.location.href = url.toString()
      })
  }
}

function onSuccess(tokens) {
  const completion = currentAuthCompletion()

  if (needsPhoneVerification(tokens, completion)) {
    storeAuthTokens(tokens)
    authCompletion = completion
    resetPhoneVerification()
    setMsg($('phone-message'), '', '')
    show('phone')
    history.replaceState(null, '', '/')
    return
  }

  if (!completion.opener && !completion.redirect) {
    storeAuthTokens(tokens)
    history.replaceState(null, '', '/account')
    loadAccount()
    return
  }

  continueAfterVerification(tokens, completion)
}

async function loadAccount(initialMessage = '') {
  const tokens = ensureStoredTokens()
  if (!tokens?.accessToken) {
    history.replaceState(null, '', '/')
    show('main')
    setMsg($('main-message'), '계정 관리를 보려면 로그인해주세요.', 'err')
    return
  }

  show('account')
  setMsg($('account-message'), '', '')
  $('account-display-name').textContent = '계정 정보를 불러오는 중'
  $('account-handle').textContent = ''

  try {
    const me = await fetchAccountData()
    accountData = me
    renderAccount(me)
    if (initialMessage) setMsg($('account-message'), getOAuthErrorMessage(initialMessage), 'err')
  } catch (err) {
    setMsg($('account-message'), err.message || '계정 정보를 불러오지 못했습니다.', 'err')
  }
}

async function fetchAccountData() {
  const res = await fetchWithAuth('/auth/me')
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '계정 정보를 확인할 수 없습니다.')
  return data
}

async function fetchWithAuth(path, options = {}) {
  let token = getAccessToken()
  let res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  })

  if (res.status === 401 && await refreshAuthTokens()) {
    token = getAccessToken()
    res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    })
  }

  return res
}

async function refreshAuthTokens() {
  const tokens = ensureStoredTokens()
  if (!tokens?.refreshToken) return false

  try {
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    })
    const data = await res.json()
    if (!res.ok) return false
    storeAuthTokens(data)
    return true
  } catch {
    return false
  }
}

function renderAccount(user) {
  renderAvatar($('account-avatar'), user.avatarUrl, user.displayName || user.handle)
  $('account-display-name').textContent = user.displayName || 'Unipass 계정'
  $('account-handle').textContent = user.handle ? `@${user.handle}` : user.email || user.id
  $('account-email').textContent = user.email || '등록되지 않음'
  $('account-phone').textContent = user.phone ? formatStoredPhone(user.phone) : '등록되지 않음'
  $('account-id').textContent = user.handle ? `@${user.handle}` : formatAccountId(user.id)
  $('account-id').title = user.id
  $('account-created-at').textContent = formatDate(user.createdAt)
  $('account-phone-action-copy').textContent = user.phoneVerifiedAt
    ? '번호를 바꾸려면 새 번호로 다시 인증해 주세요.'
    : '서비스 이용을 완료하려면 전화번호 인증이 필요합니다.'
  $('account-avatar-delete').classList.toggle('hidden', !user.avatarUrl)
  renderAccountDeletionState(user)

  setPill($('account-phone-status'), Boolean(user.phoneVerifiedAt), user.phoneVerifiedAt ? '전화번호 인증 완료' : '전화번호 인증 필요')
  setPill($('account-email-status'), Boolean(user.emailVerifiedAt || user.isEmailVerified), user.emailVerifiedAt || user.isEmailVerified ? '이메일 확인됨' : '이메일 미확인')
  renderSocialAccounts(user.oauthAccounts || [])
  renderConnectedServices(user.connectedServices || [])
}

function setPill(el, ok, text) {
  el.className = `pill ${ok ? 'pill-ok' : 'pill-warn'}`
  el.innerHTML = `<span class="dot"></span><span>${escapeHtml(text)}</span>`
}

function renderSocialAccounts(accounts) {
  const list = $('account-social-list')
  list.innerHTML = ''

  for (const provider of ['google', 'kakao']) {
    const account = accounts.find((item) => item.provider === provider)
    const row = document.createElement('div')
    row.className = 'row social-card'

    const icon = document.createElement('div')
    icon.className = `row-icon ${provider}`
    icon.innerHTML = iconSvg[provider]

    const main = document.createElement('div')
    main.className = 'row-grow'
    const name = document.createElement('div')
    name.className = 'row-title'
    name.textContent = providerNames[provider]
    const meta = document.createElement('div')
    meta.className = 'row-meta'
    meta.textContent = account
      ? [account.email || account.displayName || '연결된 계정', account.lastLoginAt ? `마지막 로그인 ${formatDate(account.lastLoginAt)}` : ''].filter(Boolean).join(' · ')
      : '아직 연결되지 않음'
    main.append(name, meta)

    const action = account ? document.createElement('span') : document.createElement('button')
    if (account) {
      action.className = 'pill pill-ok'
      action.innerHTML = '<span class="dot"></span>연결됨'
    } else {
      action.className = 'btn btn-sm btn-outline'
      action.type = 'button'
      action.disabled = Boolean(socialLinkLoadingProvider)
      action.textContent = socialLinkLoadingProvider === provider ? '이동 중...' : '연결하기'
      action.onclick = () => linkSocialProvider(provider)
    }

    row.append(icon, main, action)
    list.appendChild(row)
  }
}

async function linkSocialProvider(provider) {
  if (socialLinkLoadingProvider) return
  socialLinkLoadingProvider = provider
  renderSocialAccounts(accountData?.oauthAccounts || [])
  setMsg($('account-message'), '', '')

  try {
    const res = await fetchWithAuth('/auth/oauth/link-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '소셜 계정 연동을 시작하지 못했습니다.')
    window.location.href = data.url
  } catch (err) {
    socialLinkLoadingProvider = null
    renderSocialAccounts(accountData?.oauthAccounts || [])
    setMsg($('account-message'), err.message || '소셜 계정 연동을 시작하지 못했습니다.', 'err')
  }
}

function renderConnectedServices(items) {
  const root = $('account-service-list')
  root.innerHTML = ''

  if (!items.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-service'
    empty.innerHTML = `
      <div class="empty-service-icon">${iconSvg.link}</div>
      <div class="empty-service-title">아직 연결된 서비스가 없어요</div>
      <div class="empty-service-copy">Nook이나 Ouri에서 Unipass로 로그인하면 여기에 표시돼요.</div>
      <span class="pill pill-mute"><span class="dot"></span>대기 중</span>
    `
    root.appendChild(empty)
    return
  }

  const list = document.createElement('div')
  list.className = 'service-list'
  for (const item of items) {
    const service = item.service || item
    const row = document.createElement('div')
    row.className = 'row service-card'
    const icon = service.iconUrl
      ? `<img src="${escapeHtml(service.iconUrl)}" alt="" />`
      : iconSvg.link
    row.innerHTML = `
      <div class="service-icon">${icon}</div>
      <div class="row-grow">
        <div class="row-title">${escapeHtml(service.name || service.key || '서비스')}</div>
        <div class="row-meta">${escapeHtml(service.origin || '')}${item.lastUsedAt ? ` · 마지막 로그인 ${escapeHtml(formatDate(item.lastUsedAt))}` : ''}</div>
      </div>
      <span class="pill pill-ok"><span class="dot"></span>연결됨</span>
    `
    list.appendChild(row)
  }
  root.appendChild(list)
}

function openLoginHistory() {
  history.pushState(null, '', '/login-history')
  loadLoginHistory()
}

function returnToAccountFromHistory() {
  history.replaceState(null, '', '/account')
  loadAccount()
}

async function loadLoginHistory() {
  const tokens = ensureStoredTokens()
  if (!tokens?.accessToken) {
    history.replaceState(null, '', '/')
    show('main')
    setMsg($('main-message'), '로그인 기록을 보려면 로그인해주세요.', 'err')
    return
  }

  show('login-history')
  setMsg($('login-history-message'), '로그인 기록을 불러오고 있습니다.', 'ok')
  $('login-history-list').innerHTML = ''

  try {
    const res = await fetchWithAuth('/auth/me/login-events')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '로그인 기록을 불러오지 못했습니다.')
    setMsg($('login-history-message'), '', '')
    renderLoginHistory(data.events || [])
  } catch (err) {
    setMsg($('login-history-message'), err.message || '로그인 기록을 불러오지 못했습니다.', 'err')
  }
}

function renderLoginHistory(events) {
  const root = $('login-history-list')
  root.innerHTML = ''

  if (!events.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-service'
    empty.innerHTML = `
      <div class="empty-service-icon">${iconSvg.shield}</div>
      <div class="empty-service-title">아직 기록된 로그인이 없어요</div>
      <div class="empty-service-copy">이 기능을 켠 뒤 성공한 로그인부터 여기에 표시됩니다.</div>
      <span class="pill pill-mute"><span class="dot"></span>대기 중</span>
    `
    root.appendChild(empty)
    return
  }

  const list = document.createElement('div')
  list.className = 'login-history-list'
  for (const event of events) {
    const provider = event.provider || ''
    const service = event.serviceName || event.serviceKey || 'Unipass'
    const row = document.createElement('div')
    row.className = 'login-event-card'
    row.innerHTML = `
      <div class="row login-event-main">
        <div class="row-icon ${escapeHtml(provider)}">${iconSvg[provider] || iconSvg.shield}</div>
        <div class="row-grow">
          <div class="row-title">${escapeHtml(providerNames[provider] || provider || 'Unipass')} 로그인</div>
          <div class="row-meta">${escapeHtml(formatDateTime(event.createdAt))} · ${escapeHtml(service)}</div>
        </div>
      </div>
      <div class="login-event-grid">
        <div>
          <div class="label">IP</div>
          <div class="login-event-value">${escapeHtml(event.ip || '확인 불가')}</div>
        </div>
        <div>
          <div class="label">지역</div>
          <div class="login-event-value">${escapeHtml(formatLoginRegion(event))}</div>
        </div>
      </div>
      <div class="login-event-agent">${escapeHtml(event.userAgent || 'User-Agent 없음')}</div>
    `
    list.appendChild(row)
  }
  root.appendChild(list)
}

async function recordServiceUsageForRedirect(redirectUri, tokens) {
  if (!redirectUri || !tokens?.accessToken) return
  try {
    await fetch(`${API}/auth/me/services/usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ redirectUri }),
    })
  } catch {}
}

function startAccountPhoneVerification() {
  if (!ensureStoredTokens()?.accessToken) return loadAccount()
  authCompletion = { opener: false, redirect: null, phoneRequired: true, accountReturn: true }
  resetPhoneVerification()
  setMsg($('phone-message'), '', '')
  show('phone')
  history.replaceState(null, '', '/')
}

async function logoutAccount() {
  const tokens = ensureStoredTokens()
  try {
    if (tokens?.refreshToken && tokens?.accessToken) {
      await fetch(`${API}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      })
    }
  } catch {}

  clearAuthTokens()
  history.replaceState(null, '', '/')
  setMsg($('main-message'), '', '')
  show('main')
}

function renderAccountDeletionState(user) {
  const status = $('account-deletion-status')
  const copy = $('account-deletion-copy')
  const button = $('account-delete-open')
  if (!status || !copy || !button) return

  if (user.deletionScheduledAt) {
    status.classList.remove('hidden')
    status.textContent = `${formatDate(user.deletionScheduledAt)}에 계정 삭제가 예정되어 있습니다. 다시 로그인하면 삭제 예약이 취소됩니다.`
    copy.textContent = '계정 삭제가 예약되어 있습니다. 예약을 취소하려면 Unipass에 다시 로그인하세요.'
    button.textContent = '삭제 예약 확인'
    return
  }

  status.classList.add('hidden')
  status.textContent = ''
  copy.textContent = '계정 삭제를 예약하면 30일 뒤 Unipass 계정과 연결 정보가 삭제됩니다.'
  button.textContent = '계정 삭제 예약'
}

function openAccountDeletionDialog() {
  if (!accountData) return
  const dialog = $('account-deletion-dialog')
  const input = $('account-deletion-confirm')
  const handle = accountData.handle ? `@${accountData.handle}` : accountData.id
  $('account-deletion-handle').textContent = handle
  input.value = ''
  input.placeholder = handle
  setMsg($('account-deletion-message'), '', '')
  updateAccountDeletionConfirm()
  dialog.classList.remove('hidden')
  setTimeout(() => input.focus(), 0)
}

function closeAccountDeletionDialog() {
  $('account-deletion-dialog')?.classList.add('hidden')
}

function updateAccountDeletionConfirm() {
  const input = $('account-deletion-confirm')
  const button = $('account-delete-submit')
  if (!input || !button) return
  button.disabled = !accountDeletionConfirmMatches(input.value)
}

function accountDeletionConfirmMatches(value) {
  if (!accountData?.handle) return false
  return value.trim().replace(/^@/, '').toLowerCase() === accountData.handle.toLowerCase()
}

async function scheduleAccountDeletion() {
  const input = $('account-deletion-confirm')
  const button = $('account-delete-submit')
  if (!accountDeletionConfirmMatches(input.value)) {
    return setMsg($('account-deletion-message'), 'Unipass ID를 정확히 입력해주세요.', 'err')
  }

  button.disabled = true
  setMsg($('account-deletion-message'), '계정 삭제를 예약하고 있습니다.', 'ok')

  try {
    const res = await fetchWithAuth('/auth/me/deletion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: input.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '계정 삭제를 예약하지 못했습니다.')

    closeAccountDeletionDialog()
    clearAuthTokens()
    accountData = null
    history.replaceState(null, '', '/')
    show('main')
    setMsg($('main-message'), data.message || '계정 삭제가 예약되었습니다. 30일 안에 다시 로그인하면 삭제 예약이 취소됩니다.', 'ok')
  } catch (err) {
    button.disabled = !accountDeletionConfirmMatches(input.value)
    setMsg($('account-deletion-message'), err.message || '계정 삭제를 예약하지 못했습니다.', 'err')
  }
}

function resetPhoneVerification() {
  clearInterval(phoneCodeTimer)
  phoneCodeTimer = null
  phoneCodeSecondsLeft = 0
  phoneResendSecondsLeft = 0
  phoneRequestSent = false

  $('phone-country').value = 'KR'
  $('phone-number').disabled = false
  $('phone-number').value = ''
  $('phone-code').disabled = false
  $('phone-code').value = ''
  $('phone-entry-panel').classList.remove('hidden')
  $('phone-code-panel').classList.remove('is-open')
  $('phone-code-panel').setAttribute('aria-hidden', 'true')
  $('phone-complete-panel').classList.add('hidden')
  $('phone-return').classList.remove('hidden')
  $('phone-number-control').classList.remove('is-error', 'is-ok')
  $('phone-helper').className = 'field-msg hint'
  $('phone-helper').textContent = ''
  $('phone-valid-icon').innerHTML = ''
  $('phone-send').disabled = true
  $('phone-send').textContent = '인증번호 보내기'
  $('phone-check').disabled = true
  $('phone-check').textContent = '인증 확인'
  $('phone-resend').disabled = true
  $('phone-resend').textContent = '재전송'
  $('phone-code-timer').textContent = '남은 시간 3:00'
  $('phone-complete-title').textContent = '전화번호 인증 완료'
  $('phone-complete-copy').textContent = '본인 확인이 끝났어요.'
  setPhoneCountry('KR')
  updateOtpCells()
  updatePhoneReturnButton()
}

function updatePhoneReturnButton() {
  const isAccountReturn = Boolean(authCompletion?.accountReturn)
  const button = $('phone-return')
  button.dataset.returnTarget = isAccountReturn ? 'account' : 'main'
  button.textContent = isAccountReturn ? '계정 관리로 돌아가기' : '이전 화면으로 돌아가기'
  $('phone-title').innerHTML = isAccountReturn ? '새 휴대폰 번호를<br />인증해 주세요' : '휴대폰 번호를<br />인증해 주세요'
}

function setPhoneCountry(country) {
  $('phone-country').value = country
  $('country-kr').classList.toggle('on', country === 'KR')
  $('country-us').classList.toggle('on', country === 'US')
  $('phone-prefix').textContent = country === 'KR' ? '+82' : '+1'
  $('phone-number').placeholder = country === 'KR' ? '010-1234-5678' : '202-555-0123'
  $('phone-number').value = formatPhoneForDisplay($('phone-number').value, country)
  onPhoneInput()
}

function onPhoneInput() {
  const country = $('phone-country').value
  const input = $('phone-number')
  input.value = formatPhoneForDisplay(input.value, country)

  const valid = isValidPhoneInput(input.value, country)
  const hasValue = getPhoneDigits().length > 0
  $('phone-number-control').classList.toggle('is-error', hasValue && !valid)
  $('phone-number-control').classList.toggle('is-ok', valid)
  $('phone-helper').className = `field-msg ${hasValue && !valid ? 'err' : 'hint'}`
  $('phone-helper').innerHTML = hasValue && !valid
    ? `${iconSvg.alert}<span>전화번호 형식이 올바르지 않아요.</span>`
    : ''
  $('phone-valid-icon').innerHTML = valid ? iconSvg.check : ''
  if (!phoneRequestSent) $('phone-send').disabled = !valid
}

function changePhoneNumber() {
  clearInterval(phoneCodeTimer)
  phoneCodeTimer = null
  phoneRequestSent = false
  $('phone-entry-panel').classList.remove('hidden')
  $('phone-code-panel').classList.remove('is-open')
  $('phone-number').disabled = false
  $('phone-code').value = ''
  $('phone-code').disabled = false
  $('phone-send').disabled = !isValidPhoneInput($('phone-number').value, $('phone-country').value)
  $('phone-send').textContent = '인증번호 보내기'
  setMsg($('phone-message'), '', '')
  updateOtpCells()
}

function onPhoneCodeInput() {
  const code = getPhoneCode()
  $('phone-code').value = code
  updateOtpCells()
  $('phone-check').disabled = code.length !== 6 || phoneCodeSecondsLeft <= 0
}

function focusPhoneCode() {
  if (!$('phone-code').disabled) $('phone-code').focus()
}

function getPhoneDigits() {
  return $('phone-number').value.replace(/\D/g, '')
}

function getPhoneCode() {
  return $('phone-code').value.replace(/\D/g, '').slice(0, 6)
}

function isValidPhoneInput(value, country) {
  const digits = value.replace(/\D/g, '')
  if (country === 'KR') {
    return /^01\d{8,9}$/.test(digits) || /^821\d{8,9}$/.test(digits) || /^1\d{8,9}$/.test(digits)
  }
  if (country === 'US') {
    return /^[2-9]\d{9}$/.test(digits) || /^1[2-9]\d{9}$/.test(digits)
  }
  return false
}

function formatPhoneForDisplay(value, country) {
  const digits = value.replace(/\D/g, '')
  if (country === 'KR') return formatKoreanMobile(digits)
  return formatUsPhone(digits)
}

function formatKoreanMobile(digits) {
  let national = digits
  if (national.startsWith('82')) national = `0${national.slice(2)}`
  if (national.startsWith('10')) national = `0${national}`
  national = national.slice(0, 11)
  if (national.length <= 3) return national
  if (national.length <= 7) return `${national.slice(0, 3)}-${national.slice(3)}`
  return `${national.slice(0, 3)}-${national.slice(3, 7)}-${national.slice(7)}`
}

function formatUsPhone(digits) {
  let national = digits.startsWith('1') && digits.length > 10 ? digits.slice(1) : digits
  national = national.slice(0, 10)
  if (national.length <= 3) return national
  if (national.length <= 6) return `${national.slice(0, 3)}-${national.slice(3)}`
  return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`
}

async function sendPhoneCode() {
  const token = getAccessToken()
  if (!token) return setMsg($('phone-message'), '다시 로그인해주세요.', 'err')
  if (!isValidPhoneInput($('phone-number').value, $('phone-country').value)) {
    $('phone-number-control').classList.add('is-error')
    return setMsg($('phone-message'), '전화번호 형식이 올바르지 않아요.', 'err')
  }

  const button = $('phone-send')
  const resend = $('phone-resend')
  button.disabled = true
  button.classList.add('is-loading')
  button.textContent = phoneRequestSent ? '재전송 중...' : '인증번호 보내는 중...'
  resend.disabled = true
  setMsg($('phone-message'), '', '')

  try {
    const res = await fetch(`${API}/auth/phone/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        phone: getPhoneDigits(),
        country: $('phone-country').value,
      }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.message || '인증번호를 발송하지 못했어요.')

    if (data.alreadyVerified) {
      phoneRequestSent = false
      $('phone-entry-panel').classList.remove('hidden')
      $('phone-code-panel').classList.remove('is-open')
      $('phone-code-panel').setAttribute('aria-hidden', 'true')
      $('phone-number').disabled = false
      $('phone-code').disabled = false
      $('phone-code').value = ''
      $('phone-check').disabled = true
      $('phone-resend').disabled = true
      updateOtpCells()
      setMsg($('phone-message'), data.message || '이미 인증된 전화번호입니다.', 'ok')
      return
    }

    phoneRequestSent = true
    $('phone-entry-panel').classList.add('hidden')
    $('phone-code-panel').classList.add('is-open')
    $('phone-code-panel').setAttribute('aria-hidden', 'false')
    $('phone-number').disabled = true
    $('phone-code').disabled = false
    $('phone-code').value = ''
    $('phone-check').disabled = true
    $('phone-code-target-copy').innerHTML = `<b>${escapeHtml(displayPhoneForCode())}</b>로<br />6자리 인증번호를 보냈어요.`
    setTimeout(() => focusPhoneCode(), 180)
    setMsg($('phone-message'), data.message || '인증번호를 발송했어요.', 'ok')
    startPhoneCodeTimer(PHONE_VALIDITY_SECONDS, data.cooldownSeconds ?? 60)
    updateOtpCells()
  } catch (err) {
    setMsg($('phone-message'), err.message || '인증번호를 발송하지 못했어요.', 'err')
    if (!phoneRequestSent) button.disabled = !isValidPhoneInput($('phone-number').value, $('phone-country').value)
  } finally {
    button.classList.remove('is-loading')
    button.textContent = '인증번호 보내기'
  }
}

async function checkPhoneCode() {
  const token = getAccessToken()
  if (!token) return setMsg($('phone-message'), '다시 로그인해주세요.', 'err')

  const button = $('phone-check')
  button.disabled = true
  button.classList.add('is-loading')
  button.textContent = '확인 중...'
  setMsg($('phone-message'), '', '')

  try {
    const res = await fetch(`${API}/auth/phone/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        phone: getPhoneDigits(),
        country: $('phone-country').value,
        code: getPhoneCode(),
      }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.message || '인증번호가 올바르지 않아요.')

    clearInterval(phoneCodeTimer)
    $('phone-code').disabled = true
    $('phone-send').disabled = true
    $('phone-resend').disabled = true
    button.disabled = true
    button.textContent = '인증 완료'
    setMsg($('phone-message'), '', '')
    showSignupComplete()
  } catch (err) {
    markOtpError()
    setMsg($('phone-message'), err.message || '인증번호가 올바르지 않아요.', 'err')
    button.disabled = false
    button.textContent = '인증 확인'
  } finally {
    button.classList.remove('is-loading')
  }
}

function startPhoneCodeTimer(seconds, resendCooldown) {
  clearInterval(phoneCodeTimer)
  phoneCodeSecondsLeft = Math.max(1, Number(seconds) || PHONE_VALIDITY_SECONDS)
  phoneResendSecondsLeft = Math.max(0, Number(resendCooldown) || 0)
  updatePhoneCodeTimer()

  phoneCodeTimer = setInterval(() => {
    phoneCodeSecondsLeft = Math.max(0, phoneCodeSecondsLeft - 1)
    phoneResendSecondsLeft = Math.max(0, phoneResendSecondsLeft - 1)
    updatePhoneCodeTimer()

    if (phoneCodeSecondsLeft <= 0) {
      clearInterval(phoneCodeTimer)
      $('phone-check').disabled = true
      $('phone-code-timer').textContent = '시간 만료'
      $('phone-resend').disabled = phoneResendSecondsLeft > 0
    }
  }, 1000)
}

function updatePhoneCodeTimer() {
  const min = Math.floor(phoneCodeSecondsLeft / 60)
  const sec = String(phoneCodeSecondsLeft % 60).padStart(2, '0')
  $('phone-code-timer').textContent = phoneCodeSecondsLeft > 0 ? `남은 시간 ${min}:${sec}` : '시간 만료'
  $('phone-resend').disabled = phoneResendSecondsLeft > 0
  $('phone-resend').textContent = phoneResendSecondsLeft > 0
    ? `재전송 ${Math.floor(phoneResendSecondsLeft / 60)}:${String(phoneResendSecondsLeft % 60).padStart(2, '0')}`
    : '재전송'
}

function updateOtpCells() {
  const root = $('phone-otp')
  const code = getPhoneCode()
  root.classList.remove('is-error', 'is-ok', 'shake')
  root.innerHTML = ''
  for (let i = 0; i < 6; i++) {
    const cell = document.createElement('div')
    cell.className = 'otp-cell'
    if (code[i]) {
      cell.textContent = code[i]
      cell.classList.add('filled')
    }
    if (i === code.length && code.length < 6 && phoneCodeSecondsLeft > 0) cell.classList.add('cursor')
    root.appendChild(cell)
  }
  if (code.length === 6) root.classList.add('is-ok')
}

function markOtpError() {
  const root = $('phone-otp')
  root.classList.remove('is-ok')
  root.classList.add('is-error', 'shake')
  setTimeout(() => {
    root.classList.remove('shake')
    $('phone-code').value = ''
    updateOtpCells()
    focusPhoneCode()
  }, 450)
}

function displayPhoneForCode() {
  return $('phone-country').value === 'KR'
    ? $('phone-number').value
    : `+1 ${$('phone-number').value}`
}

function showSignupComplete() {
  const completion = authCompletion || currentAuthCompletion()
  const hasReturnTarget = completion?.opener || completion?.redirect
  const isAccountReturn = Boolean(completion?.accountReturn)

  $('phone-code-panel').classList.remove('is-open')
  $('phone-entry-panel').classList.add('hidden')
  $('phone-complete-panel').classList.remove('hidden')
  $('phone-return').classList.add('hidden')
  $('phone-complete-title').textContent = isAccountReturn ? '전화번호가 변경되었습니다' : '전화번호 인증 완료'
  $('phone-complete-copy').textContent = hasReturnTarget
    ? '이제 요청한 서비스로 돌아갈 수 있어요.'
    : isAccountReturn
      ? '계정 관리에서 변경된 전화번호를 확인할 수 있어요.'
      : '본인 확인이 끝났어요.'
  $('phone-complete-action').textContent = hasReturnTarget
    ? '원래 서비스로 이동'
    : isAccountReturn
      ? '계정 관리로 돌아가기'
      : '완료'
}

function finishAuth() {
  const tokens = authTokens
  const completion = authCompletion || currentAuthCompletion()
  if (tokens && (completion?.opener || completion?.redirect)) {
    authCompletion = null
    continueAfterVerification(tokens, completion)
    return
  }
  if (tokens) {
    history.replaceState(null, '', '/account')
    loadAccount()
    return
  }
  returnToLogin()
}

function returnFromPhoneVerification(event) {
  event?.preventDefault()
  const shouldReturnToAccount = authCompletion?.accountReturn || $('phone-return').dataset.returnTarget === 'account'

  if (shouldReturnToAccount) {
    authCompletion = null
    history.replaceState(null, '', '/account')
    show('account')
    loadAccount()
    return
  }

  clearAuthTokens()
  authCompletion = null
  resetPhoneVerification()
  history.replaceState(null, '', '/')
  setMsg($('main-message'), '', '')
  show('main')
}

function returnToLogin() {
  return returnFromPhoneVerification()
}

function renderAvatar(container, url, name) {
  setAvatarFallback(container, name)
  if (url) {
    const img = document.createElement('img')
    img.alt = ''
    img.onload = () => {
      container.innerHTML = ''
      container.appendChild(img)
    }
    img.onerror = () => setAvatarFallback(container, name)
    img.src = url
  }
}

function setAvatarFallback(container, name) {
  container.innerHTML = ''
  container.textContent = (name || 'U').trim().slice(0, 1).toUpperCase()
}

function openAvatarSheet(event) {
  event?.stopPropagation()
  const sheet = $('avatar-action-sheet')
  const button = $('account-avatar-button')
  if (!sheet || !button) return openAvatarFilePicker()
  sheet.classList.remove('hidden')
  button.setAttribute('aria-expanded', 'true')
}

function closeAvatarSheet() {
  const sheet = $('avatar-action-sheet')
  const button = $('account-avatar-button')
  if (sheet) sheet.classList.add('hidden')
  if (button) button.setAttribute('aria-expanded', 'false')
}

function chooseAvatarFile(event) {
  event?.stopPropagation()
  closeAvatarSheet()
  openAvatarFilePicker()
}

function bindAvatarSheetHandlers() {
  const button = $('account-avatar-button')
  const changeButton = $('account-avatar-change')
  const deleteButton = $('account-avatar-delete')

  button?.addEventListener('click', openAvatarSheet)
  button?.addEventListener('touchend', (event) => {
    event.preventDefault()
    openAvatarSheet(event)
  }, { passive: false })
  changeButton?.addEventListener('click', chooseAvatarFile)
  deleteButton?.addEventListener('click', deleteAvatar)
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAvatarSheet()
  })
}

function openAvatarFilePicker() {
  closeAvatarSheet()
  $('account-avatar-file').click()
}

async function uploadAvatarFile(event) {
  const input = event.target
  const file = input.files?.[0]
  if (!file) return
  if (!isValidAvatarFile(file)) {
    input.value = ''
    return setMsg($('account-message'), 'JPG, PNG, WebP, GIF 이미지만 5MB 이하로 업로드할 수 있습니다.', 'err')
  }

  const button = $('account-avatar-button')
  const menuItems = document.querySelectorAll('.avatar-sheet-item')
  const previousAvatarUrl = accountData?.avatarUrl
  const previewUrl = URL.createObjectURL(file)
  renderAvatar($('account-avatar'), previewUrl, accountData?.displayName || accountData?.handle)
  button.disabled = true
  menuItems.forEach((item) => { item.disabled = true })
  setMsg($('account-message'), '프로필 사진을 업로드하고 있습니다.', 'ok')

  try {
    const formData = new FormData()
    formData.append('avatar', file)
    const res = await fetchWithAuth('/auth/me/avatar', { method: 'POST', body: formData })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '프로필 사진을 업로드하지 못했습니다.')
    accountData = { ...(accountData || {}), ...data }
    renderAvatar($('account-avatar'), data.avatarUrl, data.displayName || data.handle)
    $('account-avatar-delete').classList.toggle('hidden', !data.avatarUrl)
    setMsg($('account-message'), '프로필 사진을 변경했습니다.', 'ok')
    showToast('프로필 사진을 변경했습니다.')
  } catch (err) {
    renderAvatar($('account-avatar'), previousAvatarUrl, accountData?.displayName || accountData?.handle)
    setMsg($('account-message'), err.message || '프로필 사진을 업로드하지 못했습니다.', 'err')
  } finally {
    URL.revokeObjectURL(previewUrl)
    input.value = ''
    button.disabled = false
    menuItems.forEach((item) => { item.disabled = false })
  }
}

async function deleteAvatar(event) {
  event?.stopPropagation()
  if (!accountData?.avatarUrl) {
    closeAvatarSheet()
    return
  }
  const button = $('account-avatar-delete')
  button.disabled = true
  closeAvatarSheet()
  setMsg($('account-message'), '프로필 사진을 삭제하고 있습니다.', 'ok')

  try {
    const res = await fetchWithAuth('/auth/me/avatar', { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '프로필 사진을 삭제하지 못했습니다.')
    accountData = { ...(accountData || {}), ...data }
    renderAvatar($('account-avatar'), null, data.displayName || data.handle)
    button.classList.add('hidden')
    setMsg($('account-message'), '프로필 사진을 삭제했습니다.', 'ok')
    showToast('프로필 사진을 삭제했습니다.')
  } catch (err) {
    setMsg($('account-message'), err.message || '프로필 사진을 삭제하지 못했습니다.', 'err')
  } finally {
    button.disabled = false
  }
}

function isValidAvatarFile(file) {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) &&
    file.size > 0 &&
    file.size <= 5 * 1024 * 1024
}

function formatDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatAccountId(value) {
  if (!value || value.length <= 16) return value || '-'
  return `${value.slice(0, 8)}...${value.slice(-5)}`
}

function formatStoredPhone(value) {
  if (!value) return '-'
  if (value.startsWith('+82') && value.length >= 12) {
    const national = `0${value.slice(3)}`
    return formatKoreanMobile(national)
  }
  if (value.startsWith('+1') && value.length >= 12) {
    return `+1 ${formatUsPhone(value.slice(2))}`
  }
  return value
}

function serviceLabelFromUrl(value) {
  if (!value) return ''
  try {
    const host = new URL(value).hostname
    const first = host.split('.')[0]
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : host
  } catch {
    return ''
  }
}

function formatLoginRegion(event) {
  const parts = [event.city, event.region, formatCountry(event.country)].filter(Boolean)
  return parts.length ? parts.join(', ') : '지역 정보 없음'
}

function formatCountry(value) {
  const code = value?.trim()
  if (!code) return ''
  try {
    return new Intl.DisplayNames(['ko'], { type: 'region' }).of(code.toUpperCase()) || code
  } catch {
    return code
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function bindPageLifecycleHandlers() {
  window.addEventListener('pagehide', resetTransientLoadingState)
  window.addEventListener('pageshow', resetTransientLoadingState)
  window.addEventListener('popstate', routeFromLocation)
}

function routeFromLocation() {
  const error = new URLSearchParams(window.location.search).get('error')
  if (window.location.pathname === '/login-history') return loadLoginHistory()
  if (window.location.pathname === '/account') return loadAccount(error || '')
  if (error) setMsg($('main-message'), getOAuthErrorMessage(error), 'err')
  show('main')
}

function init() {
  renderStaticIcons()
  updateOtpCells()
  bindAvatarSheetHandlers()

  const params = new URLSearchParams(window.location.search)
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  const pending = params.get('oauth_pending')
  const error = params.get('error')

  if (accessToken && refreshToken) return onSuccess({ accessToken, refreshToken, requiresPhoneVerification: params.get('phone_required') === '1' })
  if (pending) return loadPending(pending)
  if (window.location.pathname === '/login-history') return loadLoginHistory()
  if (window.location.pathname === '/account') return loadAccount(error || '')
  if (error) setMsg($('main-message'), getOAuthErrorMessage(error), 'err')
  show('main')
}

bindPageLifecycleHandlers()
init()
