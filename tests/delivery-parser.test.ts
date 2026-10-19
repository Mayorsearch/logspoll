import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseDeliveryCredentials,
  isEmail,
  isBase32Secret,
  isUrl,
  isHexToken,
  detectPlatform,
  extractExplicitFormat,
  getProductInstructions,
} from '../src/lib/delivery-parser.ts'

test('detectPlatform identifies platform and productType from names', () => {
  assert.deepEqual(detectPlatform('Fresh Gmail Account | 2FA', 'Gmail Accounts'), {
    type: 'email',
    platform: 'Gmail / Google',
  })
  assert.deepEqual(detectPlatform('Twitter Accounts | 2FA Enabled | Tokens', 'Twitter Accounts'), {
    type: 'social',
    platform: 'Twitter / X',
  })
  assert.deepEqual(detectPlatform('Instagram 50+ Followers', 'Instagram Accounts'), {
    type: 'social',
    platform: 'Instagram',
  })
  assert.deepEqual(detectPlatform('ChatGPT Plus Subscription 1 Month', 'AI Tools'), {
    type: 'ai_subscription',
    platform: 'AI Subscription',
  })
  assert.deepEqual(detectPlatform('HMA VPN 1 Year License', 'VPN'), {
    type: 'vpn',
    platform: 'VPN Service',
  })
  assert.deepEqual(detectPlatform('$10 Prepaid Mastercard Gift Card', 'Mastercard'), {
    type: 'license',
    platform: 'Digital License',
  })
})

test('extractExplicitFormat parses format declarations from product titles', () => {
  assert.deepEqual(
    extractExplicitFormat('Vietnam Facebook random profile FILE FORMAT: UID:PASS:2FA:TOKEN:MAIL'),
    ['uid', 'pass', '2fa', 'token', 'mail']
  )
  assert.deepEqual(
    extractExplicitFormat('2024 CLONE INSTGRAM Format: Username+Password+2Fa+Mail'),
    ['username', 'password', '2fa', 'mail']
  )
  assert.deepEqual(
    extractExplicitFormat('TIKTOK 10-30 Followers LOG FORMAT Username || password || mail || token'),
    ['username', 'password', 'mail', 'token']
  )
  assert.equal(extractExplicitFormat('Simple Product With No Format Tag'), null)
})

test('Gmail account 3-part credentials separates Email, Password and Recovery Email', () => {
  const raw = 'sarah.connor92@gmail.com:CyberDyne2026!:kyle.reese.rec@gmail.com'
  const parsed = parseDeliveryCredentials(raw, 'Gmail Account 2024', 'Gmail Accounts')

  assert.equal(parsed.productType, 'email')
  assert.equal(parsed.accounts.length, 1)
  const fields = parsed.accounts[0].fields
  assert.equal(fields.length, 3)

  assert.equal(fields[0].label, 'EMAIL ADDRESS')
  assert.equal(fields[0].value, 'sarah.connor92@gmail.com')
  assert.equal(fields[0].isSensitive, false)

  assert.equal(fields[1].label, 'PASSWORD')
  assert.equal(fields[1].value, 'CyberDyne2026!')
  assert.equal(fields[1].isSensitive, true)

  assert.equal(fields[2].label, 'RECOVERY EMAIL')
  assert.equal(fields[2].value, 'kyle.reese.rec@gmail.com')
  assert.equal(fields[2].isSensitive, true)
})

test('Gmail account 4-part with 2FA secret separates Email, Password, Recovery, and 2FA', () => {
  const raw = 'alex.dev88@gmail.com:SuperPass123!:rec.alex@gmail.com:JBSWY3DPEHPK3PXP'
  const parsed = parseDeliveryCredentials(raw, 'Gmail Accounts | 2FA Enabled', 'Gmail Accounts')

  assert.equal(parsed.accounts.length, 1)
  const fields = parsed.accounts[0].fields
  assert.equal(fields.length, 4)
  assert.equal(fields[0].label, 'EMAIL ADDRESS')
  assert.equal(fields[1].label, 'PASSWORD')
  assert.equal(fields[1].isSensitive, true)
  assert.equal(fields[2].label, 'RECOVERY EMAIL')
  assert.equal(fields[3].label, '2FA SECRET')
  assert.equal(fields[3].value, 'JBSWY3DPEHPK3PXP')
  assert.equal(fields[3].isSensitive, true)
})

