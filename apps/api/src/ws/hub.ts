import type { WebSocket } from 'ws';
import type { TokenClaims } from '../auth/tokens.js';
import { verifyToken } from '../auth/tokens.js';
import {
  buildHostSnapshot,
  buildTeamSnapshot,
  buildWallboardSnapshot,
  setTeamConnected,
} from '../services/snapshots.js';
import { WsClientMessageSchema } from '@quizzical/shared';

interface Client {
  socket: WebSocket;
  claims: TokenClaims | null;
  eventId: string | null;
}

export class Hub {
  private clients = new Set<Client>();

  add(
    socket: WebSocket,
    opts?: { eventId?: string | null; token?: string | null },
  ) {
    const client: Client = {
      socket,
      claims: null,
      eventId: opts?.eventId ?? null,
    };
    this.clients.add(client);

    if (opts?.token) {
      void this.authenticate(client, opts.token);
    }

    socket.on('message', async (raw) => {
      try {
        const msg = WsClientMessageSchema.parse(JSON.parse(String(raw)));
        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        if (msg.type === 'auth') {
          await this.authenticate(client, msg.token);
        }
      } catch (e) {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: e instanceof Error ? e.message : 'WS error',
          }),
        );
      }
    });

    socket.on('close', () => {
      if (client.claims?.role === 'team') {
        setTeamConnected(client.claims.eventId, client.claims.teamId, false);
        this.broadcastEvent(client.claims.eventId);
      }
      this.clients.delete(client);
    });
  }

  private async authenticate(client: Client, token: string) {
    const claims = await verifyToken(token);
    client.claims = claims;
    if (claims.role === 'team' || claims.role === 'wallboard') {
      client.eventId = claims.eventId;
    }
    if (claims.role === 'team') {
      setTeamConnected(claims.eventId, claims.teamId, true);
    }
    await this.sendSnapshot(client);
  }

  async sendSnapshot(client: Client) {
    if (!client.claims) return;
    let payload;
    if (client.claims.role === 'host') {
      if (!client.eventId) {
        client.socket.send(
          JSON.stringify({
            type: 'error',
            message: 'Host must connect with ?eventId=',
          }),
        );
        return;
      }
      payload = await buildHostSnapshot(client.eventId);
    } else if (client.claims.role === 'team') {
      payload = await buildTeamSnapshot(client.claims);
    } else {
      payload = await buildWallboardSnapshot(client.claims.eventId);
    }
    client.socket.send(JSON.stringify({ type: 'snapshot', payload }));
  }

  bindHostEvent(socket: WebSocket, eventId: string) {
    for (const c of this.clients) {
      if (c.socket === socket) c.eventId = eventId;
    }
  }

  broadcastEvent(eventId: string) {
    for (const client of this.clients) {
      if (!client.claims) continue;
      const matches =
        client.eventId === eventId ||
        (client.claims.role === 'team' &&
          client.claims.eventId === eventId) ||
        (client.claims.role === 'wallboard' &&
          client.claims.eventId === eventId);
      if (matches) {
        void this.sendSnapshot(client).catch((err) => {
          console.error(
            'snapshot broadcast failed',
            client.claims?.role,
            client.eventId ?? client.claims?.eventId,
            err instanceof Error ? err.message : err,
          );
        });
      }
    }
  }
}

export const hub = new Hub();
