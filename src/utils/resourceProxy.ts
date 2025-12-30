import { getFeatureFlags } from '../config/featureFlags';

const DEFAULT_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24h to outlive cached HTML/SW

export function isResourceProxyEnabled(env: Env): boolean {
  const flags = getFeatureFlags(env);
  const explicitFlag = env.ENABLE_RESOURCE_PROXY === 'true' || (env as any).FEATURE_RESOURCE_PROXY === 'true';
  const hasSecret = !!env.RESOURCE_PROXY_SIGNING_SECRET;
  const enabled = hasSecret && (flags.useResourceProxy || explicitFlag);
  
  // Temporary debug logging
  console.log('[RESOURCE_PROXY] Debug:', {
    hasSecret,
    flagsUseResourceProxy: flags.useResourceProxy,
    explicitFlag,
    enabled
  });
  
  return enabled;
}

export async function generateResourceProxyToken(
  projectId: string,
  env: Env,
  expiresInSeconds: number = DEFAULT_TOKEN_TTL_SECONDS
): Promise<string> {
  const secret = env.RESOURCE_PROXY_SIGNING_SECRET;
  if (!secret) {
    throw new Error('RESOURCE_PROXY_SIGNING_SECRET is not configured');
  }

  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${projectId}:${exp}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const signature = bufferToBase64Url(new Uint8Array(signatureBuffer));

  return `${exp}.${signature}`;
}

export async function validateResourceProxyToken(
  token: string,
  projectId: string,
  env: Env
): Promise<boolean> {
  const secret = env.RESOURCE_PROXY_SIGNING_SECRET;
  if (!secret) return false;
  if (!token.includes('.')) return false;

  const [expPart, signaturePart] = token.split('.');
  const exp = Number(expPart);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;

  const encoder = new TextEncoder();
  const payload = `${projectId}:${exp}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );

  const providedSignature = base64UrlToBytes(signaturePart);
  return crypto.subtle.verify(
    'HMAC',
    key,
    providedSignature,
    encoder.encode(payload)
  );
}

export function injectResourceProxyScript(html: string, projectId: string, token: string): string {
  if (!html.includes('</head>')) {
    return html;
  }

  // Check if already injected to prevent double-injection
  if (html.includes('data-gpthost-proxy')) {
    return html;
  }

  const script = `
<script data-gpthost-proxy>
  (function() {
    if (!('serviceWorker' in navigator)) return;
    const swUrl = '/__gpthost__/resource-proxy.js?project_id=${projectId}&token=${encodeURIComponent(token)}';
    navigator.serviceWorker.register(swUrl, { scope: '/' }).catch(() => {});
  })();
</script>
`;

  return html.replace('</head>', `${script}\n</head>`);
}

export async function maybeInjectResourceProxy(
  html: string,
  projectId: string,
  env: Env
): Promise<string | null> {
  if (!isResourceProxyEnabled(env)) return null;
  const token = await generateResourceProxyToken(projectId, env);
  return injectResourceProxyScript(html, projectId, token);
}

function bufferToBase64Url(buffer: Uint8Array): string {
  const binary = String.fromCharCode(...buffer);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const decoded = atob(normalized + pad);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}
