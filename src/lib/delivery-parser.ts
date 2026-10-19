/**
 * LOGSPOLL — Professional Digital Product Delivery Parser & Normalizer
 *
 * Normalizes raw supplier delivery responses into clean, structured,
 * customer-friendly credentials with field masking, sensitive flag detection,
 * multi-account splitting, and product-specific usage guides.
 */

export type CredentialFieldType =
  | 'email'
  | 'username'
  | 'password'
  | 'two_factor'
  | 'recovery_email'
  | 'recovery_phone'
  | 'backup_codes'
  | 'token'
  | 'license_key'
  | 'activation_url'
  | 'plan'
  | 'duration'
  | 'expiry_date'
  | 'phone'
  | 'proxy'
  | 'pin'
  | 'custom'

export interface StructuredCredentialField {
  label: string
  value: string
  type: CredentialFieldType
  isSensitive: boolean
}

export interface StructuredAccountCard {
  accountNumber: number
  title: string
  fields: StructuredCredentialField[]
  raw: string
  isAmbiguous?: boolean
}

export interface StructuredProductDelivery {
  productType: 'email' | 'social' | 'ai_subscription' | 'vpn' | 'license' | 'generic'
  platformName: string
  accounts: StructuredAccountCard[]
  instructions: string[]
  raw: string
  isAmbiguous: boolean
  warning?: string
}

// Validation regexes
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
const BASE32_RE = /^[A-Z2-7]{16,32}$/
const HEX_TOKEN_RE = /^[a-fA-F0-9]{32,64}$/
const URL_RE = /^https?:\/\/[^\s]+$/i
const PHONE_RE = /^\+?[0-9]{9,16}$/

export function isEmail(val: string): boolean {
  return EMAIL_RE.test(val.trim())
}

export function isBase32Secret(val: string): boolean {
  const clean = val.trim().replace(/\s+/g, '')
  return BASE32_RE.test(clean)
}

export function isUrl(val: string): boolean {
  return URL_RE.test(val.trim())
}

export function isHexToken(val: string): boolean {
  return HEX_TOKEN_RE.test(val.trim())
}

export function isPhone(val: string): boolean {
  return PHONE_RE.test(val.trim())
}

/** Detect product category/platform from title and category name */
export function detectPlatform(productName = '', categoryName = ''): {
  type: StructuredProductDelivery['productType']
  platform: string
} {
  const combined = `${productName} ${categoryName}`.toLowerCase()

  if (/\b(gmail|google|youtube|yt|playstore)\b/.test(combined)) {
    return { type: 'email', platform: 'Gmail / Google' }
  }
  if (/\b(outlook|hotmail|microsoft|ms)\b/.test(combined)) {
    return { type: 'email', platform: 'Outlook / Hotmail' }
  }
  if (/\b(yahoo|aol|mail\.com|proton|gmx)\b/.test(combined)) {
    return { type: 'email', platform: 'Email Account' }
  }
  if (/\b(twitter|x\.com|\bx\b)\b/.test(combined)) {
    return { type: 'social', platform: 'Twitter / X' }
  }
  if (/\b(instagram|ig)\b/.test(combined)) {
    return { type: 'social', platform: 'Instagram' }
  }
  if (/\b(facebook|fb)\b/.test(combined)) {
    return { type: 'social', platform: 'Facebook' }
  }
  if (/\b(threads)\b/.test(combined)) {
    return { type: 'social', platform: 'Threads' }
  }
  if (/\b(tiktok)\b/.test(combined)) {
    return { type: 'social', platform: 'TikTok' }
  }
  if (/\b(reddit)\b/.test(combined)) {
    return { type: 'social', platform: 'Reddit' }
  }
  if (/\b(snapchat)\b/.test(combined)) {
    return { type: 'social', platform: 'Snapchat' }
  }
  if (/\b(chatgpt|openai|claude|gemini|elevenlabs|grok|midjourney|deepseek|gamma|ai)\b/.test(combined)) {
    return { type: 'ai_subscription', platform: 'AI Subscription' }
  }
  if (/\b(vpn|hma|pia|nord|surfshark|mullvad|expressvpn|cyberghost|purevpn|ipvanish|astrill)\b/.test(combined)) {
    return { type: 'vpn', platform: 'VPN Service' }
  }
  if (/\b(license|activation|key|code|redeem|gift card|voucher|mastercard|visa)\b/.test(combined)) {
    return { type: 'license', platform: 'Digital License' }
  }

  return { type: 'generic', platform: 'Digital Product' }
}

