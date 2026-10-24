import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/client.js';

export type TopicImage = {
  url: string;
  thumb: string;
  alt: string;
  score: number;
};

export type StoredTopicImage = {
  mediaId: string;
  alt: string;
};

type OpenverseHit = {
  url?: string;
  thumbnail?: string;
  title?: string;
  tags?: { name?: string }[] | string[];
};

function normalizeThemeText(theme: string, title?: string | null): string {
  const pick =
    theme && title && theme.trim().toLowerCase() === title.trim().toLowerCase()
      ? theme
      : [theme, title].filter(Boolean).join(' ');
  return (pick || 'pub quiz')
    .replace(/\bpractice\b/gi, ' ')
    .replace(/\b&amp;\b/gi, ' ')
    .replace(/&/g, ' ')
    .replace(/[^\p{L}\p{N}\s/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Primary + alternate Openverse queries tuned for pub-trivia themes. */
export function topicSearchQueries(
  theme: string,
  title?: string | null,
): string[] {
  const text = normalizeThemeText(theme, title);
  const queries: string[] = [];
  const add = (...qs: string[]) => {
    for (const q of qs) {
      const t = q.replace(/\s+/g, ' ').trim();
      if (t && !queries.includes(t)) queries.push(t);
    }
  };

  const decade = text.match(/\b(1970s|1980s|1990s|2000s|70s|80s|90s)\b/)?.[0];
  const decadeFull = decade
    ?.replace('70s', '1970s')
    .replace('80s', '1980s')
    .replace('90s', '1990s');

  if (
    /\b(tv|television|soap|sitcom|drama)\b/.test(text) ||
    (/\bpop culture\b/.test(text) && decadeFull === '1980s')
  ) {
    if (decadeFull === '1980s' || /\b80s\b/.test(text)) {
      add(
        'Neighbours Australian television',
        'Countdown ABC music television Australia',
        'Australian Broadcasting Corporation television studio',
        'Home and Away television',
        'Australian television presenter 1980s',
        'Sony Trinitron television 1980s',
      );
    } else {
      add(
        'Australian television studio',
        'ABC television Australia',
        `${decadeFull ?? ''} Australian television`.trim(),
      );
    }
  }

  if (
    /\b(movie|film|cinema|hollywood|hollywood hits|hollywood night|hollywood quiz)\b/.test(text)
  ) {
    add(
      'cinema film projector reel',
      'Hollywood movie clapperboard',
      'classic film camera on set',
      'drive-in movie theatre Australia',
      'popcorn cinema snack',
      'red cinema seats theatre',
      'film festival red carpet lights',
      'vintage movie poster wall collage',
    );
  }

  if (
    /\b(music|disco|dance|song|band|rock|pop|icon|global pop)\b/.test(text)
  ) {
    if (decadeFull === '1980s' || /\bdisco|dance\b/.test(text)) {
      add(
        'vinyl record turntable 1980s',
        'Australian rock band concert',
        'disco dance floor lights',
        'INXS concert',
        'cassette tape 1980s music',
      );
    } else if (/\b(pop|icon|global)\b/.test(text)) {
      add(
        'vinyl records collection colourful',
        'concert stage lights crowd',
        'microphone stand stage music',
        'electric guitar music performance',
        'DJ headphones music studio',
        'festival crowd night lights',
        'karaoke microphone neon',
        'piano keys close up music',
      );
    } else {
      add(
        'Australian music concert stage',
        'vinyl records collection',
        `${decadeFull ?? 'Australian'} music festival`.trim(),
      );
    }
  }

  if (/\b(sport|cricket|nrl|afl|rugby|olympics|footy)\b/.test(text)) {
    add(
      'Australian cricket match MCG',
      'NRL rugby league match Australia',
      'AFL Australian football',
      'Sydney Olympic stadium sport',
    );
  }

  if (/\b(sydney|harbour|landmark|nsw|suburb)\b/.test(text)) {
    add(
      'Sydney Opera House',
      'Sydney Harbour Bridge',
      'Sydney ferry Circular Quay',
      'Bondi Beach Australia',
    );
  }

  if (/\b(beer|brewery|pub|wine|drink)\b/.test(text)) {
    add(
      'Australian beer tap pub',
      'brewery copper tanks',
      'Australian wine vineyard',
    );
  }

  if (/\b(food|cafe|bbq|restaurant|cooking)\b/.test(text)) {
    add(
      'Australian cafe brunch',
      'barbie barbecue Australia',
      'Australian bakery food',
    );
  }

  if (/\b(science|nature|wildlife|space)\b/.test(text)) {
    // Atmosphere only — never a single iconic animal (looks like a picture-round answer)
    add(
      'Australian outback landscape horizon',
      'science laboratory glassware abstract',
      'Australian night sky milky way stars',
      'coral reef underwater texture australia',
    );
  }

  if (/\b(icon|oddit|famous|legend)\b/.test(text)) {
    add(
      'Australian cultural icon',
      'Sydney Opera House sunset',
      'Uluru Australia',
      'Australian outback landscape',
    );
  }

  // Always include a cleaned primary query last (lower priority filler)
  const primary = text
    .replace(/\baussie\b/g, 'australian')
    .replace(/\b80s\b/g, '1980s')
    .replace(/\b90s\b/g, '1990s')
    .replace(/\b70s\b/g, '1970s')
    .replace(/\btv\b/g, 'television')
    .replace(/\bpop culture\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (primary) {
    add(
      /australia|sydney|nsw/.test(primary)
        ? primary
        : `${primary} australia`,
    );
  }

  if (!queries.length) {
    add('Sydney Australia landmarks', 'Australian pub trivia night');
  }

  return queries.slice(0, 8);
}

/** Keywords used to score whether a hit belongs to the theme. */
function relevanceKeywords(theme: string, title?: string | null): string[] {
  const text = normalizeThemeText(theme, title)
    .replace(/\baussie\b/g, 'australian')
    .replace(/\b80s\b/g, '1980s')
    .replace(/\b90s\b/g, '1990s')
    .replace(/\b70s\b/g, '1970s')
    .replace(/\btv\b/g, 'television');
  const base = text.split(' ').filter((w) => w.length > 2);
  const extra: string[] = ['australia', 'australian'];
  if (/\btelevision|tv\b/.test(text)) {
    extra.push(
      'television',
      'broadcast',
      'neighbours',
      'countdown',
      'studio',
      'presenter',
      'soap',
    );
  }
  if (/\bmusic|disco|dance|pop\b/.test(text)) {
    extra.push('music', 'vinyl', 'concert', 'band', 'disco', 'cassette', 'record');
  }
  if (/\bsydney|landmark\b/.test(text)) {
    extra.push('sydney', 'harbour', 'opera', 'bridge', 'bondi', 'ferry');
  }
  if (/\bsport|cricket|nrl|afl\b/.test(text)) {
    extra.push('cricket', 'rugby', 'football', 'sport', 'stadium', 'match');
  }
  if (/\b1980s|80s\b/.test(text)) {
    extra.push('1980s', '1980', '1981', '1982', '1983', '1984', '1985', '1986', '1987', '1988', '1989', '80s');
  }
  return [...new Set([...base, ...extra])];
}

function scoreHit(hit: OpenverseHit, keywords: string[]): number {
  const tagNames = (hit.tags ?? [])
    .map((t) => (typeof t === 'string' ? t : t.name || ''))
    .join(' ');
  const blob = `${hit.title ?? ''} ${tagNames}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (blob.includes(kw.toLowerCase())) score += kw.length > 5 ? 2 : 1;
  }
  // Penalise generic stock / unrelated memorial-style titles a little when score is weak
  if (
    score < 3 &&
    /\b(in memoriam|family|portrait|selfie|wedding|stock)\b/i.test(blob)
  ) {
    score -= 2;
  }
  return score;
}

async function searchOpenverseQuery(
  query: string,
  pageSize: number,
): Promise<OpenverseHit[]> {
  const url = new URL('https://api.openverse.org/v1/images/');
  url.searchParams.set('q', query);
  url.searchParams.set('page_size', String(pageSize));
  url.searchParams.set('mature', 'false');
  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'QuizzicalTrivia/1.0 (live pub quiz wallboard)',
    },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: OpenverseHit[] };
  return data.results ?? [];
}

const SUBJECT_STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'photo',
  'image',
  'picture',
  'wallpaper',
  'poster',
  'still',
  'shot',
  'film',
  'movie',
  'set',
  'scene',
  'official',
  'hd',
  '4k',
  'jpg',
  'png',
  'australia',
  'australian',
]);

/** Collapse near-identical Openverse titles into one subject bucket. */
export function subjectKeyFromTitle(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned
    .split(' ')
    .filter((w) => w.length > 2 && !SUBJECT_STOP.has(w));
  if (words.length >= 2) return words.slice(0, 3).join(' ');
  if (words.length === 1) return words[0]!;
  return cleaned.slice(0, 40) || 'unknown';
}

export function titleLooksLikeSpoiler(
  titleOrAlt: string,
  spoilerTerms: string[],
): boolean {
  if (!spoilerTerms.length) return false;
  const blob = ` ${titleOrAlt.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
  for (const term of spoilerTerms) {
    const t = term.toLowerCase().trim();
    if (t.length < 4) continue;
    if (blob.includes(` ${t} `) || blob.includes(t)) return true;
  }
  return false;
}

/** Extract answer/prompt tokens that must not appear in Get Ready mosaic titles. */
export function spoilerTermsFromQuestions(
  questions: {
    wording?: string | null;
    answer_spec?: unknown;
    media_alt?: string | null;
  }[],
): string[] {
  const terms = new Set<string>();
  const addPhrase = (raw: string) => {
    const s = raw.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    if (s.length >= 4 && s.length <= 48) terms.add(s);
    for (const w of s.split(/\s+/)) {
      if (w.length >= 5 && !SUBJECT_STOP.has(w)) terms.add(w);
    }
  };

  for (const q of questions) {
    if (q.media_alt) addPhrase(q.media_alt);
    const spec = q.answer_spec as {
      data?: {
        acceptedAnswers?: string[];
        options?: { label?: string }[];
        correctOptionIds?: string[];
        pairs?: { left?: string; right?: string }[];
        items?: string[];
      };
    } | null;
    const data = spec?.data;
    for (const a of data?.acceptedAnswers ?? []) addPhrase(String(a));
    for (const o of data?.options ?? []) {
      if (o.label) addPhrase(o.label);
    }
    for (const p of data?.pairs ?? []) {
      if (p.left) addPhrase(p.left);
      if (p.right) addPhrase(p.right);
    }
    for (const item of data?.items ?? []) addPhrase(String(item));
    // Significant proper-noun-ish tokens from the prompt (skip short fillers)
    if (q.wording) {
      for (const w of q.wording.split(/\s+/)) {
        const clean = w.replace(/[^\p{L}\p{N}]/gu, '');
        if (clean.length >= 6 && /^[\p{Lu}]/u.test(w)) addPhrase(clean);
      }
    }
  }
  return [...terms];
}

type RankedHit = TopicImage & { subject: string; sourceQuery: string };

/**
 * Diversify ranked hits: at most `perSubject` from the same subject key,
 * and at most `perQuery` retained from each source query before interleaving.
 */
export function diversifyTopicHits(
  hits: RankedHit[],
  count: number,
  opts?: { perSubject?: number; perQuery?: number },
): TopicImage[] {
  const perSubject = opts?.perSubject ?? 2;
  const perQuery = opts?.perQuery ?? 3;
  const subjectCounts = new Map<string, number>();
  const queryCounts = new Map<string, number>();
  const seenTitles = new Set<string>();
  const out: TopicImage[] = [];

  const sorted = [...hits].sort((a, b) => b.score - a.score);
  for (const hit of sorted) {
    if (out.length >= count) break;
    const titleKey = hit.alt.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenTitles.has(titleKey)) continue;
    // Near-duplicate: same subject words in different order already capped
    const sc = subjectCounts.get(hit.subject) ?? 0;
    if (sc >= perSubject) continue;
    const qc = queryCounts.get(hit.sourceQuery) ?? 0;
    if (qc >= perQuery) continue;
    subjectCounts.set(hit.subject, sc + 1);
    queryCounts.set(hit.sourceQuery, qc + 1);
    seenTitles.add(titleKey);
    out.push({
      url: hit.url,
      thumb: hit.thumb,
      alt: hit.alt,
      score: hit.score,
    });
  }
  return out;
}

async function spoilerTermsForSection(
  sectionId: string | undefined,
): Promise<string[]> {
  if (!sectionId) return [];
  try {
    const { rows } = await query<{
      wording: string;
      answer_spec: unknown;
      media_alt: string | null;
    }>(
      `SELECT q.wording, q.answer_spec,
         COALESCE(mi.filename, '') AS media_alt
       FROM questions q
       LEFT JOIN media_assets mi ON mi.id = q.media_image_id
       WHERE q.section_id = $1
         AND q.status NOT IN ('dismissed')`,
      [sectionId],
    );
    return spoilerTermsFromQuestions(rows);
  } catch {
    return [];
  }
}

/** Public search helper — used by question ambience media too. */
export async function searchOpenverse(
  theme: string,
  title: string | null | undefined,
  count: number,
  opts?: { sectionId?: string; spoilerTerms?: string[] },
): Promise<TopicImage[]> {
  const queries = topicSearchQueries(theme, title);
  const keywords = relevanceKeywords(theme, title);
  const spoilers =
    opts?.spoilerTerms ?? (await spoilerTermsForSection(opts?.sectionId));
  const byUrl = new Map<string, RankedHit>();

  // Pull fewer per query so one viral subject cannot dominate the mosaic.
  for (const q of queries) {
    const hits = await searchOpenverseQuery(q, 10);
    let keptFromQuery = 0;
    for (const hit of hits) {
      if (keptFromQuery >= 4) break;
      const src = hit.thumbnail || hit.url;
      if (!src || byUrl.has(src)) continue;
      const alt = (hit.title || theme || 'Topic').slice(0, 120);
      if (titleLooksLikeSpoiler(alt, spoilers)) continue;
      const score = scoreHit(hit, keywords);
      byUrl.set(src, {
        url: hit.url || src,
        thumb: src,
        alt,
        score,
        subject: subjectKeyFromTitle(alt),
        sourceQuery: q,
      });
      keptFromQuery += 1;
    }
  }

  let picked = diversifyTopicHits([...byUrl.values()], count);

  // Last-chance Openverse pass with broad Australia/trivia queries
  if (picked.length < Math.min(4, count)) {
    for (const q of [
      'Australia landmarks',
      'Sydney Harbour',
      'Australian landscape horizon',
      'pub quiz trivia night',
    ]) {
      const hits = await searchOpenverseQuery(q, 8);
      for (const hit of hits) {
        const src = hit.thumbnail || hit.url;
        if (!src || byUrl.has(src)) continue;
        const alt = (hit.title || theme || 'Topic').slice(0, 120);
        if (titleLooksLikeSpoiler(alt, spoilers)) continue;
        byUrl.set(src, {
          url: hit.url || src,
          thumb: src,
          alt,
          score: 1,
          subject: subjectKeyFromTitle(alt),
          sourceQuery: q,
        });
      }
    }
    picked = diversifyTopicHits([...byUrl.values()], count);
  }

  return picked;
}

function mimeExt(mime: string): string {
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  return '.jpg';
}

/**
 * Fetch topic images for a section, download into local media storage,
 * and persist references on the section row.
 */
export async function storeTopicImagesForSection(
  sectionId: string,
  theme: string,
  title?: string | null,
  count = 12,
): Promise<StoredTopicImage[]> {
  let remote: TopicImage[] = [];
  try {
    remote = await searchOpenverse(theme, title, count, {
      sectionId,
    });
  } catch {
    remote = [];
  }

  const dirRel = path.join('topic', sectionId);
  const dirAbs = path.join(config.mediaDir, dirRel);
  await fs.mkdir(dirAbs, { recursive: true });

  try {
    const prev = await fs.readdir(dirAbs);
    await Promise.all(
      prev.map((f) => fs.unlink(path.join(dirAbs, f)).catch(() => undefined)),
    );
  } catch {
    /* empty */
  }

  const stored: StoredTopicImage[] = [];
  for (const img of remote) {
    try {
      const src = img.thumb || img.url;
      const res = await fetch(src, {
        headers: { 'User-Agent': 'QuizzicalTrivia/1.0' },
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500 || buf.length > 8 * 1024 * 1024) continue;
      const mime = (res.headers.get('content-type') || 'image/jpeg')
        .split(';')[0]!
        .trim();
      if (!mime.startsWith('image/')) continue;
      const id = randomUUID();
      const ext = mimeExt(mime);
      const storageName = path.join(dirRel, `${id}${ext}`);
      await fs.writeFile(path.join(config.mediaDir, storageName), buf);
      await query(
        `INSERT INTO media_assets (id, filename, mime_type, size_bytes, storage_path)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, `${theme.slice(0, 40)}${ext}`, mime, buf.length, storageName],
      );
      stored.push({ mediaId: id, alt: img.alt });
    } catch {
      /* skip failed download */
    }
  }

  // When Openverse yields nothing useful, synthesise a colourful mosaic
  if (stored.length === 0) {
    const fallbacks = await writeFallbackTopicImages(
      dirRel,
      theme || title || 'Trivia',
      Math.min(count, 8),
    );
    stored.push(...fallbacks);
  }

  await query(`UPDATE sections SET topic_images = $1::jsonb WHERE id = $2`, [
    JSON.stringify(stored),
    sectionId,
  ]);
  return stored;
}

/** Geometric SVG tiles so Get Ready never shows an empty mosaic. */
async function writeFallbackTopicImages(
  dirRel: string,
  label: string,
  count: number,
): Promise<StoredTopicImage[]> {
  const palettes = [
    ['#0d9488', '#134e4a', '#99f6e4'],
    ['#e11d48', '#881337', '#fecdd3'],
    ['#0369a1', '#0c4a6e', '#bae6fd'],
    ['#a16207', '#713f12', '#fde68a'],
    ['#7c3aed', '#4c1d95', '#ddd6fe'],
    ['#15803d', '#14532d', '#bbf7d0'],
    ['#c2410c', '#7c2d12', '#fed7aa'],
    ['#334155', '#0f172a', '#cbd5e1'],
  ];
  const out: StoredTopicImage[] = [];
  for (let i = 0; i < count; i++) {
    const [a, b, c] = palettes[i % palettes.length]!;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${a}"/>
      <stop offset="100%" stop-color="${b}"/>
    </linearGradient>
  </defs>
  <rect width="320" height="240" fill="url(#g)"/>
  <circle cx="${80 + (i % 3) * 40}" cy="${70 + (i % 2) * 30}" r="${50 + i * 3}" fill="${c}" opacity="0.35"/>
  <circle cx="${220 - (i % 4) * 20}" cy="${160}" r="${40 + i * 2}" fill="${c}" opacity="0.25"/>
  <text x="160" y="128" text-anchor="middle" fill="#fff" font-family="Georgia, serif" font-size="22" opacity="0.9">${escapeXml(label.slice(0, 28))}</text>
</svg>`;
    const id = randomUUID();
    const storageName = path.join(dirRel, `${id}.svg`);
    const buf = Buffer.from(svg, 'utf8');
    await fs.writeFile(path.join(config.mediaDir, storageName), buf);
    await query(
      `INSERT INTO media_assets (id, filename, mime_type, size_bytes, storage_path)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, `fallback-${i}.svg`, 'image/svg+xml', buf.length, storageName],
    );
    out.push({ mediaId: id, alt: label });
  }
  return out;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function topicImageUrls(
  stored: StoredTopicImage[] | null | undefined,
): string[] {
  if (!stored?.length) return [];
  // Root-relative so phones/wall hit the same host that served the page
  return stored.map((s) => `/media/${s.mediaId}`);
}

export async function getSectionTopicImages(
  sectionId: string,
): Promise<StoredTopicImage[]> {
  const { rows } = await query<{ topic_images: StoredTopicImage[] | null }>(
    `SELECT topic_images FROM sections WHERE id = $1`,
    [sectionId],
  );
  if (!rows[0]) return [];
  return Array.isArray(rows[0].topic_images) ? rows[0].topic_images : [];
}

/** Replace the full Get Ready mosaic for a section. */
export async function setSectionTopicImages(
  sectionId: string,
  images: StoredTopicImage[],
): Promise<StoredTopicImage[]> {
  const cleaned = images
    .filter((img) => Boolean(img?.mediaId))
    .map((img) => ({
      mediaId: img.mediaId,
      alt: img.alt?.trim() || '',
    }));
  const { rows } = await query<{ id: string }>(
    `UPDATE sections SET topic_images = $1::jsonb WHERE id = $2 RETURNING id`,
    [JSON.stringify(cleaned), sectionId],
  );
  if (!rows[0]) throw new Error('Section not found');
  return cleaned;
}

/** Replace one mosaic slot (0-based). Extends the array if needed. */
export async function replaceSectionTopicImageAt(
  sectionId: string,
  index: number,
  image: StoredTopicImage,
): Promise<StoredTopicImage[]> {
  if (index < 0 || index > 20) throw new Error('Index out of range');
  const current = await getSectionTopicImages(sectionId);
  const next = [...current];
  while (next.length <= index) next.push({ mediaId: image.mediaId, alt: '' });
  next[index] = {
    mediaId: image.mediaId,
    alt: image.alt?.trim() || next[index]?.alt || '',
  };
  return setSectionTopicImages(sectionId, next);
}

export async function removeSectionTopicImageAt(
  sectionId: string,
  index: number,
): Promise<StoredTopicImage[]> {
  const current = await getSectionTopicImages(sectionId);
  if (index < 0 || index >= current.length) {
    throw new Error('Index out of range');
  }
  const next = current.filter((_, i) => i !== index);
  return setSectionTopicImages(sectionId, next);
}

export async function ensureSectionTopicImages(
  sectionId: string,
  opts?: { force?: boolean },
): Promise<StoredTopicImage[]> {
  const { rows } = await query<{
    title: string;
    theme: string | null;
    topic_images: StoredTopicImage[] | null;
  }>(`SELECT title, theme, topic_images FROM sections WHERE id = $1`, [
    sectionId,
  ]);
  const sec = rows[0];
  if (!sec) return [];
  const existing = Array.isArray(sec.topic_images) ? sec.topic_images : [];
  if (existing.length > 0 && !opts?.force) return existing;
  return storeTopicImagesForSection(
    sectionId,
    sec.theme || sec.title,
    sec.title,
  );
}

/** @deprecated use topicSearchQueries */
export function topicSearchQuery(theme: string, title?: string | null): string {
  return topicSearchQueries(theme, title)[0] ?? 'australia';
}
