import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import type { Role } from '@quizzical/shared';

const secret = () => new TextEncoder().encode(config.jwtSecret);

export interface HostClaims {
  role: 'host';
  sub: 'host';
}

export interface TeamClaims {
  role: 'team';
  sub: string;
  eventId: string;
  teamId: string;
  deviceId: string;
}

export interface WallClaims {
  role: 'wallboard';
  sub: string;
  eventId: string;
}

export type TokenClaims = HostClaims | TeamClaims | WallClaims;

export async function signToken(
  claims: TokenClaims,
  expiresIn = '12h',
): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret());
}

export async function verifyToken(token: string): Promise<TokenClaims> {
  const { payload } = await jwtVerify(token, secret());
  const role = payload.role as Role;
  if (role === 'host') return { role: 'host', sub: 'host' };
  if (role === 'team') {
    return {
      role: 'team',
      sub: String(payload.sub),
      eventId: String(payload.eventId),
      teamId: String(payload.teamId),
      deviceId: String(payload.deviceId),
    };
  }
  if (role === 'wallboard') {
    return {
      role: 'wallboard',
      sub: String(payload.sub),
      eventId: String(payload.eventId),
    };
  }
  throw new Error('Unknown token role');
}
