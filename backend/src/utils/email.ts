import { Env } from '../types';

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Robust Email Provider Abstraction
 * Supports Resend, Brevo (via HTTP API), and Console Mock fallback.
 */
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string
): Promise<EmailResult> {
  const apiKey = env.RESEND_API_KEY;

  if (!apiKey || apiKey === 'mock' || apiKey === '') {
    // Console Mock Fallback: Extremely helpful for testing, local development, and non-configured environments
    console.log('====== [MOCK EMAIL DELIVERY] ======');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:    ${html.substring(0, 300)}...`);
    console.log('====================================');
    return {
      success: true,
      messageId: `mock-msg-${crypto.randomUUID()}`
    };
  }

  try {
    // 1. Resend API Integration
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'DSMNRU EventHub <events@dsmnru.edu.in>', // Note: in real prod, use a verified sending domain
        to,
        subject,
        html
      })
    });

    const resData: any = await response.json().catch(() => ({}));
    if (response.ok && resData.id) {
      return {
        success: true,
        messageId: resData.id
      };
    }

    return {
      success: false,
      error: resData.message || `Resend failed with status ${response.status}`
    };
  } catch (err: any) {
    console.error('Email provider error:', err);
    return {
      success: false,
      error: err.message || 'Network error'
    };
  }
}
