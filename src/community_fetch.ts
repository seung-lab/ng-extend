// Preserve Supabase's response contract while protecting private reads and writes.
const ENDPOINT = 'https://us-central1-ytho-4bff2.cloudfunctions.net/ewCommunityData';
const PROTECTED = new Set(['users', 'admins', 'notifications', 'notification_reads', 'working_links', 'feedback_triage', 'site_issues', 'user_groups', 'user_group_members', 'chat_messages']);
const nativeFetch = window.fetch.bind(window);

export const communityFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
  if (url.origin !== 'https://javthknksdcrlhiaaptj.supabase.co' || !table || !PROTECTED.has(table)) return nativeFetch(request);
  let token: string | null = null;
  try { token = JSON.parse(localStorage.getItem('auth_token_v2_https://global.daf-apis.com/sticky_auth') || '{}').accessToken || null; } catch { /* anonymous read */ }
  const text = ['GET', 'HEAD'].includes(request.method) ? '' : await request.text();
  const response = await nativeFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'error',
    signal: request.signal,
    body: JSON.stringify({ table, method: request.method, query: url.search.slice(1), token,
      body: text ? JSON.parse(text) : undefined,
      accept: request.headers.get('accept'), prefer: request.headers.get('prefer'),
      range: request.headers.get('range'),
    }),
  });
  const envelope = await response.json();
  if (!response.ok) return new Response(JSON.stringify(envelope), { status: response.status, headers: { 'Content-Type': 'application/json' } });
  return new Response(request.method === 'HEAD' || envelope.status === 204 ? null : envelope.body, { status: envelope.status, headers: envelope.headers });
};
