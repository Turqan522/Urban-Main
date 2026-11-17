const encoder = new TextEncoder();
// Cloudflare Workers limits a single WebCrypto PBKDF2 call to 100,000 iterations.
// Legacy unprefixed hashes used 210,000 iterations and must not be mistaken for the new format.
const CURRENT_ITERATIONS = 100000, LEGACY_ITERATIONS = 210000;
const PREFIX = 'pbkdf2-sha256-100000$';
export class LegacyPasswordUnsupported extends Error {
  constructor() { super('Legacy password hash cannot be verified on this runtime'); }
}
export function validEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
export function validCredentials(username: unknown, password: unknown): username is string {
  const legacy = typeof username === 'string' && /^[a-zA-Z0-9_]{3,32}$/.test(username.trim());
  return (legacy || validEmail(username)) && typeof password === 'string' && password.length > 0 && encoder.encode(password).length <= 1024;
}
export async function derivePassword(password: string, salt: Uint8Array, iterations = CURRENT_ITERATIONS, subtle: SubtleCrypto = crypto.subtle): Promise<string> {
  const key = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:Uint8Array.from(salt).buffer,iterations}, key, 256);
  return Buffer.from(bits).toString('hex');
}
export async function makePassword(password: string, subtle: SubtleCrypto = crypto.subtle) {
  const salt=crypto.getRandomValues(new Uint8Array(16));
  return { salt:Buffer.from(salt).toString('hex'), hash:PREFIX+await derivePassword(password,salt,CURRENT_ITERATIONS,subtle) };
}
export async function verifyPassword(password: string, saltHex: string, storedHash: string, subtle: SubtleCrypto = crypto.subtle) {
  const legacy = /^[0-9a-f]{64}$/.test(storedHash);
  const hashHex = legacy ? storedHash : storedHash.startsWith(PREFIX) ? storedHash.slice(PREFIX.length) : '';
  if (!/^[0-9a-f]{32}$/.test(saltHex) || !/^[0-9a-f]{64}$/.test(hashHex)) return false;
  let candidate: string;
  try { candidate=await derivePassword(password,Uint8Array.from(Buffer.from(saltHex,'hex')),legacy ? LEGACY_ITERATIONS : CURRENT_ITERATIONS, subtle); }
  catch (error) {
    if (legacy && error instanceof Error && error.name === 'NotSupportedError') throw new LegacyPasswordUnsupported();
    throw error;
  }
  const a=Uint8Array.from(Buffer.from(candidate,'hex')), b=Uint8Array.from(Buffer.from(hashHex,'hex'));
  let diff=0; for(let i=0;i<a.length;i++) diff|=a[i]^b[i]; return diff===0;
}
