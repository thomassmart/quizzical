# Host operating guide

## Before the night

1. Sign in at `/host/login`.
2. Open the series → event.
3. Build sections; create questions manually or **LLM propose** (each proposal needs Approve or Dismiss). Manual/import saves auto-approve; LLM proposes still need review.
4. **Prompt media** — upload a picture/video/audio when it belongs on the **question** (“what is this?”). Text questions stay picture-free unless you add one.
5. **Answer sheet image** — optional image shown **only when revealing answers** (not during the question). Attach in the question editor or via MCP (`revealImageId` / slot `reveal_image`).
6. **Section photos** — optional Get Ready mosaic per section (host UI or MCP). Empty sections still show coloured placeholder tiles.
7. **Import / Download JSON** — pack questions between events from Prep.
8. Open wallboard from Prep (**Preview wall**) or Live (**Open wall**): `/wall/<CODE>?token=<wallboard_token>` (fullscreen on the venue TV).
9. Share join code / QR with teams (QR uses `WEB_ORIGIN` — set that to the LAN hostname phones can reach).
10. In **Live**, **Open lobby** freezes approved questions for play automatically (no separate lock step). If you change answer-sheet images after freezing, **Restart** or **Reset** (or open lobby again) so the play snapshot picks them up.

## Prep actions (blast radius)

| Action | Keeps teams? | Lands in | Notes |
|--------|--------------|----------|--------|
| **Test** | Yes (if mid-night, restarts first) | Practice | Solo check of wall/audio; confirm before running |
| **Restart** | Yes | Lobby | Clears scores/progress |
| **Reset** | No | Prep (`ready`) | Clears teams + scores; keeps questions/media |
| **Abandon** | — | Abandoned | Ends the night early; return to Prep |

## Live flow

1. **Lobby** — teams join, pick avatar + bonus section, set PIN.
2. **Start game** — locks bonus nominations; wall shows **rules & scoring**.
3. **Start practice** (recommended first night) — short demo: MC, typed answer, picture ID, ordered list, matching. Scores do **not** count toward the night.  
   Or **Skip practice** — jump straight to the first real section.
4. **Begin the night** (after practice) — real sections. For each question: **Reveal** → **Open answers** → (optional Pause / +15s) → auto-close or **Close**.  
   Sections with **auto-open answers** open the window a few seconds after reveal (Live still shows **Open answers now**).
5. End of section: **Mark section** — builds the marking queue (does not finalise scores yet).
6. **Review the queue** — accept/override short answers, apply LLM suggestions, set partial credit. Use **+1 / −1** on private totals when needed.
7. **Approve & reveal answers** — writes the ledger, then shows answers one by one on the wall (correct answer, optional **answer sheet image**, reveal fact, Quickest) → **Show scores** → **Next section** or finish.

## Device replacement

If a captain’s phone dies: Live → team row → **Replace device**. Previous device loses submission authority; they rejoin with the team PIN (and can update avatar while nominations are unlocked).

## Scoring reminders

- Ordinary first-correct gets +1 speed after marking (shown as **Quickest** on the wall).
- Bonus section doubles correct points; incorrect −1.
- Wagers (max 2): not in bonus section; irreversible once acknowledged.
- Corrections: use **+1 / −1** adjust with a reason (ledger keeps answer/speed/bonus/wager/adjustment separate).

## If LLM is down

Continue manually. Structured answers still auto-mark; typed answers need host marks. Marking suggestions time out quickly so the night is not blocked. Timing and submissions are unaffected.

## Media on the LAN

Question media, answer-sheet images, and Get Ready mosaics use root-relative `/media/…` URLs so phones and the wall hit whatever host served the page (nginx proxies `/media` and `/api`). You do **not** need `PUBLIC_BASE_URL` for clients to load images.
