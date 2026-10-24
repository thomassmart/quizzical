import bcrypt from 'bcryptjs';
import { config } from '../config.js';

/** Verify host password. Never log the password. */
export function verifyHostPassword(password: string): boolean {
  return timingSafeEqualString(password, config.hostPassword);
}

function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    const dummy = Buffer.alloc(bufA.length);
    Buffer.compare(bufA, dummy);
    return false;
  }
  return Buffer.compare(bufA, bufB) === 0;
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
