# 🃏 Critter Casino

A mobile-friendly **installable PWA** where you collect pixel-art creatures of
different rarities, gamble them in casino-style games for a chance to upgrade
(or lose) them, and trade with friends — all running entirely in the browser
with **no backend required**, hosted on GitHub Pages.

## Features

- **100+ collectible creatures** across 13 rarities: Common → Uncommon → Rare →
  Epic → Legendary → Mythic → Divine → Celestial → Astral → Ethereal →
  Primordial → Eternal → Omega. The tiers above Divine are ultra-rare chase
  items (Omega is worth millions). Each creature's value scales with rarity.
- **SFX + VFX** — pulling a Rare or better plays a Vampire-Survivors-style
  suspense build-up first (god-rays, a shaking mystery orb cycling sprites, a
  rising riser tone, all scaling in length/intensity with rarity — ~1.4s for a
  Rare up to ~5s for an Omega), then bursts into a synthesized Web Audio chime
  and a confetti + shockwave reveal. A mute toggle lives in the top bar.
- **Swipe navigation** — swipe left/right anywhere on a page to move between
  tabs (with a slide animation). Ignores vertical scrolls and is disabled while
  a dialog is open.
- **Daily push reminders** (optional) — a 🔔 toggle subscribes you to a once-a-day
  reminder at a time you choose, delivered via the Web Push protocol even when
  the app is closed (and skipped on days you already played). This needs a tiny
  serverless backend — a Cloudflare Worker in `server/` (free tier); see
  `server/SETUP.md`. Everything else runs with no backend.
- **Procedural pixel-art sprites** — every creature's sprite is generated
  deterministically from its id, so the roster can grow without art files.
  Includes ✨ shiny variants worth 5×.
- **Hatch eggs** to grow your collection; sell duplicates for coins to buy
  better eggs.
- **Ranch (idle income)** — your creatures passively generate coins per second
  based on rarity, even while the app is closed (offline earnings, capped).
  Spend coins on upgrades (Habitat, Gilded Cages, Cozy Beds) to earn faster.
  This gives a reason to *hold* creatures rather than sell or wager them all.
- **Prestige** — a persistent **Critterdex** tracks every species you've ever
  owned. Discover all currently-unlocked creatures and you can prestige: your run
  (creatures, coins, Ranch upgrades, dex) resets in exchange for a **permanent
  +50% income** bonus that stacks every prestige **and unlocks the next rarity
  tier** (Prestige 1 → Celestial … Prestige 6 → Omega). Rarities above your
  prestige level are locked out of hatching and the casino, and the completion
  bar grows to include each newly unlocked tier.
- **Casino games** where you wager **one or many** creatures at once. Their
  combined value is your stake, and each game rolls a payout multiplier — the
  bigger your stake, the rarer the creature you can win. Lose, and the whole
  wager is gone.
  - **Coin Flip** – double or nothing on your whole stake.
  - **Lucky Wheel** – spin for up to a ×10 jackpot.
  - **Slots** – match symbols for up to ×8.
  - **High Roll** – dice with a safer middle ground.
  - Pool a pile of commons for a real shot at an Epic, Mythic, or Divine.
- **Player-to-player trading** via shareable codes (offer → accept → complete),
  with escrow and reclaim — no servers or accounts.
- **Admin panel** (passcode: `admin`) to design and add new creatures with a
  live sprite preview, grant creatures, and manage the game.
- **PWA**: installable to your home screen and works offline via a service
  worker. Designed mobile-first with a bottom nav and safe-area support.

## Play

Open the GitHub Pages URL on your phone and tap "Add to Home Screen" to install.

## Tech

Vanilla JavaScript, HTML, and CSS — no build step, no dependencies. Game state
is saved in `localStorage`.

## Local development

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Admin

Tap the **Admin** tab and enter the passcode `admin`. Because this is a
purely client-side app, the passcode is only a soft gate, not real security.
