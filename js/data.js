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
    return list;
  }

  G.data = {
    RARITIES: RARITIES,
    rarity: rarity,
    ELEMENTS: ELEMENTS,
    PRESTIGE_MAX_TIER: PRESTIGE_MAX_TIER,
    builtinRoster: buildRoster()
  };
})(window.G = window.G || {});