/** Extract explicit FORMAT definition if present in title or description */
export function extractExplicitFormat(text = ''): string[] | null {
  // Matches "FORMAT: A:B:C:D", "Format: A+B+C+D", "LOG FORMAT Username || password", "FILE FORMAT: UID:PASS:2FA:TOKEN:MAIL", etc.
  const match = text.match(/(?:file\s+format|log\s+format|format)\s*[:=]?\s*([A-Za-z0-9_ |:+/-]+)/i)
  if (!match) return null

  const rawFormat = match[1].trim()
  let parts: string[] = []
  if (rawFormat.includes('||')) {
    parts = rawFormat.split('||')
  } else if (rawFormat.includes(':')) {
    parts = rawFormat.split(':')
  } else if (rawFormat.includes('|')) {
    parts = rawFormat.split('|')
  } else if (rawFormat.includes('+')) {
    parts = rawFormat.split('+')
  } else if (rawFormat.includes('/')) {
    parts = rawFormat.split('/')
  }

  const cleaned = parts.map((p) => p.trim().toLowerCase()).filter(Boolean)
  return cleaned.length >= 2 ? cleaned : null
}

function labelFromFormatKey(key: string): { label: string; type: CredentialFieldType; isSensitive: boolean } {
  const k = key.toLowerCase()
  if (k.includes('pass') || k.includes('pwd')) {
    return { label: 'PASSWORD', type: 'password', isSensitive: true }
  }
  if (
    k.includes('2fa') ||
    k.includes('two_factor') ||
    k.includes('factor') ||
    k.includes('totp') ||
    k.includes('otp') ||
    k.includes('secret') ||
    k.includes('key')
  ) {
    return { label: '2FA SECRET', type: 'two_factor', isSensitive: true }
  }
  if (k.includes('mail') || k.includes('email')) {
    return { label: 'EMAIL ADDRESS', type: 'email', isSensitive: false }
  }
  if (k.includes('token') || k.includes('auth')) {
    return { label: 'AUTH TOKEN', type: 'token', isSensitive: true }
  }
  if (k.includes('uid') || k.includes('id') || k.includes('user')) {
    return { label: 'USERNAME / ID', type: 'username', isSensitive: false }
  }
  if (k.includes('recovery') || k.includes('rec')) {
    return { label: 'RECOVERY EMAIL', type: 'recovery_email', isSensitive: true }
  }
  if (k.includes('phone') || k.includes('num')) {
    return { label: 'PHONE NUMBER', type: 'phone', isSensitive: false }
  }
  if (k.includes('pin')) {
    return { label: 'PIN CODE', type: 'pin', isSensitive: true }
  }
  return { label: key.toUpperCase(), type: 'custom', isSensitive: false }
}

/** Parse single line with explicit format labels */
function parseWithExplicitFormat(parts: string[], formatKeys: string[]): StructuredCredentialField[] {
  const fields: StructuredCredentialField[] = []
  let emailCount = 0

  for (let i = 0; i < parts.length; i++) {
    const val = parts[i].trim()
    const key = formatKeys[i] ?? `PART_${i + 1}`
    const meta = labelFromFormatKey(key)

    if (meta.type === 'email') {
      emailCount++
      if (emailCount > 1) {
        meta.label = 'CONNECTED / RECOVERY EMAIL'
        meta.type = 'recovery_email'
      }
    }

    fields.push({
      label: meta.label,
      value: val,
      type: meta.type,
      isSensitive: meta.isSensitive,
    })
  }
  return fields
}

