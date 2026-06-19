# 🃏 Critter Casino

A mobile-friendly **installable PWA** where you collect pixel-art creatures of
different rarities, gamble them in casino-style games for a chance to upgrade
(or lose) them, and trade with friends — all running entirely in the browser
with **no backend required**, hosted on GitHub Pages.

## Features

- **160+ collectible creatures** across 13 rarities: Common → Uncommon → Rare →
  Epic → Legendary → Mythic → Divine → Celestial → Astral → Ethereal →
  Primordial → Eternal → Omega. The tiers above Divine are ultra-rare chase
  items (Omega is worth millions). Each creature's value scales with rarity.
- **SFX + VFX** — pulling a Rare or better plays a Vampire-Survivors-style
  suspense build-up first (god-rays, a shaking mystery orb cycling sprites, a
  rising riser tone, all scaling in length/intensity with rarity — ~1.4s for a
  Rare up to ~8s for an Omega), then bursts into a synthesized Web Audio chime
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
  better eggs. Paid eggs support **bulk hatching (×10 / ×100)** with a grouped
  results summary, to spend coins fast — but each egg's price **rises the more
  of it you buy** in a run (resets on prestige), so flooding eggs gets costly.
  A free **Daily Egg** gives a creature
  from any unlocked rarity, favouring species you haven't collected yet —
  *weighted by rarity*, so it fills the easy slots quickly but the rare tail of
  the Critterdex stays a genuine grind.
- **Fusion** — combine **3 creatures of one rarity into 1 of the next rarity up**
  (from the Collection's 🔥 Fuse button). Rarity values are ~3× per tier, so it's
  roughly value-neutral — a way to shrink a bloated collection and climb tiers at
  once. Bulk-fuse many at a time, or **⚡ Max Fuse** to cascade your whole
  collection upward in one tap (3→1, rolling new creatures up until nothing else
  can fuse).
- **"NEW" badges** — the first time you obtain a species you've never discovered,
  it's flagged **NEW** right on the reveal: a ✦ NEW DISCOVERY ribbon on the
  single-egg popup and a green NEW corner badge on the multi-hatch/fusion summary
  cards. The flag is shown once on that popup and not carried into the Collection.
- **Critterdex view** in the Collection (Owned ⇄ Critterdex toggle): every
  species shown as a card — owned in full colour with counts, undiscovered as
  "???" silhouettes, and prestige-locked rarities as 🔒 silhouettes so you can
  see what's coming.
- **Ranch (idle income)** — your creatures passively generate coins per second
  based on rarity, even while the app is closed (offline earnings, capped).
  Spend coins on upgrades (Habitat, Gilded Cages, Cozy Beds) to earn faster.
  This gives a reason to *hold* creatures rather than sell or wager them all.
- **Income modifiers** — rare traits a creature can spontaneously develop *while
  generating income at the Ranch*: **Gilded ×1.5 → Radiant ×2 → Mythical ×3 →
  Ascendant ×5** coin output (rarer tiers are stronger). They're deliberately
  **impossible to get from eggs, the casino, or fusion** — only the Ranch grows
  them, slowly, so they feel earned. You're told when one appears (a toast, or in
  the welcome-back screen if it happened offline), and a modified creature shows a
  coloured corner gem and aura on its card.
- **⭐ Stardust + permanent upgrade tree (long-game economy)** — prestiging grants
  **Stardust** scaled by the coins you earned that run (a square-root curve, boosted
  by the Compounder), so *banking and spending coins permanently increases your
  power*. Stardust buys a tree that persists across every prestige: **Golden Touch**
  (global income), **Fortune** (creature value), **High Roller** (casino payout),
  **Modifier Affinity** (ranch modifier rate), **Lucky Hatch** (shiny chance),
  **Nest Egg** (keep a % of coins through prestige), and **Stardust Compounder**.
- **Coins → power sinks** so money matters at every scale: **upgrade a creature's
  income modifier** (Gilded→Radiant→Mythical→Ascendant) for coins, **guarantee a
  shiny** when fusing, and a **🕵️ Black Market** that sells a guaranteed
  *undiscovered* creature at an escalating price — turning coins straight into
  prestige progress.
- **🏆 Records & milestones** — a scoreboard (lifetime/peak coins, prestiges,
  modifiers grown, casino record) plus **lifetime-coin milestones** (1M, 10M, … up
  to 1Qi) that each pay a one-time Stardust bonus. Big numbers render with
  k/M/B/T/Qa… suffixes.
- **Prestige** — a persistent **Critterdex** tracks every species you've ever
  owned. Discover all currently-unlocked creatures and you can prestige: your run
  (creatures, most coins, Ranch upgrades, dex) resets in exchange for a **permanent
  +50% income** bonus that stacks every prestige, **Stardust**, **and unlocks the
  next rarity tier** (Prestige 1 → Celestial … Prestige 6 → Omega). Rarities above your
  prestige level are locked out of hatching and the casino, and the completion
  bar grows to include each newly unlocked tier. **Costs scale up each prestige**
  (egg prices and the casino value-to-tier mapping ×1.6^prestige), outpacing the
  income bonus so every prestige is harder than the last. Pressing prestige
  before you're ready shows the creatures you still need (as silhouettes).
- **Casino games** where you wager **one or many** creatures at once. Their
  combined value is your stake, and each game rolls a payout multiplier — the
  bigger your stake, the rarer the creature you can win. Lose, and the whole
  wager is gone.
  - **Coin Flip** – double or nothing on your whole stake.
  - **Lucky Wheel** – spin for up to a ×10 jackpot.
  - **Slots** – match symbols for up to ×8.
  - **High Roll** – dice with a safer middle ground.
  - **Skill games** where *you* decide the payout: **Bullseye** (stop the marker
    on center, ×5), **Quick Draw** (reaction time, ×4), **Echo** (repeat a color
    sequence, ×3).
  - Pool a pile of commons for a real shot at an Epic, Mythic, or Divine.
- **Player-to-player trading** two ways:
  - **Live Trade Board** (server-backed marketplace): post creatures as a
    listing; other players make **offers** (their creatures, escrowed); you
    **accept or decline**. On accept you get the bidder's creatures, the winner
    collects your listing, and rejected bidders get their creatures back — all
    atomic and dupe-proof via a Cloudflare Durable Object. Includes My Listings
    (review/accept offers, cancel) and My Offers (withdraw / collect). With
    reminders enabled you get a **push when someone offers on your listing**, and
    when your offer is **accepted or declined**.
  - **Offline code trade**: compact shareable codes that need no server — but,
    being client-only, are honor-based (a code can be redeemed by multiple
    people).
- **Hidden admin panel** to design and add creatures (live sprite preview +
  pixel editor), grant creatures, change the admin passcode, and manage the
  game. The Admin tab is hidden until you do the secret knock (see below).
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

There is no Admin tab in the nav. To open the admin panel, **tap the 🔊/🔇 mute
button in the top bar six times quickly** (toggle it on/off three times) — that
secret knock takes you straight to the panel. Then enter the passcode (default
`admin` on a fresh save — change it in the panel's "Admin Passcode" section).
Leave the panel by tapping any bottom-nav tab. Because this is a purely
client-side app, the passcode is only a soft gate, not real security.
