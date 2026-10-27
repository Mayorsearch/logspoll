import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkCodeForDestructivePatch,
  auditRepositoryDeploymentSafety,
  PROTECTED_SECRET_KEYS
} from '../scripts/deploy-guard.mjs'

test('deployment safety: detects dangerous Cloudflare Pages PATCH calls that wipe env_vars', () => {
  const badScript = `
    const res = await fetch("https://api.cloudflare.com/client/v4/accounts/123/pages/projects/logspoll", {
      method: "PATCH",
      body: JSON.stringify({
        deployment_configs: {
          production: {
            env_vars: {
              AUTH_SECRET: { type: "secret_text", value: "foo" }
            }
          }
        }
      })
    });
  `
  const check = checkCodeForDestructivePatch(badScript)
  assert.equal(check.safe, false, 'Dangerous PATCH must be detected')
  assert.ok(check.issues.length > 0, 'Issues array must explain the violation')
})

test('deployment safety: allows safe deployment commands (wrangler pages deploy / secret put)', () => {
  const safeScript = `
    // Deployment via standard Wrangler Pages deploy
    npx wrangler pages deploy dist --project-name=logspoll --branch=rebuild/react-vite
    // Atomic secret setting
    npx wrangler pages secret put BACHS_API_KEY --project-name=logspoll
  `
  const check = checkCodeForDestructivePatch(safeScript)
  assert.equal(check.safe, true, 'Standard wrangler operations must be allowed')
  assert.equal(check.issues.length, 0)
})

test('deployment safety: auditRepositoryDeploymentSafety finds 0 violations across repository', () => {
  const audit = auditRepositoryDeploymentSafety()
  assert.ok(audit.scannedFiles > 0, 'Must scan repository script files')
  assert.deepEqual(audit.violations, [], 'Repository must have 0 destructive Pages PATCH violations')
})

test('deployment safety: protects all critical production secret keys', () => {
  const required = [
    'AUTH_SECRET',
    'RESEND_API_KEY',
    'BACHS_API_KEY',
    'BACHS_WEBHOOK_SECRET',
    'SUPPLIER_ENCRYPTION_KEY',
  ]
  for (const k of required) {
    assert.ok(PROTECTED_SECRET_KEYS.includes(k), `PROTECTED_SECRET_KEYS must include ${k}`)
  }
})

