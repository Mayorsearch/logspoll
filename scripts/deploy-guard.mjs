#!/usr/bin/env node
/**
 * Logspoll Production Deployment & Environment Safety Guard
 * 
 * Purpose:
 * Prevents accidental destruction of Cloudflare Pages environment variables and secrets.
 * 
 * Incident Post-Mortem & Context:
 * In Cloudflare Pages, HTTP PATCH to `/pages/projects/:name` replaces the entire
 * `deployment_configs.production.env_vars` dictionary. Any script that sends a subset
 * of environment variables via PATCH will permanently delete all unmentioned secrets.
 * 
 * Mandated Rules:
 * 1. NEVER use HTTP PATCH on Cloudflare Pages `env_vars`.
 * 2. Secrets must be created or updated atomically via `npx wrangler pages secret put`.
 * 3. Preflight checks must verify that existing secrets (AUTH_SECRET, RESEND_API_KEY,
 *    SUPPLIER_ENCRYPTION_KEY, etc.) remain intact before any deployment.
 */

import fs from 'node:fs';
import path from 'node:path';

export const PROTECTED_SECRET_KEYS = [
  'AUTH_SECRET',
  'RESEND_API_KEY',
  'BACHS_API_KEY',
  'BACHS_WEBHOOK_SECRET',
  'SUPPLIER_ENCRYPTION_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
];

/**
 * Scans a code string or file content for dangerous Cloudflare Pages PATCH patterns.
 */
export function checkCodeForDestructivePatch(content) {
  const issues = [];
  
  // Check for HTTP PATCH against pages/projects with env_vars
  const hasPatch = /['"`]PATCH['"`]|\.patch\(/i.test(content);
  const hasPagesProject = /pages\/projects\//i.test(content);
  const hasEnvVars = /env_vars/i.test(content);

  if (hasPatch && hasPagesProject && hasEnvVars) {
    issues.push('CRITICAL: Detected destructive HTTP PATCH targeting pages/projects env_vars. This erases unmentioned secrets.');
  }

  return {
    safe: issues.length === 0,
    issues
  };
}

/**
 * Audits repository scripts to ensure no file contains dangerous Pages PATCH operations.
 */
export function auditRepositoryDeploymentSafety(repoRoot = process.cwd()) {
  const scannedFiles = [];
  const violations = [];

  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (['node_modules', '.git', 'dist', '.wrangler', 'tests'].includes(entry.name)) continue;
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.js')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && /\.(mjs|js|ts|sh)$/.test(entry.name)) {
        scannedFiles.push(fullPath);
        const content = fs.readFileSync(fullPath, 'utf8');
        const check = checkCodeForDestructivePatch(content);
        if (!check.safe) {
          violations.push({ file: fullPath, issues: check.issues });
        }
      }
    }
  }

  scan(repoRoot);
  return { scannedFiles: scannedFiles.length, violations };
}

// If executed directly as CLI script:
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  console.log('[Deploy Guard] Auditing repository scripts for destructive Cloudflare configuration calls...');
  const audit = auditRepositoryDeploymentSafety();
  console.log(`[Deploy Guard] Scanned ${audit.scannedFiles} script files.`);
  if (audit.violations.length > 0) {
    console.error(`[Deploy Guard] VIOLATIONS FOUND (${audit.violations.length}):`);
    for (const v of audit.violations) {
      console.error(` - ${v.file}: ${v.issues.join(', ')}`);
    }
    process.exit(1);
  } else {
    console.log('[Deploy Guard] PASSED. No destructive Cloudflare Pages PATCH calls detected.');
    process.exit(0);
  }
}
