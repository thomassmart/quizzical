import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('014_reveal_image migration', () => {
  it('adds reveal_image_id UUID FK to media_assets with partial index', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../migrations/014_reveal_image.sql'),
      'utf8',
    );
    expect(sql).toMatch(/reveal_image_id\s+UUID/i);
    expect(sql).toMatch(/REFERENCES\s+media_assets\s*\(\s*id\s*\)/i);
    expect(sql).toMatch(/ON DELETE SET NULL/i);
    expect(sql).toMatch(/idx_questions_reveal_image_id/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/i);
  });
});

describe('upload limits', () => {
  it('allows ~25 MB media with JSON body headroom for base64', () => {
    expect(config.maxUploadBytes).toBe(25 * 1024 * 1024);
    expect(config.bodyLimitBytes).toBeGreaterThan(config.maxUploadBytes);
    // 1.5 MB base64 of a ~1.1 MB binary must fit under the JSON limit
    const onePointFiveMbBase64 = Math.ceil(1.5 * 1024 * 1024);
    expect(config.bodyLimitBytes).toBeGreaterThan(onePointFiveMbBase64);
  });
});
