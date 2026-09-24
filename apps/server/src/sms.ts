import { config } from './config.js';
import type { StoredAlert } from './store.js';

/**
 * Optional server-side SMS gateway.
 *
 * SURAKSHA never claims an SMS was delivered unless the gateway confirms it. If
 * no gateway is configured the helpers report `configured: false` and the client
 * falls back to the honest client-side handoff (`sms:` URI), which only opens
 * the messaging app.
 */

export function smsConfigured(): boolean {
  return Boolean(config.smsGatewayUrl && config.smsGatewayToken);
}

export interface SmsDeliveryResult {
  sent: boolean;
  providerId?: string;
  message: string;
}

export async function sendSms(to: string[], body: string): Promise<SmsDeliveryResult> {
  if (!smsConfigured()) {
    return {
      sent: false,
      message:
        'No SMS gateway configured. The client-side handoff (opening the messaging app) is used instead, and delivery cannot be confirmed by SURAKSHA.',
    };
  }

  try {
    const response = await fetch(config.smsGatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.smsGatewayToken}`,
      },
      body: JSON.stringify({ to, body, senderId: config.smsSenderId, application: 'SURAKSHA' }),
    });

    if (!response.ok) {
      return { sent: false, message: `The SMS gateway responded with HTTP ${response.status}.` };
    }
    const data = (await response.json()) as { id?: string; sid?: string };
    return {
      sent: true,
      providerId: data.id ?? data.sid,
      message: 'The SMS gateway accepted the message for delivery.',
    };
  } catch (error) {
    return {
      sent: false,
      message: `The SMS gateway could not be reached: ${error instanceof Error ? error.message : 'unknown error'}.`,
    };
  }
}

/**
 * Best-effort SMS for an SOS alert. Returns the number of messages the gateway
 * accepted — never the number "delivered".
 */
export async function optionalSms(alert: StoredAlert): Promise<number> {
  const payload = alert.payload as { contactPhones?: string[]; note?: string; location?: { lat: number; lng: number } };
  const recipients = payload.contactPhones ?? [];
  if (recipients.length === 0) return 0;

  const locationLine = alert.location
    ? `Location: https://www.openstreetmap.org/?mlat=${alert.location.lat.toFixed(5)}&mlon=${alert.location.lng.toFixed(5)}`
    : 'Location: not available';

  const result = await sendSms(
    recipients,
    [
      `SURAKSHA SOS — ${alert.ownerName ?? 'a traveller'} may need help.`,
      alert.message,
      locationLine,
      payload.note ? `Note: ${payload.note}` : '',
      'If you cannot reach them, contact local emergency services.',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  if (!result.sent) {
    console.warn('[suraksha] SMS fallback not sent:', result.message);
    return 0;
  }
  return recipients.length;
}
