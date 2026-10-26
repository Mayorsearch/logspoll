/**
 * LogsPoll Official WhatsApp Customer Support Integration
 * Official Support Number: +2348117472091
 * Direct Link: https://wa.me/2348117472091
 */

import { useState, useEffect } from 'react'

export const DEFAULT_WHATSAPP_NUMBER = '2348117472091'
export const DEFAULT_WHATSAPP_DISPLAY = '+234 811 747 2091'

let cachedWhatsAppNumber: string | null = null

/**
 * Normalizes any phone string to international digits without '+' or symbols
 */
export function cleanWhatsAppNumber(phone?: string | null): string {
  if (!phone) return DEFAULT_WHATSAPP_NUMBER
  const digits = String(phone).replace(/\D/g, '')
  // Must be at least 8 digits to be a plausible international number
  return digits.length >= 8 ? digits : DEFAULT_WHATSAPP_NUMBER
}

/**
 * Builds the exact required prefilled complaint message
 */
export function buildWhatsAppMessage(complaint: string, orderReference?: string | null): string {
  const cleanComplaint = complaint.trim()
  const cleanRef = orderReference?.trim()

  if (cleanRef) {
    return `I'm here from LogsPoll.\n\nOrder Reference: ${cleanRef}\n\nMy complaint is: ${cleanComplaint}`
  }

  return `I'm here from LogsPoll.\n\nMy complaint is: ${cleanComplaint}`
}

/**
 * Generates the official https://wa.me/ URL with prefilled text
 */
export function buildWhatsAppUrl(options: {
  phone?: string | null
  complaint: string
  orderReference?: string | null
}): string {
  const phone = cleanWhatsAppNumber(options.phone)
  const message = buildWhatsAppMessage(options.complaint, options.orderReference)
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
}

/**
 * Sensitive data sanitizer to prevent credentials or tokens from being leaked into WhatsApp messages
 */
export function sanitizeComplaint(input: string): string {
  if (!input) return ''
  return input
    // Mask potential API keys, passwords, or tokens
    .replace(/(password|passwd|pwd|token|secret|key)[\s:=]+[^\s]+/gi, '$1: [REDACTED]')
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[TOKEN_REDACTED]')
    .replace(/-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g, '[PRIVATE_KEY_REDACTED]')
    .trim()
}

/**
 * Hook to retrieve the active WhatsApp number dynamically configured in Admin -> Settings
 */
export function useWhatsAppConfig(): { whatsappNumber: string; displayPhone: string; isLoaded: boolean } {
  const [whatsappNumber, setWhatsappNumber] = useState<string>(cachedWhatsAppNumber || DEFAULT_WHATSAPP_NUMBER)
  const [isLoaded, setIsLoaded] = useState<boolean>(Boolean(cachedWhatsAppNumber))

  useEffect(() => {
    let active = true
    if (cachedWhatsAppNumber) {
      setWhatsappNumber(cachedWhatsAppNumber)
      setIsLoaded(true)
      return
    }

    fetch('/api/config')
      .then((res) => {
        if (!res.ok) throw new Error('Config fetch failed')
        return res.json() as Promise<{ settings?: { whatsapp_number?: string } }>
      })
      .then((data) => {
        if (!active) return
        const num = data.settings?.whatsapp_number
        if (num) {
          const cleaned = cleanWhatsAppNumber(num)
          cachedWhatsAppNumber = cleaned
          setWhatsappNumber(cleaned)
        }
        setIsLoaded(true)
      })
      .catch(() => {
        if (active) {
          cachedWhatsAppNumber = DEFAULT_WHATSAPP_NUMBER
          setWhatsappNumber(DEFAULT_WHATSAPP_NUMBER)
          setIsLoaded(true)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const displayPhone = whatsappNumber === DEFAULT_WHATSAPP_NUMBER 
    ? DEFAULT_WHATSAPP_DISPLAY 
    : `+${whatsappNumber}`

  return { whatsappNumber, displayPhone, isLoaded }
}