/** Smart parser for colon/pipe delimited lines */
function parseDelimitedLine(
  line: string,
  productType: StructuredProductDelivery['productType'],
  explicitFormat: string[] | null
): { fields: StructuredCredentialField[]; isAmbiguous: boolean } {
  // Safe split: handle colons or pipes, but protect URLs from being split
  let delimiter = ':'
  if (!line.includes(':') && line.includes('|')) {
    delimiter = '|'
  } else if (!line.includes(':') && line.includes(';')) {
    delimiter = ';'
  }

  // Preserve URLs with placeholder
  const urls: string[] = []
  const protectedLine = line.replace(/https?:\/\/[^\s:;|,]+/g, (match) => {
    urls.push(match)
    return `__URL_PLACEHOLDER_${urls.length - 1}__`
  })

  let rawParts = protectedLine.split(delimiter).map((p) => {
    let unmasked = p.trim()
    urls.forEach((url, idx) => {
      unmasked = unmasked.replace(`__URL_PLACEHOLDER_${idx}__`, url)
    })
    return unmasked
  })

  // If single item without delimiters
  if (rawParts.length === 1) {
    const val = rawParts[0].trim()
    if (!val) return { fields: [], isAmbiguous: false }

    if (isUrl(val)) {
      return {
        fields: [{ label: 'ACTIVATION LINK', value: val, type: 'activation_url', isSensitive: false }],
        isAmbiguous: false,
      }
    }
    if (isEmail(val)) {
      return {
        fields: [{ label: 'EMAIL ADDRESS', value: val, type: 'email', isSensitive: false }],
        isAmbiguous: false,
      }
    }
    return {
      fields: [{ label: 'LICENSE KEY / ACTIVATION CODE', value: val, type: 'license_key', isSensitive: false }],
      isAmbiguous: false,
    }
  }

  // 1. If explicit format definition matches part count (or close)
  if (explicitFormat && Math.abs(explicitFormat.length - rawParts.length) <= 1) {
    return {
      fields: parseWithExplicitFormat(rawParts, explicitFormat),
      isAmbiguous: false,
    }
  }

  // 2. Intelligent pattern classification
  const fields: StructuredCredentialField[] = []

  // Check email count
  const emailIndices = rawParts.map((p, i) => (isEmail(p) ? i : -1)).filter((i) => i !== -1)

  // Pattern: Standard Email Account (Part 0 is email)
  if (emailIndices.includes(0)) {
    fields.push({ label: 'EMAIL ADDRESS', value: rawParts[0], type: 'email', isSensitive: false })

    if (rawParts.length >= 2) {
      fields.push({ label: 'PASSWORD', value: rawParts[1], type: 'password', isSensitive: true })
    }

    if (rawParts.length >= 3) {
      const part2 = rawParts[2]
      if (isEmail(part2)) {
        fields.push({ label: 'RECOVERY EMAIL', value: part2, type: 'recovery_email', isSensitive: true })
      } else if (isBase32Secret(part2)) {
        fields.push({ label: '2FA SECRET', value: part2, type: 'two_factor', isSensitive: true })
      } else if (isPhone(part2)) {
        fields.push({ label: 'RECOVERY PHONE', value: part2, type: 'recovery_phone', isSensitive: true })
      } else {
        fields.push({ label: 'RECOVERY DETAILS', value: part2, type: 'recovery_email', isSensitive: true })
      }
    }

    if (rawParts.length >= 4) {
      const part3 = rawParts[3]
      if (isBase32Secret(part3)) {
        fields.push({ label: '2FA SECRET', value: part3, type: 'two_factor', isSensitive: true })
      } else if (isPhone(part3)) {
        fields.push({ label: 'RECOVERY PHONE', value: part3, type: 'recovery_phone', isSensitive: true })
      } else {
        fields.push({ label: 'BACKUP DETAILS', value: part3, type: 'backup_codes', isSensitive: true })
      }
    }

    if (rawParts.length >= 5) {
      for (let i = 4; i < rawParts.length; i++) {
        const extra = rawParts[i]
        const isSec = isBase32Secret(extra) || isHexToken(extra)
        fields.push({
          label: isSec ? 'SECURITY KEY / TOKEN' : `DETAIL #${i + 1}`,
          value: extra,
          type: isSec ? 'two_factor' : 'custom',
          isSensitive: isSec,
        })
      }
    }

    return { fields, isAmbiguous: false }
  }

  // Pattern: Social Media / Account (Part 0 is Username/UID, Part 1 is Password)
  if (productType === 'social' || rawParts.length >= 4 || emailIndices.includes(2)) {
    // 6-part Twitter pattern: username:password:connected_email:email_password:2fa:token
    if (rawParts.length === 6 && emailIndices.includes(2)) {
      fields.push({ label: 'USERNAME', value: rawParts[0], type: 'username', isSensitive: false })
      fields.push({ label: 'PASSWORD', value: rawParts[1], type: 'password', isSensitive: true })
      fields.push({ label: 'CONNECTED EMAIL', value: rawParts[2], type: 'email', isSensitive: false })
      fields.push({ label: 'EMAIL PASSWORD', value: rawParts[3], type: 'password', isSensitive: true })
      fields.push({ label: '2FA SECRET KEY', value: rawParts[4], type: 'two_factor', isSensitive: true })
      fields.push({ label: 'AUTH TOKEN', value: rawParts[5], type: 'token', isSensitive: true })
      return { fields, isAmbiguous: false }
    }

    // 5-part pattern: username:password:connected_email:email_password:2fa
    if (rawParts.length === 5 && emailIndices.includes(2)) {
      fields.push({ label: 'USERNAME', value: rawParts[0], type: 'username', isSensitive: false })
      fields.push({ label: 'PASSWORD', value: rawParts[1], type: 'password', isSensitive: true })
      fields.push({ label: 'CONNECTED EMAIL', value: rawParts[2], type: 'email', isSensitive: false })
      fields.push({ label: 'EMAIL PASSWORD', value: rawParts[3], type: 'password', isSensitive: true })
      fields.push({ label: '2FA SECRET', value: rawParts[4], type: 'two_factor', isSensitive: true })
      return { fields, isAmbiguous: false }
    }

    // 5-part UID pattern: uid:password:2fa:token:email
    if (rawParts.length === 5 && emailIndices.includes(4)) {
      fields.push({ label: 'USERNAME / UID', value: rawParts[0], type: 'username', isSensitive: false })
      fields.push({ label: 'PASSWORD', value: rawParts[1], type: 'password', isSensitive: true })
      fields.push({ label: '2FA SECRET', value: rawParts[2], type: 'two_factor', isSensitive: true })
      fields.push({ label: 'AUTH TOKEN', value: rawParts[3], type: 'token', isSensitive: true })
      fields.push({ label: 'CONNECTED EMAIL', value: rawParts[4], type: 'email', isSensitive: false })
      return { fields, isAmbiguous: false }
    }

    // 4-part pattern: username:password:2fa:email
    if (rawParts.length === 4 && (emailIndices.includes(3) || emailIndices.includes(2))) {
      const emailIdx = emailIndices[0]
      fields.push({ label: 'USERNAME', value: rawParts[0], type: 'username', isSensitive: false })
      fields.push({ label: 'PASSWORD', value: rawParts[1], type: 'password', isSensitive: true })
      if (emailIdx === 2) {
        fields.push({ label: 'CONNECTED EMAIL', value: rawParts[2], type: 'email', isSensitive: false })
        fields.push({ label: '2FA SECRET / DETAILS', value: rawParts[3], type: 'two_factor', isSensitive: true })
      } else {
        fields.push({ label: '2FA SECRET', value: rawParts[2], type: 'two_factor', isSensitive: true })
        fields.push({ label: 'CONNECTED EMAIL', value: rawParts[3], type: 'email', isSensitive: false })
      }
      return { fields, isAmbiguous: false }
    }

    // 3-part pattern: username:password:2fa or username:password:email
    if (rawParts.length === 3) {
      fields.push({ label: 'USERNAME', value: rawParts[0], type: 'username', isSensitive: false })
      fields.push({ label: 'PASSWORD', value: rawParts[1], type: 'password', isSensitive: true })
      const last = rawParts[2]
      if (isEmail(last)) {
        fields.push({ label: 'CONNECTED EMAIL', value: last, type: 'email', isSensitive: false })
      } else {
        fields.push({ label: '2FA SECRET / RECOVERY', value: last, type: 'two_factor', isSensitive: true })
      }
      return { fields, isAmbiguous: false }
    }

    // 2-part pattern: username:password
    if (rawParts.length === 2) {
      fields.push({ label: 'USERNAME', value: rawParts[0], type: 'username', isSensitive: false })
      fields.push({ label: 'PASSWORD', value: rawParts[1], type: 'password', isSensitive: true })
      return { fields, isAmbiguous: false }
    }
  }

  // 2-part generic: username/email : password
  if (rawParts.length === 2) {
    const isFirstEmail = isEmail(rawParts[0])
    fields.push({
      label: isFirstEmail ? 'EMAIL ADDRESS' : 'USERNAME',
      value: rawParts[0],
      type: isFirstEmail ? 'email' : 'username',
      isSensitive: false,
    })
    fields.push({ label: 'PASSWORD', value: rawParts[1], type: 'password', isSensitive: true })
    return { fields, isAmbiguous: false }
  }

  // Fallback: If ambiguous, do not guess!
  return {
    fields: rawParts.map((val, idx) => ({
      label: `FIELD ${idx + 1}`,
      value: val,
      type: 'custom',
      isSensitive: idx > 0, // mask non-first fields by default for safety
    })),
    isAmbiguous: true,
  }
}

