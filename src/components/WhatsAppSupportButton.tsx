import React, { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { WhatsAppSupportModal } from './WhatsAppSupportModal'

interface WhatsAppSupportButtonProps {
  orderReference?: string
  initialComplaint?: string
  buttonText?: string
  className?: string
  style?: React.CSSProperties
  variant?: 'primary' | 'secondary' | 'outline' | 'compact'
  iconOnly?: boolean
  ariaLabel?: string
}

export function WhatsAppSupportButton({
  orderReference,
  initialComplaint,
  buttonText = 'Contact Support on WhatsApp',
  className = '',
  style,
  variant = 'primary',
  iconOnly = false,
  ariaLabel
}: WhatsAppSupportButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  const variantClass =
    variant === 'primary'
      ? 'whatsapp-btn-primary'
      : variant === 'secondary'
      ? 'whatsapp-btn-secondary'
      : variant === 'outline'
      ? 'whatsapp-btn-outline'
      : 'whatsapp-btn-compact'

  return (
    <>
      <button
        type="button"
        className={`whatsapp-support-trigger ${variantClass} ${className}`}
        style={style}
        onClick={() => setIsOpen(true)}
        aria-label={ariaLabel || buttonText}
      >
        <span className="whatsapp-btn-icon" aria-hidden="true">
          <MessageSquare size={16} />
        </span>
        {!iconOnly && <span className="whatsapp-btn-text">{buttonText}</span>}
      </button>

      <WhatsAppSupportModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        orderReference={orderReference}
        initialComplaint={initialComplaint}
      />
    </>
  )
}

