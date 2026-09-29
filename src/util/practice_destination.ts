// Tutorial credentials may reach only reviewed sandbox destinations.
const SANDBOX_TABLES: Readonly<Record<string, readonly string[]>> = {
  // pinky_training6 is the intro tutorial's sandbox (Tutorial 1); the app
  // only reads roots there, to follow its neuron after an edit.
  'https://minnie.microns-daf.com': ['pinky_nf_v2', 'pinky_training6'],
  'https://prodv1.flywire-daf.com': ['fly_v26'],
};

export function practiceBase(server: string, table: string): string {
  const url = new URL(server);
  if (url.username || url.password || url.search || url.hash ||
      (url.pathname !== '/' && url.pathname !== '') ||
      !SANDBOX_TABLES[url.origin]?.includes(table)) {
    throw new Error('This tutorial destination is not an approved sandbox.');
  }
  return `${url.origin}/segmentation/api/v1/table/${table}`;
}

/** The global sticky-auth realm is an explicit CAVE credential issuer. */
export function practiceToken(storage: Storage, server: string): string | null {
  const origin = new URL(server).origin;
  if (!SANDBOX_TABLES[origin]) throw new Error('Untrusted tutorial server.');
  for (const realm of [`${origin}/sticky_auth`, 'https://global.daf-apis.com/sticky_auth']) {
    try {
      const value = JSON.parse(storage.getItem(`auth_token_v2_${realm}`) || '{}');
      if (typeof value.accessToken === 'string' && value.accessToken) return value.accessToken;
    } catch { /* Ignore malformed storage, never try an unrelated realm. */ }
  }
  return null;
}