/** Parse JSON supplier response */
function parseJsonDelivery(jsonStr: string): StructuredCredentialField[] | null {
  try {
    const parsed = JSON.parse(jsonStr)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

    const fields: StructuredCredentialField[] = []
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string' && typeof v !== 'number') continue
      const meta = labelFromFormatKey(k)
      fields.push({
        label: meta.label,
        value: String(v),
        type: meta.type,
        isSensitive: meta.isSensitive,
      })
    }
    return fields.length > 0 ? fields : null
  } catch {
    return null
  }
}

/** Product-specific instructions */
export function getProductInstructions(platform: string): string[] {
  const p = platform.toLowerCase()

  if (p.includes('gmail') || p.includes('google') || p.includes('youtube')) {
    return [
      'Open a private/incognito browser window or a new browser profile to prevent account conflicts.',
      'Navigate to https://accounts.google.com and enter the provided email address and password.',
      'If Google prompts for identity verification, select "Confirm your recovery email" and enter the recovery email provided above (do NOT try to sign into the recovery mailbox directly).',
      'If 2FA is enabled, open https://2fa.live in a new tab, paste your 2FA Secret Key, and copy the generated 6-digit verification code.',
      'Once signed in, immediately visit your Google Account Security settings to add your own recovery phone, email, and generate backup codes.',
    ]
  }

  if (p.includes('outlook') || p.includes('hotmail') || p.includes('microsoft')) {
    return [
      'Go to https://outlook.live.com or https://login.live.com in your browser.',
      'Sign in with the provided email address and password.',
      'If a verification screen appears, choose the recovery email option if one was included in your delivery.',
      'Update the account password and add your own two-step verification in Microsoft Account Security settings.',
    ]
  }

  if (p.includes('twitter') || p.includes('x')) {
    return [
      'Open https://x.com/login in a clean browser session (use a clean residential proxy or IP if specified).',
      'Enter the username and password provided above.',
      'When prompted for a Two-Factor Authentication (2FA) code, paste the 2FA Secret Key into https://2fa.live to get your instant 6-digit TOTP code.',
      'If an Auth Token is included, advanced users can set the "auth_token" browser cookie for instant one-click session login.',
      'Allow the account to rest and warm up gradually; avoid aggressive following, posting, or changing multiple profile settings immediately.',
    ]
  }

  if (p.includes('instagram')) {
    return [
      'Open Instagram on mobile or web (https://instagram.com) using a clean IP address.',
      'Log in with the username and password provided.',
      'When the 2FA prompt appears, generate your 6-digit login code at https://2fa.live using the provided 2FA Secret Key.',
      'If a confirmation code is sent to the attached email, check the connected email address provided to approve the login.',
      'Wait at least 24 hours before editing bio, username, or adding external links.',
    ]
  }

  if (p.includes('facebook')) {
    return [
      'Navigate to https://facebook.com using a dedicated browser profile or anti-detect browser with residential proxy.',
      'Log in using the User ID (UID) and Password provided above.',
      'When 2FA is prompted, generate the 6-digit code via https://2fa.live using the 2FA Secret Key.',
      'If access token or session cookies were provided, import them into your automation software or cookie extension.',
      'Warm up the account naturally by browsing before engaging in marketplace or advertising activities.',
    ]
  }

  if (p.includes('tiktok') || p.includes('threads') || p.includes('reddit') || p.includes('snapchat')) {
    return [
      'Open the platform app or official website in a clean browser session.',
      'Log in with the username/email and password provided.',
      'If 2FA is required, enter the 6-digit code from https://2fa.live using your 2FA Secret Key.',
      'Review and update account security preferences once access is established.',
    ]
  }

  if (p.includes('ai') || p.includes('chatgpt') || p.includes('claude') || p.includes('elevenlabs')) {
    return [
      'Visit the official AI platform website (e.g. chatgpt.com, claude.ai, or elevenlabs.io).',
      'If credentials are provided, sign in directly with the designated email and password.',
      'If a license key or promo code is provided, navigate to Settings > Billing / Subscriptions and enter your code.',
      'If an activation link is provided, click the link while signed into your personal account to join the plan.',
      'For shared subscriptions, do not modify the account email or plan settings to ensure uninterrupted service.',
    ]
  }

  if (p.includes('vpn')) {
    return [
      'Download and install the official application from the VPN provider’s verified website.',
      'Open the application and select "Sign In" or "Activate Subscription".',
      'Enter the provided credentials or paste your license activation code.',
      'Connect to your preferred server location and confirm the VPN status is active.',
    ]
  }

  return [
    'Copy your access credentials or activation codes using the Copy buttons above.',
    'Visit the official service website or redemption portal to activate your purchase.',
    'Keep your credentials confidential and store your backup details securely.',
    'If you encounter any issues, click "Need Help With This Order?" below to contact LogsPoll customer support.',
  ]
}

