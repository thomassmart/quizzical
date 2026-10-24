import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AVATAR_IDS, parseAvatarId } from '@quizzical/shared';
import { verifyHostPassword, hashPin, verifyPin } from '../auth/password.js';
import { signToken } from '../auth/tokens.js';
import { query } from '../db/client.js';
import { randomPin } from '../util/normalize.js';
import { normalizeMemberNames } from '../util/members.js';
import { v4 as uuid } from 'uuid';

const AvatarIdSchema = z.enum(AVATAR_IDS);

/** True when no other team on the event already uses this avatar. */
async function isAvatarAvailable(
  eventId: string,
  avatarId: string,
  exceptTeamId?: string,
): Promise<boolean> {
  const { rows } = exceptTeamId
    ? await query<{ id: string }>(
        `SELECT id FROM teams
         WHERE event_id = $1 AND avatar_id = $2 AND id <> $3
         LIMIT 1`,
        [eventId, avatarId, exceptTeamId],
      )
    : await query<{ id: string }>(
        `SELECT id FROM teams
         WHERE event_id = $1 AND avatar_id = $2
         LIMIT 1`,
        [eventId, avatarId],
      );
  return rows.length === 0;
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/host/login', async (req, reply) => {
    const body = z.object({ password: z.string() }).parse(req.body);
    if (!verifyHostPassword(body.password)) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const token = await signToken({ role: 'host', sub: 'host' });
    return { token };
  });

  app.get('/api/events/by-code/:code', async (req) => {
    const { code } = req.params as { code: string };
    const { rows } = await query<{
      id: string;
      name: string;
      code: string;
      state: string;
      nominations_locked: boolean;
    }>(
      `SELECT id, name, code, state, nominations_locked FROM events WHERE code = $1`,
      [code.toUpperCase()],
    );
    if (!rows[0]) return { error: 'Not found' };
    const { rows: teams } = await query<{
      id: string;
      name: string;
      avatar_id: string;
    }>(
      `SELECT id, name, avatar_id FROM teams WHERE event_id = $1 ORDER BY name`,
      [rows[0].id],
    );
    const { rows: sections } = await query<{ id: string; title: string }>(
      `SELECT id, title FROM sections
       WHERE event_id = $1 AND COALESCE(is_demo, false) = false
       ORDER BY sort_order`,
      [rows[0].id],
    );
    return {
      event: rows[0],
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        avatarId: parseAvatarId(t.avatar_id),
      })),
      sections,
      // never return PINs
    };
  });

  app.post('/api/auth/team/join', async (req, reply) => {
    const body = z
      .object({
        eventCode: z.string(),
        teamName: z.string().min(1).max(40),
        pin: z.string().min(4).max(8).optional(),
        create: z.boolean().optional(),
        deviceId: z.string().optional(),
        bonusSectionId: z.string().uuid().nullable().optional(),
        avatarId: AvatarIdSchema.optional(),
        /** Who is playing — names, one per entry */
        members: z.array(z.string()).max(20).optional(),
      })
      .parse(req.body);

    const { rows: events } = await query<{
      id: string;
      state: string;
      nominations_locked: boolean;
    }>(`SELECT id, state, nominations_locked FROM events WHERE code = $1`, [
      body.eventCode.toUpperCase(),
    ]);
    const event = events[0];
    if (!event) return reply.code(404).send({ error: 'Event not found' });

    const members = normalizeMemberNames(body.members);
    const deviceId = body.deviceId ?? uuid();
    let teamId: string;
    let pinToReturn: string | undefined;

    if (body.create) {
      if (members.length < 1) {
        return reply
          .code(400)
          .send({ error: 'Add at least one team member name' });
      }
      const pin = body.pin ?? randomPin();
      const pinHash = await hashPin(pin);
      const avatarId = body.avatarId ?? parseAvatarId(undefined);
      if (!(await isAvatarAvailable(event.id, avatarId))) {
        return reply.code(409).send({ error: 'Avatar already taken' });
      }
      try {
        const { rows } = await query<{ id: string }>(
          `INSERT INTO teams (event_id, name, pin_hash, pin, bonus_section_id, active_device_id, avatar_id, member_names)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            event.id,
            body.teamName.trim(),
            pinHash,
            pin,
            body.bonusSectionId ?? null,
            deviceId,
            avatarId,
            members,
          ],
        );
        teamId = rows[0]!.id;
        pinToReturn = pin;
      } catch {
        return reply.code(409).send({ error: 'Team name already taken' });
      }
    } else {
      const { rows } = await query<{
        id: string;
        pin_hash: string;
        active_device_id: string | null;
      }>(
        `SELECT id, pin_hash, active_device_id FROM teams WHERE event_id = $1 AND name = $2`,
        [event.id, body.teamName.trim()],
      );
      const team = rows[0];
      if (!team || !body.pin || !(await verifyPin(body.pin, team.pin_hash))) {
        return reply.code(401).send({ error: 'Invalid team or PIN' });
      }
      teamId = team.id;
      await query(`UPDATE teams SET active_device_id = $1 WHERE id = $2`, [
        deviceId,
        teamId,
      ]);
      if (team.active_device_id && team.active_device_id !== deviceId) {
        await query(
          `UPDATE team_devices SET revoked = true WHERE team_id = $1 AND device_id = $2`,
          [teamId, team.active_device_id],
        );
      }
      // Allow avatar / roster updates on rejoin while nominations are still open
      if (!event.nominations_locked) {
        if (body.avatarId) {
          if (!(await isAvatarAvailable(event.id, body.avatarId, teamId))) {
            return reply.code(409).send({ error: 'Avatar already taken' });
          }
          await query(`UPDATE teams SET avatar_id = $1 WHERE id = $2`, [
            body.avatarId,
            teamId,
          ]);
        }
        if (members.length >= 1) {
          await query(`UPDATE teams SET member_names = $1 WHERE id = $2`, [
            members,
            teamId,
          ]);
        }
      }
    }

    await query(
      `INSERT INTO team_devices (team_id, device_id) VALUES ($1,$2)
       ON CONFLICT (team_id, device_id) DO UPDATE SET revoked = false, last_seen_at = now()`,
      [teamId, deviceId],
    );

    if (
      body.bonusSectionId &&
      !event.nominations_locked &&
      ['lobby', 'ready', 'draft'].includes(event.state)
    ) {
      await query(`UPDATE teams SET bonus_section_id = $1 WHERE id = $2`, [
        body.bonusSectionId,
        teamId,
      ]);
    }

    const token = await signToken({
      role: 'team',
      sub: teamId,
      eventId: event.id,
      teamId,
      deviceId,
    });

    return {
      token,
      deviceId,
      teamId,
      eventId: event.id,
      pin: pinToReturn,
    };
  });

  app.post('/api/auth/wallboard', async (req, reply) => {
    const body = z
      .object({ eventCode: z.string(), wallboardToken: z.string() })
      .parse(req.body);
    const { rows } = await query<{ id: string; wallboard_token: string }>(
      `SELECT id, wallboard_token FROM events WHERE code = $1`,
      [body.eventCode.toUpperCase()],
    );
    if (!rows[0] || rows[0].wallboard_token !== body.wallboardToken) {
      return reply.code(401).send({ error: 'Invalid wallboard credentials' });
    }
    const token = await signToken({
      role: 'wallboard',
      sub: rows[0].id,
      eventId: rows[0].id,
    });
    return { token, eventId: rows[0].id };
  });
}
