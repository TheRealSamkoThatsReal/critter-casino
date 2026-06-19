/* Rarity tiers and the built-in creature roster. */
(function (G) {
  'use strict';

  // tier index === rarity power. value grows ~3x per tier.
  const RARITIES = [
    { tier: 0, name: 'Common',    value: 10,    color: '#9aa3b2', weight: 1000, glow: 'none' },
    { tier: 1, name: 'Uncommon',  value: 30,    color: '#4 caf50', weight: 460,  glow: '#4caf50' },
    { tier: 2, name: 'Rare',      value: 95,    color: '#3d8bff', weight: 180,  glow: '#3d8bff' },
    { tier: 3, name: 'Epic',      value: 290,   color: '#b15cff', weight: 64,   glow: '#b15cff' },
    { tier: 4, name: 'Legendary', value: 880,   color: '#ff9b21', weight: 18,   glow: '#ff9b21' },
    { tier: 5, name: 'Mythic',    value: 2700,    color: '#ff3b6b', weight: 5,      glow: '#ff3b6b' },
    { tier: 6, name: 'Divine',    value: 9000,    color: '#ffe14d', weight: 1,      glow: '#ffe14d' },
    // super-rare chase tiers beyond Divine — each ~3x rarer & more valuable
    { tier: 7,  name: 'Celestial',   value: 27000,   color: '#5ad6ff', weight: 0.45,  glow: '#5ad6ff' },
    { tier: 8,  name: 'Astral',      value: 80000,   color: '#a06bff', weight: 0.16,  glow: '#a06bff' },
    { tier: 9,  name: 'Ethereal',    value: 240000,  color: '#4dffb0', weight: 0.05,  glow: '#4dffb0' },
    { tier: 10, name: 'Primordial',  value: 720000,  color: '#ff6ad5', weight: 0.016, glow: '#ff6ad5' },
    { tier: 11, name: 'Eternal',     value: 2200000, color: '#ffcf3d', weight: 0.005, glow: '#ffcf3d' },
    { tier: 12, name: 'Omega',       value: 7000000, color: '#ff2d95', weight: 0.0015, glow: '#ff2d95' }
  ];
  // fix accidental space typo above
  RARITIES[1].color = '#4caf50';

  // prestige completion is based on the core roster (Common..Divine), so the
  // ultra-rare tiers above stay optional flex/chase items.
  const PRESTIGE_MAX_TIER = 6;

  function rarity(tier) { return RARITIES[Math.max(0, Math.min(RARITIES.length - 1, tier))]; }

  // Built-in species. Each: id, name, element, tier.
  // Spread across elements and tiers so upgrades always have somewhere to go.
  const ELEMENTS = ['Fire','Water','Grass','Electric','Ice','Rock','Shadow','Light',
                    'Toxic','Cosmic','Metal','Psychic','Dragon','Wind','Spirit','Lunar','Solar','Void'];

  // name pieces for generated flavor
  const BASE = {
    Common: [
      ['Mudling','Toxic'],['Pebbit','Rock'],['Sparkit','Electric'],['Leaflet','Grass'],
      ['Emberpup','Fire'],['Drizzle','Water'],['Frostnip','Ice'],['Gustling','Wind'],
      ['Dimmoth','Shadow'],['Glowbug','Light'],['Coglet','Metal'],['Sproutle','Nature'] ],
    Uncommon: [
      ['Cindercub','Fire'],['Ripplefin','Water'],['Thornkit','Grass'],['Voltmouse','Electric'],
      ['Snowtail','Ice'],['Boulderbug','Rock'],['Nighteye','Shadow'],['Lumitoad','Light'],
      ['Venomite','Toxic'],['Breezewing','Wind'] ],
    Rare: [
      ['Blazehound','Fire'],['Tidalclaw','Water'],['Bramblehorn','Grass'],['Stormcat','Electric'],
      ['Glaciern','Ice'],['Cragmaw','Rock'],['Umbralynx','Shadow'],['Prismfox','Light'],
      ['Toxiwyrm','Toxic'],['Astralmite','Cosmic'],['Ironclad','Metal'],['Mindwisp','Psychic'] ],
    Epic: [
      ['Infernus','Fire'],['Maelstrom','Water'],['Verdantua','Grass'],['Thunderking','Electric'],
      ['Permafrost','Ice'],['Titanshell','Rock'],['Eclipsar','Shadow'],['Radiantix','Light'],
      ['Plaguefang','Toxic'],['Nebulyth','Cosmic'],['Chromesteel','Metal'],['Psyphantom','Psychic'] ],
    Legendary: [
      ['Pyroclast','Fire'],['Leviathine','Water'],['Gaialord','Grass'],['Voltaron','Electric'],
      ['Cryowarden','Ice'],['Terraquake','Rock'],['Nyxshade','Shadow'],['Solflare','Solar'],
      ['Necrovenom','Toxic'],['Galaxion','Cosmic'],['Aurumking','Metal'],['Oraclemind','Psychic'] ],
    Mythic: [
      ['Cataclysm','Fire'],['Abyssarch','Water'],['Worldroot','Nature'],['Stormgod','Electric'],
      ['Absolute Zero','Ice'],['Mountainheart','Rock'],['Voidmonarch','Void'],['Dawnbringer','Solar'],
      ['Lunaris','Lunar'],['Cosmolord','Cosmic'] ],
    Divine: [
      ['Genesis','Light'],['Oblivion','Void'],['Eternaflame','Fire'],['Worldserpent','Dragon'],
      ['Astral Prime','Cosmic'],['Chronos','Spirit'] ],
    Celestial: [
      ['Seraphix','Light'],['Stardrake','Dragon'],['Aurorae','Ice'],['Halcyon','Wind'],['Empyros','Solar'] ],
    Astral: [
      ['Quasar','Cosmic'],['Pulsaria','Cosmic'],['Nebulux','Cosmic'],['Zenithon','Light'],['Starforge','Metal'] ],
    Ethereal: [
      ['Wraithlord','Spirit'],['Mirageon','Psychic'],['Phantasmus','Shadow'],['Aetheria','Wind'],['Spectron','Light'] ],
    Primordial: [
      ['Magmaroth','Fire'],['Tempestus','Wind'],['Terragon','Rock'],['Cryovault','Ice'],['Voraxis','Void'] ],
    Eternal: [
      ['Infinitas','Cosmic'],['Foreverwing','Dragon'],['Chronovex','Spirit'],['Eonix','Lunar'] ],
    Omega: [
      ['Omega','Void'],['Alpharion','Light'],['Singulon','Cosmic'],['Endbringer','Void'] ]
  };

  // How many distinct species to collect per rarity tier. Tuning this UP makes
  // each prestige take longer (more to discover, especially in the rare tail).
  // The hand-made roster above is padded with procedurally-named species up to
  // these counts. Index === tier (Common .. Omega).
  const TARGET_PER_TIER = [15, 15, 18, 18, 18, 16, 12, 10, 10, 10, 10, 8, 8];

  // Deterministic name parts for padding (prefix + thematic element, + suffix).
  // MUST stay stable across loads so generated species ids never change.
  const GEN_PREFIX = [
    ['Ember','Fire'],['Cinder','Fire'],['Scorch','Fire'],['Pyro','Fire'],
    ['Tidal','Water'],['Aqua','Water'],['Mistral','Water'],
    ['Frost','Ice'],['Glacial','Ice'],['Cryo','Ice'],
    ['Thorn','Grass'],['Bramble','Grass'],['Verdant','Grass'],
    ['Volt','Electric'],['Surge','Electric'],['Stormous','Electric'],
    ['Crag','Rock'],['Bouldra','Rock'],['Terran','Rock'],
    ['Umbral','Shadow'],['Nox','Shadow'],['Dusk','Shadow'],
    ['Prism','Light'],['Lumen','Light'],['Radi','Light'],
    ['Venom','Toxic'],['Mire','Toxic'],
    ['Gale','Wind'],['Zephyr','Wind'],
    ['Astra','Cosmic'],['Nebulo','Cosmic'],['Quasa','Cosmic'],
    ['Ferro','Metal'],['Chroma','Metal'],
    ['Psyche','Psychic'],['Cogni','Psychic'],
    ['Voiden','Void'],['Wraith','Spirit'],['Draken','Dragon'],['Luno','Lunar'],['Solen','Solar']
  ];
  const GEN_SUFFIX = ['fang','maw','claw','wing','horn','tail','scale','heart','crest','spine',
    'jaw','hide','roar','gaze','mane','talon','fin','tusk','shard','husk'];

  function buildRoster() {
    const list = [];
    const tierByName = { Common:0, Uncommon:1, Rare:2, Epic:3, Legendary:4, Mythic:5, Divine:6,
      Celestial:7, Astral:8, Ethereal:9, Primordial:10, Eternal:11, Omega:12 };
    Object.keys(BASE).forEach(function (rname) {
      BASE[rname].forEach(function (entry) {
        const name = entry[0], element = entry[1];
        const id = 'c_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        list.push({ id: id, name: name, element: element, tier: tierByName[rname], spriteSeed: id });
      });
    });
    // pad each tier up to its target with deterministic generated species
    TARGET_PER_TIER.forEach(function (target, tier) {
      const have = list.filter(function (s) { return s.tier === tier; }).length;
      for (let i = have; i < target; i++) {
        const g = tier * 37 + i; // spread so tiers don't share name combos
        const pre = GEN_PREFIX[g % GEN_PREFIX.length];
        const suf = GEN_SUFFIX[Math.floor(g / GEN_PREFIX.length) % GEN_SUFFIX.length];
        const id = 'g_t' + tier + '_' + i;
        list.push({ id: id, name: pre[0] + suf, element: pre[1], tier: tier, spriteSeed: id });
      }
    });
    return list;
  }

  // Income modifiers — rare traits a creature can spontaneously develop while
  // generating income at the Ranch. They multiply that creature's coin output.
  // Deliberately NOT obtainable from eggs, casino, or fusion (ranch-grown only).
  // `weight` is the relative chance of each modifier *given* that one is granted.
  const MODIFIERS = [
    { id: 'gilded',    name: 'Gilded',    icon: '✦', mult: 1.5, color: '#ffd75e', weight: 64 },
    { id: 'radiant',   name: 'Radiant',   icon: '✸', mult: 2,   color: '#5ec8ff', weight: 25 },
    { id: 'mythic',    name: 'Mythical',  icon: '❂', mult: 3,   color: '#c46bff', weight: 9  },
    { id: 'ascendant', name: 'Ascendant', icon: '👑', mult: 5,   color: '#ff5ea8', weight: 2  }
  ];
  const MOD_BY_ID = {};
  MODIFIERS.forEach(function (m) { MOD_BY_ID[m.id] = m; });
  function modifier(id) { return id ? (MOD_BY_ID[id] || null) : null; }
  function modMult(id) { const m = modifier(id); return m ? m.mult : 1; }
  // weighted pick of a modifier id (caller decides *whether* to grant one)
  function rollModifierId() {
    let total = 0;
    MODIFIERS.forEach(function (m) { total += m.weight; });
    let r = Math.random() * total;
    for (let i = 0; i < MODIFIERS.length; i++) { r -= MODIFIERS[i].weight; if (r <= 0) return MODIFIERS[i].id; }
    return MODIFIERS[0].id;
  }

  // ⭐ Stardust: a permanent meta-currency earned on prestige (scaled by the
  // coins you earned that run). Spent on a tree of upgrades that persist across
  // every prestige — this is what makes coins matter long-term. `per` is the
  // additive effect per level; `base`/`growth` give the Stardust cost curve.
  const STARDUST_UPGRADES = [
    { id: 'income',   icon: '⭐', name: 'Golden Touch',        per: 0.25, base: 3,  growth: 1.55, max: Infinity, fmt: 'income', desc: 'income from every creature' },
    { id: 'value',    icon: '✨', name: 'Fortune',             per: 0.10, base: 5,  growth: 1.7,  max: 15,       fmt: 'value',  desc: 'creature value (sells & wagers)' },
    { id: 'casino',   icon: '🍀', name: 'High Roller',         per: 0.08, base: 5,  growth: 1.7,  max: 12,       fmt: 'casino', desc: 'casino payout' },
    { id: 'modrate',  icon: '🧬', name: 'Modifier Affinity',   per: 0.40, base: 8,  growth: 2.0,  max: 6,        fmt: 'rate',   desc: 'chance creatures grow a modifier' },
    { id: 'shiny',    icon: '🌟', name: 'Lucky Hatch',         per: 0.01, base: 6,  growth: 1.8,  max: 10,       fmt: 'shiny',  desc: 'shiny chance when hatching/fusing' },
    { id: 'nest',     icon: '💰', name: 'Nest Egg',            per: 0.005, base: 6, growth: 2.0,  max: 10,       fmt: 'keep',   desc: 'of your coins kept through prestige' },
    { id: 'compound', icon: '🌠', name: 'Stardust Compounder', per: 0.15, base: 10, growth: 1.9,  max: 12,       fmt: 'sd',     desc: 'Stardust earned on prestige' }
  ];

  // Lifetime-coin milestones: each grants a one-time Stardust reward, giving
  // coins a destination even between prestiges.
  const COIN_MILESTONES = [
    { amt: 1e6, sd: 4 }, { amt: 1e7, sd: 10 }, { amt: 1e8, sd: 25 }, { amt: 1e9, sd: 60 },
    { amt: 1e10, sd: 150 }, { amt: 1e11, sd: 380 }, { amt: 1e12, sd: 900 }, { amt: 1e13, sd: 2200 },
    { amt: 1e14, sd: 5500 }, { amt: 1e15, sd: 14000 }, { amt: 1e16, sd: 35000 }, { amt: 1e18, sd: 90000 }
  ];

  G.data = {
    RARITIES: RARITIES,
    rarity: rarity,
    ELEMENTS: ELEMENTS,
    PRESTIGE_MAX_TIER: PRESTIGE_MAX_TIER,
    MODIFIERS: MODIFIERS,
    STARDUST_UPGRADES: STARDUST_UPGRADES,
    COIN_MILESTONES: COIN_MILESTONES,
    modifier: modifier,
    modMult: modMult,
    rollModifierId: rollModifierId,
    builtinRoster: buildRoster()
  };
})(window.G = window.G || {});
