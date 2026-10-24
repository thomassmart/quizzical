import { describe, expect, it } from 'vitest';
import { decodeBase64Payload, MediaStoreError } from './mediaStore.js';

describe('decodeBase64Payload', () => {
  it('decodes raw base64', () => {
    const buf = decodeBase64Payload(Buffer.from('hello').toString('base64'));
    expect(buf.toString('utf8')).toBe('hello');
  });

  it('decodes data URLs', () => {
    const b64 = Buffer.from('png-bytes').toString('base64');
    const buf = decodeBase64Payload(`data:image/png;base64,${b64}`);
    expect(buf.toString('utf8')).toBe('png-bytes');
  });
});

describe('MediaStoreError', () => {
  it('defaults to 400', () => {
    const err = new MediaStoreError('bad');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('bad');
  });
});
