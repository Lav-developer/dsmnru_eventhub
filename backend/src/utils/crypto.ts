// Cryptographic helper functions for password hashing and token generation
// Using Web Crypto API which is native to Cloudflare Workers and extremely fast/secure.

export function generateUUID(): string {
  return crypto.randomUUID();
}

export function generateOpaqueToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function generateShortId(length = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// Convert a string to an ArrayBuffer
function str2ab(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer;
}

// Convert an ArrayBuffer or Uint8Array to a hex string
function buf2hex(buffer: ArrayBuffer | Uint8Array): string {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Convert a hex string to an ArrayBuffer
function hex2buf(hex: string): ArrayBuffer {
  const view = new Uint8Array(hex.length / 2);
  for (let i = 0; i < view.length; i++) {
    view[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return view.buffer;
}

/**
 * PBKDF2 Password Hashing
 * Format: pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
 */
export async function hashPassword(password: string): Promise<string> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const saltHex = buf2hex(saltBytes);
  const iterations = 100000;

  const baseKey = await crypto.subtle.importKey(
    'raw',
    str2ab(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  const derivedKeyBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: iterations,
      hash: 'SHA-256'
    },
    baseKey,
    256
  );

  const hashHex = buf2hex(derivedKeyBuffer);
  return `pbkdf2_sha256$${iterations}$${saltHex}$${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
      return false;
    }

    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const hashHex = parts[3];

    const saltBytes = new Uint8Array(hex2buf(saltHex));
    const baseKey = await crypto.subtle.importKey(
      'raw',
      str2ab(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    const derivedKeyBuffer = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: iterations,
        hash: 'SHA-256'
      },
      baseKey,
      256
    );

    const verifyHex = buf2hex(derivedKeyBuffer);
    return verifyHex === hashHex;
  } catch (err) {
    console.error('Password verification error:', err);
    return false;
  }
}
