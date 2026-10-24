import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/client.js';

export type StoredMedia = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  url: string;
};

function mimeExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/webm': '.webm',
    'audio/mp4': '.m4a',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
  };
  return map[mime] ?? '';
}

export class MediaStoreError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'MediaStoreError';
  }
}

/** Persist a host media asset from an in-memory buffer (multipart or base64). */
export async function storeMediaAsset(input: {
  filename: string;
  mimeType: string;
  data: Buffer;
}): Promise<StoredMedia> {
  await fs.mkdir(config.mediaDir, { recursive: true });

  if (!config.allowedMime.has(input.mimeType)) {
    throw new MediaStoreError(`Unsupported type: ${input.mimeType}`);
  }
  if (input.data.length > config.maxUploadBytes) {
    throw new MediaStoreError(
      `File too large (max ${Math.round(config.maxUploadBytes / (1024 * 1024))}MB)`,
    );
  }
  if (!input.data.length) {
    throw new MediaStoreError('Empty file');
  }

  const id = randomUUID();
  const ext = path.extname(input.filename) || mimeExt(input.mimeType);
  const storageName = `${id}${ext}`;
  const storagePath = path.join(config.mediaDir, storageName);
  await fs.writeFile(storagePath, input.data);

  const { rows } = await query<{
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
  }>(
    `INSERT INTO media_assets (id, filename, mime_type, size_bytes, storage_path)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, filename, mime_type, size_bytes`,
    [id, input.filename, input.mimeType, input.data.length, storageName],
  );
  const row = rows[0]!;
  return {
    id: row.id,
    filename: row.filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    url: `/media/${row.id}`,
  };
}

/** Decode a base64 or data-URL payload to a Buffer. */
export function decodeBase64Payload(base64: string): Buffer {
  const trimmed = base64.trim();
  const dataUrl = /^data:[^;]+;base64,(.+)$/i.exec(trimmed);
  const raw = dataUrl ? dataUrl[1]! : trimmed;
  try {
    return Buffer.from(raw, 'base64');
  } catch {
    throw new MediaStoreError('Invalid base64 payload');
  }
}
