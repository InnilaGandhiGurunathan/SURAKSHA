/**
 * SMS fallback.
 *
 * What this genuinely can and cannot do on the web:
 *  - it **can** open the device's messaging app pre-filled with the alert text
 *    and recipients (`sms:` URI) — the user still has to press send;
 *  - it **cannot** send silently in the background, and it cannot know whether
 *    the message left the phone.
 *
 * So this module never returns a "delivered" state. It returns `handoff`, which
 * the UI is required to describe as "your messaging app was opened", plus a
 * capability report when the browser will not do it at all.
 */

export type SmsOutcome = 'handoff' | 'unsupported' | 'unavailable';

export interface SmsHandoffResult {
  outcome: SmsOutcome;
  message: string;
  url?: string;
  recipients: string[];
}

export interface SmsCapability {
  supported: boolean;
  reason?: string;
  recipients: number;
}

export function smsCapability(recipients: string[]): SmsCapability {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'SMS handoff needs a browser.', recipients: 0 };
  }
  const valid = recipients.map(normalise).filter(Boolean);
  if (valid.length === 0) {
    return {
      supported: false,
      reason: 'No trusted contact has a phone number stored on this device.',
      recipients: 0,
    };
  }
  return { supported: true, recipients: valid.length };
}

function normalise(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

function encodeBody(body: string): string {
  // Browsers expect the body percent-encoded; some need '?' instead of '&body='.
  return encodeURIComponent(body).replace(/%20/g, ' ');
}

export function buildSmsLink(recipients: string[], body: string, separator: 'comma' | 'semicolon' = 'comma'): string {
  const valid = recipients.map(normalise).filter(Boolean);
  const joined = valid.join(separator === 'comma' ? ',' : ';');
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const delimiter = isiOS ? '&' : '?';
  return `sms:${joined}${delimiter}body=${encodeBody(body)}`;
}

export function openSmsHandoff(input: {
  recipients: string[];
  body: string;
}): SmsHandoffResult {
  const capability = smsCapability(input.recipients);
  if (!capability.supported) {
    return {
      outcome: 'unsupported',
      message: capability.reason ?? 'SMS handoff is not available on this device.',
      recipients: [],
    };
  }

  const url = buildSmsLink(input.recipients, input.body);

  try {
    // A top-level navigation is the most reliable way to reach the messaging app
    // from a PWA, so it is used rather than window.open.
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    return {
      outcome: 'handoff',
      message:
        'Your messaging app was opened with the alert text and recipients. SURAKSHA cannot confirm the message was sent — press send there.',
      url,
      recipients: capability.recipients ? input.recipients.map(normalise) : [],
    };
  } catch {
    return {
      outcome: 'unavailable',
      message:
        'This browser would not open the messaging app. Copy the alert text below and send it yourself, or call your contact.',
      recipients: [],
    };
  }
}

/** `tel:` link — deliberately user-initiated only. */
export function buildDialLink(number: string): string {
  return `tel:${number.replace(/[^\d+]/g, '')}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export async function shareText(input: { title: string; text: string; url?: string }): Promise<boolean> {
  try {
    if (navigator.share) {
      await navigator.share(input);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export const SMS_DISCLAIMER =
  'SMS handoff opens your messaging app with the alert pre-filled. SURAKSHA cannot send SMS in the background and cannot confirm delivery.';