test('Twitter account with 6 parts separates Username, Password, Connected Email, Email Pass, 2FA, and Token', () => {
  const raw = 'JaclynGonz65rh:SecPass789:jaclyn.g@outlook.com:MailPass456:JBSWY3DPEHPK3PXP:a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4'
  const parsed = parseDeliveryCredentials(
    raw,
    'Twitter Accounts | Email Verified | 2FA Enabled | Tokens Included',
    'Twitter Accounts'
  )

  assert.equal(parsed.productType, 'social')
  assert.equal(parsed.platformName, 'Twitter / X')
  assert.equal(parsed.accounts.length, 1)
  const fields = parsed.accounts[0].fields

  assert.equal(fields.length, 6)
  assert.equal(fields[0].label, 'USERNAME')
  assert.equal(fields[0].value, 'JaclynGonz65rh')
  assert.equal(fields[0].isSensitive, false)

  assert.equal(fields[1].label, 'PASSWORD')
  assert.equal(fields[1].value, 'SecPass789')
  assert.equal(fields[1].isSensitive, true)

  assert.equal(fields[2].label, 'CONNECTED EMAIL')
  assert.equal(fields[2].value, 'jaclyn.g@outlook.com')
  assert.equal(fields[2].isSensitive, false)

  assert.equal(fields[3].label, 'EMAIL PASSWORD')
  assert.equal(fields[3].value, 'MailPass456')
  assert.equal(fields[3].isSensitive, true)

  assert.equal(fields[4].label, '2FA SECRET KEY')
  assert.equal(fields[4].value, 'JBSWY3DPEHPK3PXP')
  assert.equal(fields[4].isSensitive, true)

  assert.equal(fields[5].label, 'AUTH TOKEN')
  assert.equal(fields[5].value, 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4')
  assert.equal(fields[5].isSensitive, true)
})

test('Multiple accounts (e.g. 3 accounts) parsed into 3 distinct numbered account cards', () => {
  const raw = [
    'acc1@gmail.com:Pass111:rec1@gmail.com',
    'acc2@gmail.com:Pass222:rec2@gmail.com',
    'acc3@gmail.com:Pass333:rec3@gmail.com',
  ].join('\n')

  const parsed = parseDeliveryCredentials(raw, 'Gmail Accounts Pack', 'Gmail Accounts')
  assert.equal(parsed.accounts.length, 3)
  assert.equal(parsed.accounts[0].title, 'Account #1')
  assert.equal(parsed.accounts[0].fields[0].value, 'acc1@gmail.com')
  assert.equal(parsed.accounts[1].title, 'Account #2')
  assert.equal(parsed.accounts[1].fields[0].value, 'acc2@gmail.com')
  assert.equal(parsed.accounts[2].title, 'Account #3')
  assert.equal(parsed.accounts[2].fields[0].value, 'acc3@gmail.com')
})

test('Explicit title format mapping applies accurately to UID:PASS:2FA:TOKEN:MAIL', () => {
  const raw = '100089123456789:SecretPass!:JBSWY3DPEHPK3PXP:token_xyz_999:fbuser@webmail.org'
  const title = '2024-25 Vietnam Facebook random profile FULL 2FA FILE FORMAT: UID:PASS:2FA:TOKEN:MAIL'
  const parsed = parseDeliveryCredentials(raw, title, 'Country Facebook')

  assert.equal(parsed.accounts.length, 1)
  const fields = parsed.accounts[0].fields
  assert.equal(fields.length, 5)
  assert.equal(fields[0].label, 'USERNAME / ID')
  assert.equal(fields[0].value, '100089123456789')
  assert.equal(fields[1].label, 'PASSWORD')
  assert.equal(fields[1].value, 'SecretPass!')
  assert.equal(fields[2].label, '2FA SECRET')
  assert.equal(fields[3].label, 'AUTH TOKEN')
  assert.equal(fields[4].label, 'EMAIL ADDRESS')
  assert.equal(fields[4].value, 'fbuser@webmail.org')
})

test('JSON supplier responses parse into clean labeled fields', () => {
  const raw = JSON.stringify({
    email: 'ai.subscriber@openai.test',
    password: 'SecureAIPassword!',
    plan: 'ChatGPT Plus 1 Month',
    two_factor: 'JBSWY3DPEHPK3PXP',
  })
  const parsed = parseDeliveryCredentials(raw, 'ChatGPT Plus Account', 'AI Tools')

  assert.equal(parsed.accounts.length, 1)
  const fields = parsed.accounts[0].fields
  assert.equal(fields.length, 4)
  assert.equal(fields.find(f => f.label === 'EMAIL ADDRESS')?.value, 'ai.subscriber@openai.test')
  assert.equal(fields.find(f => f.label === 'PASSWORD')?.isSensitive, true)
  assert.equal(fields.find(f => f.label === '2FA SECRET')?.isSensitive, true)
})

test('Single license key and activation link parsed without mislabeling', () => {
  const code = 'PROMO-CRED-789-ACTIVATION-KEY'
  const parsedCode = parseDeliveryCredentials(code, 'Software License Key', 'Licenses')
  assert.equal(parsedCode.accounts[0].fields[0].label, 'LICENSE KEY / ACTIVATION CODE')
  assert.equal(parsedCode.accounts[0].fields[0].value, code)

  const url = 'https://activate.ai-tool.com/redeem?token=xyz123'
  const parsedUrl = parseDeliveryCredentials(url, 'AI Tool Activation Link', 'AI Tools')
  assert.equal(parsedUrl.accounts[0].fields[0].label, 'ACTIVATION LINK')
  assert.equal(parsedUrl.accounts[0].fields[0].value, url)
})

test('Ambiguous format preserves original text with warning flag and does not guess', () => {
  const raw = 'random_custom_unlabeled_data_123_no_pattern'
  const parsed = parseDeliveryCredentials(raw, 'Custom Product', 'Custom')
  assert.equal(parsed.accounts.length, 1)
  assert.equal(parsed.accounts[0].fields[0].value, raw)
})

test('Product instructions return accurate, platform-specific guides without invented guarantees', () => {
  const gmailGuide = getProductInstructions('Gmail / Google')
  assert.ok(gmailGuide.some(s => s.includes('Confirm your recovery email')))
  assert.ok(gmailGuide.some(s => s.includes('2fa.live')))

  const twitterGuide = getProductInstructions('Twitter / X')
  assert.ok(twitterGuide.some(s => s.includes('2fa.live')))
  assert.ok(twitterGuide.some(s => s.includes('auth_token')))

  const vpnGuide = getProductInstructions('VPN Service')
  assert.ok(vpnGuide.some(s => s.includes('official application')))
})
