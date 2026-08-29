export const SERVICE_WINDOW_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export interface ServiceWindowEvaluation {
  isOpen: boolean;
  expiresAt: Date | null;
  remainingSeconds: number | null;
}

/**
 * Calculates WhatsApp 24-hour Customer Service Window status based on the latest inbound customer message.
 *
 * WhatsApp Policy:
 * - Businesses may reply with free-form messages within 24 hours of the customer's last message.
 * - Outside this 24-hour window, or before any customer message has been received,
 *   businesses may only send approved WhatsApp message templates.
 *
 * @param lastInboundAt Timestamp of the most recent inbound message sent by the customer.
 * @param now Reference current time (defaults to new Date()).
 */
export function calculateServiceWindow(
  lastInboundAt: Date | string | null | undefined,
  now = new Date()
): ServiceWindowEvaluation {
  if (!lastInboundAt) {
    return {
      isOpen: false,
      expiresAt: null,
      remainingSeconds: null
    };
  }

  const inboundDate = lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
  if (Number.isNaN(inboundDate.getTime())) {
    return {
      isOpen: false,
      expiresAt: null,
      remainingSeconds: null
    };
  }

  const expiresAt = new Date(inboundDate.getTime() + SERVICE_WINDOW_DURATION_MS);
  const remainingMs = expiresAt.getTime() - now.getTime();
  const isOpen = remainingMs > 0;
  const remainingSeconds = isOpen ? Math.floor(remainingMs / 1000) : 0;

  return {
    isOpen,
    expiresAt,
    remainingSeconds
  };
}

/**
 * Convenience helper returning boolean eligibility for free-form messaging.
 */
export function isWithinServiceWindow(
  lastInboundAt: Date | string | null | undefined,
  now = new Date()
): boolean {
  return calculateServiceWindow(lastInboundAt, now).isOpen;
}
