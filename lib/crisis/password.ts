const encoder = new TextEncoder();
const ITERATIONS = 210000;
export function validCredentials(username: unknown, password: unknown): username is string {
  return typeof username === 'string' && /^[a-zA-Z0-9_]{3,32}$/.test(username) && typeof password === 'string' && password.length >= 10 && password.length <= 128 && encoder.encode(password).length <= 256;
}
export async function derivePassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:Uint8Array.from(salt).buffer,iterations:ITERATIONS}, key, 256);
  return Buffer.from(bits).toString('hex');
}
export async function makePassword(password: string) {
  const salt=crypto.getRandomValues(new Uint8Array(16));
  return { salt:Buffer.from(salt).toString('hex'), hash:await derivePassword(password,salt) };
}
export async function verifyPassword(password: string, saltHex: string, hashHex: string) {
  if (!/^[0-9a-f]{32}$/.test(saltHex) || !/^[0-9a-f]{64}$/.test(hashHex)) return false;
  const candidate=await derivePassword(password,Uint8Array.from(Buffer.from(saltHex,'hex')));
  const a=Uint8Array.from(Buffer.from(candidate,'hex')), b=Uint8Array.from(Buffer.from(hashHex,'hex'));
  let diff=0; for(let i=0;i<a.length;i++) diff|=a[i]^b[i]; return diff===0;
}
