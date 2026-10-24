# Quizzical design system

## Locked vibe — Soft Structuralism (venue edition)

- Cool stone/silver field (`#F4F5F7` → `#E8EAEE`), charcoal ink (`#121417`)
- Live accent: electric teal (`#0D9488`)
- Urgency/error: warm coral (`#E11D48`)
- Soft ambient shadows; fixed film-grain ~3%
- **Banned:** OLED glass, purple/indigo glow, cream+terracotta editorial cliché, Inter/Roboto/Arial

## Typography

- Display: **Fraunces**
- UI: **Plus Jakarta Sans**
- Icons: Phosphor Light

## Surfaces

| Surface | Rules |
|---------|--------|
| Wallboard | Full-bleed stage; one job per state; no cards on question stage; no PINs/keys/standings mid-section |
| Host | Asymmetric bento; double-bezel for control islands |
| Play | Thumb-first single column; answer controls dominate |

## Motion

Spring curve `cubic-bezier(0.32, 0.72, 0, 1)`. Animate transform/opacity only.

Required choreography:

1. Wallboard stage enter on question reveal
2. Timer urgency under 10s
3. Participant ack pulse on server confirmation
