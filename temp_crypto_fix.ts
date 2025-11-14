// Polyfill for Node.js environments (test environment)
if (typeof globalThis.crypto === 'undefined') {
  // @ts-ignore - Only used in test environment
  const nodeCrypto = await import('node:crypto');
  globalThis.crypto = nodeCrypto.webcrypto as Crypto;
}
