export type DetailedDeliveryStatus =
  | 'payment_pending'
  | 'delivery_processing'
  | 'awaiting_supplier'
  | 'delivery_failed'
  | 'delivered'

export interface OrderStatusDetails {
  status: DetailedDeliveryStatus
  label: string
  description: string
  badgeClass: string
  canDownload: boolean
  needsSupport: boolean
}

export function getOrderDeliveryStatus(order: {
  payment_status: string
  fulfillment_status: string
  delivery_status?: string | null
  delivery_error?: string | null
  has_entitlement?: boolean | number | null
}): OrderStatusDetails {
  const payStatus = order.payment_status?.toLowerCase()
  const fulStatus = order.fulfillment_status?.toLowerCase()
  const delStatus = order.delivery_status?.toLowerCase()

  if (payStatus === 'pending') {
    return {
      status: 'payment_pending',
      label: 'Payment Pending',
      description: 'Awaiting payment confirmation. Once payment is confirmed, fulfillment will start automatically.',
      badgeClass: 'status-payment-pending',
      canDownload: false,
      needsSupport: false,
    }
  }

  if (payStatus === 'failed' || payStatus === 'cancelled') {
    return {
      status: 'delivery_failed',
      label: payStatus === 'cancelled' ? 'Payment Cancelled' : 'Payment Failed',
      description: 'Payment was not completed. No supplier purchase was dispatched.',
      badgeClass: 'status-delivery-failed',
      canDownload: false,
      needsSupport: true,
    }
  }

  if (payStatus === 'refunded') {
    return {
      status: 'delivery_failed',
      label: 'Order Refunded',
      description: 'This order was refunded to your wallet balance. No product was delivered.',
      badgeClass: 'status-delivery-failed',
      canDownload: false,
      needsSupport: false,
    }
  }

  // Payment is confirmed/paid:
  if (payStatus === 'paid') {
    const entitlementConfirmed = order.has_entitlement === undefined ? fulStatus === 'delivered' : Boolean(order.has_entitlement)
    if (fulStatus === 'delivered' && entitlementConfirmed) {
      return {
        status: 'delivered',
        label: 'Delivered',
        description: 'Your digital products have been verified and delivered to your Delivery Vault.',
        badgeClass: 'status-delivered',
        canDownload: true,
        needsSupport: false,
      }
    }

    if (
      fulStatus === 'failed' ||
      delStatus === 'blocked' ||
      delStatus === 'uncertain'
    ) {
      return {
        status: 'delivery_failed',
        label: 'Delivery Failed — Support Required',
        description: 'Payment was verified, but automated fulfillment could not be completed. Our support team is available to assist or issue a prompt refund.',
        badgeClass: 'status-delivery-failed',
        canDownload: false,
        needsSupport: true,
      }
    }

    if (
      delStatus === 'dispatched' ||
      delStatus === 'waiting' ||
      delStatus === 'retry'
    ) {
      return {
        status: 'awaiting_supplier',
        label: 'Delivery Awaiting Supplier',
        description: 'Purchase request dispatched to supplier. Awaiting generation and confirmation of delivery credentials.',
        badgeClass: 'status-awaiting-supplier',
        canDownload: false,
        needsSupport: false,
      }
    }

    // Default processing (queued, preparing, or unfulfilled)
    return {
      status: 'delivery_processing',
      label: 'Payment Confirmed — Delivery Processing',
      description: 'Payment is confirmed. Automated delivery is initializing and preparing your digital goods.',
      badgeClass: 'status-delivery-processing',
      canDownload: false,
      needsSupport: false,
    }
  }

  return {
    status: 'delivery_processing',
    label: 'Processing',
    description: 'Order is processing.',
    badgeClass: 'status-delivery-processing',
    canDownload: false,
    needsSupport: false,
  }
}

