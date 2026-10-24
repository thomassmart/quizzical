# End-to-end demonstration

## Setup

```bash
npm install
npm run db:migrate -w @quizzical/api
npm run db:seed -w @quizzical/api   # note wallboard token
npm run dev
# Or: podman compose up -d --build  → http://localhost:9080
```

## Script (≈20 minutes)

1. **Host login** — password `changeme`.
2. Open **Demo Night** (`DEMO01`); confirm sections are approved.
3. **Wallboard** — `/wall/DEMO01?token=…` on a large window.
4. **Three teams** — join on phones/browsers (pick avatars + enter member names):
   - Red Pandas / 1111 (bonus General Knowledge)
   - Blue Whales / 2222 (bonus Science)
   - Green Lanterns / 3333 (bonus Pop Culture)
5. Host → Live → **Open lobby** → **Start game** (rules on the wall).  
   (Prep **Test** is an alternative solo practice path — no teams required.)
6. **Start practice** — walk through MC / short / ordered / matching; mark → approve & reveal → show practice scores → **Begin the night**.  
   (Or **Skip practice** on a repeat dry run.)
7. **Reveal** Q1 → wall shows stem → **Open answers**.
8. Teams answer; one team uses a **wager** (not in their bonus section).
9. Let timer expire or **Close**; advance through the section.
10. **Mark section** → review queue (override a short answer) → **Approve & reveal answers** one by one (confirm **Quickest** avatar; optional answer-sheet image) → **Show scores**.
11. Optionally upload prompt media or an answer-sheet image in prep, then **Restart** / open lobby again so the freeze picks up changes.
12. Finish event; confirm wallboard **Winner** hero + final standings with avatars. Use **Reset** before a real night to clear test teams.

## What this proves

- Multi-team sync over WebSockets  
- Bonus nomination lock  
- Wager spend  
- Host mark review before ledger apply  
- Speed-winner + avatar on answer reveal  
- Role separation (phones lack answer keys)  
