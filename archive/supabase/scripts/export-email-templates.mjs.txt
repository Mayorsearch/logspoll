import { mkdir, writeFile } from 'node:fs/promises'
import { renderEmail, emailTemplates, sampleEmail } from '../src/lib/email-templates.ts'
const root = new URL('../emails/supabase/', import.meta.url)
await mkdir(root, { recursive: true })
const confirmationUrl = 'https://template.invalid/auth/v1/verify?confirmation=replace'
const manifest = []
for (const kind of ['verification', 'password_reset', 'password_changed', 'email_changed']) {
  const email = renderEmail(kind, { confirmationUrl, confirmationOrigin: 'https://template.invalid' })
  const html = email.html.replaceAll(confirmationUrl, '{{ .ConfirmationURL }}')
  const text = email.text.replaceAll(confirmationUrl, '{{ .ConfirmationURL }}')
  await writeFile(new URL(`${kind}.html`, root), html + '\n')
  await writeFile(new URL(`${kind}.txt`, root), text + '\n')
  manifest.push({ template: kind, subject: email.subject, file: `${kind}.html` })
}
await writeFile(new URL('manifest.json', root), JSON.stringify(manifest, null, 2) + '\n')
// Review all 22 templates locally without authentication or any email delivery.
// Temporary gallery is deliberately outside dist/public.
const preview = new URL('../emails/preview/', import.meta.url)
await mkdir(preview, { recursive: true })
for (const kind of Object.keys(emailTemplates)) {
  const email = sampleEmail(kind)
  await writeFile(new URL(`${kind}.html`, preview), email.html + '\n')
  await writeFile(new URL(`${kind}.txt`, preview), email.text + '\n')
}
await writeFile(new URL('index.html', preview), '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOGSPOLL sample emails</title><h1>LOGSPOLL — synthetic email previews</h1><ul>' + Object.entries(emailTemplates).map(([id, template]) => `<li><a href="${id}.html">${template[0]}</a> · <a href="${id}.txt">plain text</a></li>`).join('') + '</ul>')
console.log('Exported 4 Supabase templates and 22 HTML/plain-text sample previews. No emails sent.')
