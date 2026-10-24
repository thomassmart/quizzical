# Friendly-night dry-run checklist

Use this before the first real venue night. Tick every item on a phone that is **not** the host machine.

## Network

- [ ] Open the web UI via the LAN hostname/IP (not only `localhost`)
- [ ] `WEB_ORIGIN` matches that LAN URL (QR / join links)
- [ ] Wallboard opens with `?token=` (from Prep Preview wall / Live Open wall) and stays connected

## Join

- [ ] Register a new team — pick an avatar from the grid
- [ ] Rejoin an existing team with PIN — avatar can be changed while lobby nominations are open
- [ ] Team header shows the chosen avatar

## Play

- [ ] **Test** (confirm) opens practice on the wall without needing teams
- [ ] Practice round (or Skip practice) works
- [ ] Picture-prompt questions show the host image; text questions have no random stock photo
- [ ] Music themes may play ambience audio; media never spoils the answer
- [ ] Multiple-choice on the wall is vertically centered and readable
- [ ] Get Ready mosaic shows photos or coloured placeholder tiles
- [ ] Submit + Revise works for short answer
- [ ] Matching / ordered list usable on a phone

## Marking

- [ ] **Mark section** leaves wall on MarkingRobot without finalising scores yet
- [ ] Host marking queue is the wide primary column
- [ ] Override incorrect → correct, then **Approve & reveal**
- [ ] **+1 / −1** adjust-score updates private totals
- [ ] LLM suggestion Apply works or times out without hanging

## Reveal / finish

- [ ] Answer reveal shows **Quickest** with avatar + team name when someone was fully correct first
- [ ] Answer-sheet image (if attached) appears on reveal only — not during the live question
- [ ] Standings show avatars; leader callout at top
- [ ] Final standings show **Winner** hero with avatar
- [ ] **Replace device** kicks old phone; rejoin with PIN restores authority

## Host ops

- [ ] **Restart** clears progress and returns to lobby (teams remain)
- [ ] **Reset** clears teams + scores, keeps questions, returns to Prep
- [ ] Phone after Reset must rejoin as a new team
- [ ] **Abandon** ends the night; Back to prep works
- [ ] Skip practice jumps to first real section
