import { HttpError } from './auth.ts'
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
function decode(value: string) {
  try { return Uint8Array.from(atob(value), char => char.charCodeAt(0)) }
  catch { throw new HttpError(503, 'Supplier encryption configuration is invalid.') }
}
async function encryptionKey(secret: string | undefined) {
  const bytes = decode(secret ?? '')
  if (bytes.length !== 32) throw new HttpError(503, 'Configure SUPPLIER_ENCRYPTION_KEY as 32 random bytes encoded in base64.')
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function sealCredential(value: string, connectionId: string, secret: string | undefined) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(connectionId) }, await encryptionKey(secret), new TextEncoder().encode(value))
  return { ciphertext: encode(new Uint8Array(ciphertext)), nonce: encode(iv) }
}
export async function openCredential(ciphertext: string, nonce: string, connectionId: string, secret: string | undefined) {
  const key = await encryptionKey(secret)
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(nonce), additionalData: new TextEncoder().encode(connectionId) }, key, decode(ciphertext)))
  } catch { throw new HttpError(503, 'Saved credential cannot be decrypted. Check the encryption secret or replace the supplier key.') }
}
