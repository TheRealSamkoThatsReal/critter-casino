# 🃏 Critter Casino

A mobile-friendly **installable PWA** where you collect pixel-art creatures of
different rarities, gamble them in casino-style games for a chance to upgrade
(or lose) them, and trade with friends — all running entirely in the browser
with **no backend required**, hosted on GitHub Pages.

## Features

- **74+ collectible creatures** across 7 rarities: Common → Uncommon → Rare →
  Epic → Legendary → Mythic → Divine. Each has a value based on rarity.
- **Procedural pixel-art sprites** — every creature's sprite is generated
  deterministically from its id, so the roster can grow without art files.
  Includes ✨ shiny variants worth 5×.
- **Hatch eggs** to grow your collection; sell duplicates for coins to buy
  better eggs.
- **Casino games** where you wager a creature:
  - **Coin Flip** – double-or-nothing climb to a higher rarity.
  - **Lucky Wheel** – spin for up to +3 rarity tiers.
  - **Slots** – match three to jump +2 rarities.
  - **High Roll** – dice with a safer middle ground.
  - Odds get steeper at higher rarities, so reaching Divine is a real gamble.
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
