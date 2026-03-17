/**
 * Google Sheets service account authentication.
 * Signs JWTs using Web Crypto API and exchanges them for access tokens.
 */

const SERVICE_ACCOUNT = {
  client_email: 'eyewire-ii-spreadsheet@eyewire-ii.iam.gserviceaccount.com',
  // RSA private key for JWT signing
  private_key: `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDJD63xxx8WiYxX
t8tEbPGQQll6LmDq7NMZNFPE+jzo72U6E5jjZ7GSVMj5yoJFmLTZqK6QqhpiFop+
5iK2FAPNl0g6GljOav40myjQ0th3H+W/5rZLovn4aP7OV2EvskIXF5vpTJnGhnIq
kX6mUY4tMmXcaD7dCXfZgmOCHODsYazaiZpc5gVEzduKScWaLThzAelwq1SQfD+s
4wx2ubzZ+DolgD1zPeydSBxSBKwhIdFBCClHXZkoidqUYe2dt8+cVSTlG8N1H9+D
nAhuTKiF0Ts1lnq1sCpLvBbzmTAZGLPTHuhcLl4kVR3z260+5RfEt+vpcFKJCN11
RF3wvnFVAgMBAAECggEAA2KKMSSDDM7AAsdgsAQ4L4+OZhTbI4QH1x10aOqK6qOt
IUSB3Gzl0RWFqf7oy+HS7vR8tolxQZl+N2i0c5BJXXALPT8to5FVj5kqdL7ipLlw
FWz9lgRmZPI6PUsR+HWYez8LLEBSjm8RA6UeFrq6GV9cgPtto4GsojLPGLpXvGMD
lM2cvWDL/SloMwlZUu8dFiHgY9OwVOZzhO4zdFo1tKeXzHs/M8cQrblb9YRVZjyP
PjtL/cXMxPzjqDYuVuSh1CWCeXDHkQlLOe9rAj5uInyiNMbiDzpKy86NxRKqBoC3
f2s2QcmykMzVTDNQATSC71hrNOJZdzTSqrLHG93qwQKBgQD3uA9PnwwvXhPIcaKr
sF4p3JaDQYHUPOOhSLzncG8X697OGykgc/29AIjUwXKT4Lo9dJxUET+QT0N1eZeX
caFEzbIixy0Sy5mjnQoEZFREBSrYeKUVbqfY7a4PHugH2Pa4odjqY2GLcZ9fqsW/
wRNb0M6La5JbbCH1XcbJSN4fDQKBgQDPyFSAL84SZFCTEhsvMaKA6x3vxBp1033q
e+FgS1ulWSXYnEXcuH+nniFsBXFmFFRc23RxgJF08aOsd6M6i01JgUtQUhQy8qT0
dh8Fqgrd3tQC0Ru9RCqm4k4DRubi/cGdHSeYRJru47qro276NcWi7WkETsq0FWkG
NheI561JaQKBgBtsNc2zpq6rtHbxFXf6K0JpGARpwQyUvQJCwh7A1JuKUfzxBsl/
7av5niwnSh7StutMuG2aBzZbf/VGQ6DRRHAQcVLmR7gX7+cr4EsCLE3nYIncOTI5
ML2T+jvUSQ1tWEqyKAgyfj7okiMODZwfrJvybpsCio4yV0QJYJMxzN0VAoGAeFW5
8n89JlOognRy//ML/QOt08VL2b9BZkKWdRFPo0Qs8fUXVMwZSjb/fjLsyMSvUxPZ
rT5bf1HOi7zB8M7qVM6nkn3mqtbyB449Syd+oZ5CRNtb6FIJLZtUuPsgDogN0HMp
EjtxSzbiTjMZu5jWvBQoxNDo/kCEEY/UM3qRVjkCgYBkA1hfwYhgQJz1N4CQE2c8
28gj4/YEMMY0a7YQuZ+7gaOhozS9ikdQPVtEldZqbUL64q0b1gUofy2gj3LvHUwJ
1t0xa4CzxBBixmYXrZVAd1JY5xpmx29utxaSjZAwfsc/ufpaTLkEvIfBRpQ4f598
6B5VMSTPc5l9Fnuub9DXVQ==
-----END PRIVATE KEY-----`,
  token_uri: 'https://oauth2.googleapis.com/token',
};

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

let cachedToken: { token: string; expires: number } | null = null;

/** Base64url encode a Uint8Array or string. */
function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Import PEM private key into CryptoKey for RS256 signing. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binaryStr = atob(pemBody);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** Create a signed JWT for the Google OAuth2 token exchange. */
async function createSignedJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: SERVICE_ACCOUNT.client_email,
    scope: SCOPES,
    aud: SERVICE_ACCOUNT.token_uri,
    iat: now,
    exp: now + 3600,
  }));

  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(SERVICE_ACCOUNT.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

/** Get a valid access token, using cache when possible. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires) {
    return cachedToken.token;
  }

  const jwt = await createSignedJwt();
  const res = await fetch(SERVICE_ACCOUNT.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expires: Date.now() + (data.expires_in - 60) * 1000, // refresh 60s early
  };
  return cachedToken.token;
}