/**
 * Main delivery normalizer:
 * Parses raw instructions into clean, structured account cards.
 */
export function parseDeliveryCredentials(
  rawInstructions: string,
  productName = '',
  categoryName = ''
): StructuredProductDelivery {
  const trimmed = (rawInstructions || '').trim()
  if (!trimmed) {
    return {
      productType: 'generic',
      platformName: 'Digital Product',
      accounts: [],
      instructions: getProductInstructions('generic'),
      raw: '',
      isAmbiguous: false,
    }
  }

  const { type, platform } = detectPlatform(productName, categoryName)
  const explicitFormat = extractExplicitFormat(productName)

  // Check if raw is a single JSON string
  const jsonFields = parseJsonDelivery(trimmed)
  if (jsonFields) {
    return {
      productType: type,
      platformName: platform,
      accounts: [
        {
          accountNumber: 1,
          title: 'Account Credentials',
          fields: jsonFields,
          raw: trimmed,
          isAmbiguous: false,
        },
      ],
      instructions: getProductInstructions(platform),
      raw: trimmed,
      isAmbiguous: false,
    }
  }

  // Split lines into potential multiple accounts
  const rawLines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  // Check if multiline text is labeled lines for ONE account:
  // e.g. "Email: ...\nPassword: ...\n2FA: ..."
  const labeledLineMatch = rawLines.every((l) => /^[A-Za-z0-9 _/-]+[:=]\s*.+$/.test(l))
  if (rawLines.length > 1 && labeledLineMatch) {
    const fields: StructuredCredentialField[] = []
    for (const l of rawLines) {
      const parts = l.split(/[:=]\s*(.+)/)
      if (parts.length >= 2) {
        const meta = labelFromFormatKey(parts[0])
        fields.push({
          label: meta.label,
          value: parts[1].trim(),
          type: meta.type,
          isSensitive: meta.isSensitive,
        })
      }
    }
    return {
      productType: type,
      platformName: platform,
      accounts: [
        {
          accountNumber: 1,
          title: 'Account Credentials',
          fields,
          raw: trimmed,
          isAmbiguous: false,
        },
      ],
      instructions: getProductInstructions(platform),
      raw: trimmed,
      isAmbiguous: false,
    }
  }

  // Each line is an account (e.g. 5 accounts bought = 5 lines)
  const accounts: StructuredAccountCard[] = []
  let hasAnyAmbiguous = false

  rawLines.forEach((line, index) => {
    const { fields, isAmbiguous } = parseDelimitedLine(line, type, explicitFormat)
    if (isAmbiguous) hasAnyAmbiguous = true

    accounts.push({
      accountNumber: index + 1,
      title: rawLines.length > 1 ? `Account #${index + 1}` : 'Account Credentials',
      fields,
      raw: line,
      isAmbiguous,
    })
  })

  return {
    productType: type,
    platformName: platform,
    accounts,
    instructions: getProductInstructions(platform),
    raw: trimmed,
    isAmbiguous: hasAnyAmbiguous,
    warning: hasAnyAmbiguous
      ? 'Some credentials use a custom or unverified format. Original details are safely displayed to prevent mislabeling.'
      : undefined,
  }
}
