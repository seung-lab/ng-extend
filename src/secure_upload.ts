import { functionUrl } from './functions_base';
export async function secureUpload(blob: Blob, kind: 'help' | 'notifications' | 'badges'): Promise<string> {
  // Notification and badge images 3 MB, player screenshots 8 MB (as the server).
  const maxMB = kind === 'help' ? 8 : 3;
  if (blob.size > maxMB * 1024 * 1024) throw new Error(`Images must be under ${maxMB} MB.`);
  let token: string | null = null;
  try { token = JSON.parse(localStorage.getItem('auth_token_v2_https://global.daf-apis.com/sticky_auth') || '{}').accessToken || null; } catch { /* no login */ }
  if (!token) throw new Error('Sign in to upload an image.');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(blob);
  });
  const response = await fetch(functionUrl('ewSecureUpload'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ token, kind, contentType: blob.type, data }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Image upload failed.');
  return result.url;
}
