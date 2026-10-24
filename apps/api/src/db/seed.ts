import { v4 as uuid } from 'uuid';
import { pool, query } from './client.js';
import { hashPin } from '../auth/password.js';
import { normalizeWording, randomCode } from '../util/normalize.js';

async function seed() {
  console.log('Seeding Quizzical demo data...');

  await query(`DELETE FROM score_ledger`);
  await query(`DELETE FROM marks`);
  await query(`DELETE FROM submissions`);
  await query(`DELETE FROM wagers`);
  await query(`DELETE FROM team_devices`);
  await query(`DELETE FROM teams`);
  await query(`DELETE FROM event_snapshots`);
  await query(`DELETE FROM event_transitions`);
  await query(`DELETE FROM duplicate_candidates`);
  await query(`DELETE FROM question_history`);
  await query(`DELETE FROM questions`);
  await query(`DELETE FROM sections`);
  await query(`DELETE FROM events`);
  await query(`DELETE FROM series`);

  const { rows: seriesRows } = await query<{ id: string }>(
    `INSERT INTO series (name, description) VALUES ($1,$2) RETURNING id`,
    [
      'Thursday Night Trivia',
      'Recurring pub-style series for venue events',
    ],
  );
  const seriesId = seriesRows[0]!.id;

  const code = 'DEMO01';
  const wallboardToken = uuid();
  const { rows: eventRows } = await query<{ id: string }>(
    `INSERT INTO events (series_id, name, code, wallboard_token, state)
     VALUES ($1,$2,$3,$4,'ready') RETURNING id`,
    [seriesId, 'Demo Night', code, wallboardToken],
  );
  const eventId = eventRows[0]!.id;

  const sections = [
    { title: 'General Knowledge', theme: 'General Knowledge', difficulty: 'medium' },
    { title: 'Science', theme: 'Science', difficulty: 'medium' },
    { title: 'Pop Culture', theme: 'Pop Culture', difficulty: 'easy' },
  ];

  const sectionIds: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    const { rows } = await query<{ id: string }>(
      `INSERT INTO sections (event_id, title, theme, sort_order, question_count_target, difficulty)
       VALUES ($1,$2,$3,$4,3,$5) RETURNING id`,
      [eventId, s.title, s.theme, i, s.difficulty],
    );
    sectionIds.push(rows[0]!.id);
  }

  const questions = [
    {
      section: 0,
      format: 'multiple_choice',
      wording: 'What is the capital of France?',
      answerSpec: {
        format: 'multiple_choice',
        data: {
          options: [
            { id: 'a', label: 'Berlin' },
            { id: 'b', label: 'Paris' },
            { id: 'c', label: 'Madrid' },
            { id: 'd', label: 'Rome' },
          ],
          correctOptionIds: ['b'],
        },
      },
      rubric: 'Exact option b',
      points: 1,
    },
    {
      section: 0,
      format: 'short_answer',
      wording: 'How many continents are generally recognised?',
      answerSpec: {
        format: 'short_answer',
        data: { acceptedAnswers: ['7', 'seven'] },
      },
      rubric: 'Accept 7 or seven',
      points: 1,
    },
    {
      section: 0,
      format: 'ordered_list',
      wording: 'Order these planets from the Sun: Earth, Mercury, Venus',
      answerSpec: {
        format: 'ordered_list',
        data: {
          items: [
            { id: 'm', label: 'Mercury' },
            { id: 'v', label: 'Venus' },
            { id: 'e', label: 'Earth' },
          ],
          correctOrder: ['m', 'v', 'e'],
        },
      },
      rubric: 'Mercury, Venus, Earth',
      points: 1,
    },
    {
      section: 1,
      format: 'multiple_choice',
      wording: 'What particle has a negative charge?',
      answerSpec: {
        format: 'multiple_choice',
        data: {
          options: [
            { id: 'a', label: 'Proton' },
            { id: 'b', label: 'Neutron' },
            { id: 'c', label: 'Electron' },
            { id: 'd', label: 'Photon' },
          ],
          correctOptionIds: ['c'],
        },
      },
      rubric: 'Electron',
      points: 1,
    },
    {
      section: 1,
      format: 'short_answer',
      wording: 'What is H2O commonly known as?',
      answerSpec: {
        format: 'short_answer',
        data: { acceptedAnswers: ['water'] },
      },
      rubric: 'water',
      points: 1,
    },
    {
      section: 1,
      format: 'matching',
      wording: 'Match the scientist to their field',
      answerSpec: {
        format: 'matching',
        data: {
          left: [
            { id: 'l1', label: 'Newton' },
            { id: 'l2', label: 'Darwin' },
          ],
          right: [
            { id: 'r1', label: 'Gravity' },
            { id: 'r2', label: 'Evolution' },
          ],
          pairs: [
            { leftId: 'l1', rightId: 'r1' },
            { leftId: 'l2', rightId: 'r2' },
          ],
        },
      },
      rubric: 'Newton-Gravity, Darwin-Evolution',
      points: 2,
    },
    {
      section: 2,
      format: 'multiple_choice',
      wording: 'Which band released the album Abbey Road?',
      answerSpec: {
        format: 'multiple_choice',
        data: {
          options: [
            { id: 'a', label: 'The Beatles' },
            { id: 'b', label: 'The Rolling Stones' },
            { id: 'c', label: 'Queen' },
            { id: 'd', label: 'Pink Floyd' },
          ],
          correctOptionIds: ['a'],
        },
      },
      rubric: 'The Beatles',
      points: 1,
    },
    {
      section: 2,
      format: 'short_answer',
      wording: 'In which year was the first iPhone released?',
      answerSpec: {
        format: 'short_answer',
        data: { acceptedAnswers: ['2007'] },
      },
      rubric: '2007',
      points: 1,
    },
    {
      section: 2,
      format: 'multiple_choice',
      wording: 'Who directed the film Inception?',
      answerSpec: {
        format: 'multiple_choice',
        data: {
          options: [
            { id: 'a', label: 'Christopher Nolan' },
            { id: 'b', label: 'Steven Spielberg' },
            { id: 'c', label: 'James Cameron' },
            { id: 'd', label: 'Ridley Scott' },
          ],
          correctOptionIds: ['a'],
        },
      },
      rubric: 'Christopher Nolan',
      points: 1,
    },
  ];

  const qIds: { sectionId: string; questionId: string; content: unknown }[] =
    [];

  for (const q of questions) {
    const sectionId = sectionIds[q.section]!;
    const { rows } = await query<{ id: string }>(
      `INSERT INTO questions
       (series_id, section_id, format, wording, wording_normalized, answer_spec, rubric,
        difficulty, theme_tags, points, timing_seconds, status)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'medium',$8,$9,30,'approved')
       RETURNING id`,
      [
        seriesId,
        sectionId,
        q.format,
        q.wording,
        normalizeWording(q.wording),
        JSON.stringify(q.answerSpec),
        q.rubric,
        [sections[q.section]!.theme],
        q.points,
      ],
    );
    qIds.push({
      sectionId,
      questionId: rows[0]!.id,
      content: {
        id: rows[0]!.id,
        format: q.format,
        wording: q.wording,
        answerSpec: q.answerSpec,
        rubric: q.rubric,
        difficulty: 'medium',
        themeTags: [sections[q.section]!.theme],
        points: q.points,
        timingSeconds: 30,
        sourceReferences: [],
        sourcesVerified: false,
      },
    });
  }

  // Play snapshot + reserve (same content freeze Open lobby builds)
  let orderBySection = new Map<string, number>();
  for (const q of qIds) {
    const order = orderBySection.get(q.sectionId) ?? 0;
    orderBySection.set(q.sectionId, order + 1);
    await query(`UPDATE questions SET status = 'reserved' WHERE id = $1`, [
      q.questionId,
    ]);
    await query(
      `INSERT INTO event_snapshots (event_id, section_id, question_id, sort_order, content)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [eventId, q.sectionId, q.questionId, order, JSON.stringify(q.content)],
    );
    await query(
      `INSERT INTO question_history (series_id, question_id, reason, event_id, detail)
       VALUES ($1,$2,'reserved',$3,'Seed reservation')`,
      [seriesId, q.questionId, eventId],
    );
  }

  await query(`UPDATE events SET state = 'ready' WHERE id = $1`, [eventId]);

  const teamDefs = [
    {
      name: 'Red Pandas',
      pin: '1111',
      bonus: 0,
      avatar: 'red-panda',
      members: ['Alex', 'Sam', 'Jordan'],
    },
    {
      name: 'Blue Whales',
      pin: '2222',
      bonus: 1,
      avatar: 'blue-whale',
      members: ['Casey', 'Riley'],
    },
    {
      name: 'Green Lanterns',
      pin: '3333',
      bonus: 2,
      avatar: 'frog',
      members: ['Morgan', 'Quinn', 'Avery', 'Taylor'],
    },
  ];
  for (const t of teamDefs) {
    const pinHash = await hashPin(t.pin);
    await query(
      `INSERT INTO teams (event_id, name, pin_hash, pin, bonus_section_id, wagers_remaining, avatar_id, member_names)
       VALUES ($1,$2,$3,$4,$5,2,$6,$7)`,
      [eventId, t.name, pinHash, t.pin, sectionIds[t.bonus], t.avatar, t.members],
    );
  }

  console.log(`
Seed complete.
  Series: Thursday Night Trivia
  Event:  Demo Night
  Code:   ${code}
  Wallboard token: ${wallboardToken}
  Host password: (HOST_PASSWORD env, default changeme)

  Teams:
    Red Pandas / 1111 (bonus: General Knowledge)
    Blue Whales / 2222 (bonus: Science)
    Green Lanterns / 3333 (bonus: Pop Culture)
`);
  void randomCode;
  await pool.end();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
