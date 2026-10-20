/*
 * Chester's Escape - boards, themes and card decks.
 * A board is the path (which spaces, in which order, with which maps).
 * A theme is the look and the words (cemetery vs Christmas). The same board
 * can be played in any theme: event spaces carry a `kind`, and each theme
 * gives that kind its own name and icon.
 */
(function (root) {
  'use strict';

  var CELL = 64, PAD = 20;
  function at(c, r) { return { x: PAD + c * CELL + CELL / 2, y: PAD + r * CELL + CELL / 2 }; }

  // ---- Chester's Escape board -------------------------------------------------
  // Grid is 15 x 15 cells on a 1000 x 1000 board. Each entry: [col, row, type, extra]
  // Map keys come from the original game board.
  var LONGER = [
    [11, 1, 'map', { bsr: ['4f33e', '4f3c2'] }],
    [10, 1, 'map', { bsr: ['4fde6'] }],
    [10, 2, 'map', { bsr: ['4fdf9'] }],
    [10, 3, 'card'],
    [10, 4, 'map', { bsr: ['4feec'] }],
    [10, 5, 'map', { bsr: ['4ff41'] }],
    [10, 6, 'card'],
    [10, 7, 'map', { bsr: ['4ff40'] }],
    [10, 8, 'task', { kind: 'terror', bsr: ['20a96'] }],
    [10, 9, 'map', { bsr: ['4fded'] }],
    [9, 9, 'map', { bsr: ['4fd41'] }],
    [8, 9, 'move', { kind: 'flowers', n: 2 }],
    [7, 9, 'map', { bsr: ['4ffd0'] }],
    [7, 8, 'map', { bsr: ['4ffeb'] }],
    [7, 7, 'card'],
    [7, 6, 'map', { bsr: ['50032'] }],
    [7, 5, 'task', { kind: 'roadblock', bsr: ['4d135'] }],
    [7, 4, 'map', { bsr: ['50014'] }],
    [7, 3, 'map', { bsr: ['5004a'] }],
    [6, 3, 'map', { bsr: ['4f073'] }],
    [5, 3, 'card'],
    [4, 3, 'map', { bsr: ['5009e'] }],
    [3, 3, 'skip', { kind: 'ghostScare', turns: 1 }],
    [2, 3, 'map', { bsr: ['500ae'] }],
    [1, 3, 'task', { kind: 'cat', bsr: ['20848'] }],
    [1, 4, 'map', { bsr: ['4ffb8'] }],
    [1, 5, 'map', { bsr: ['5009f'] }],
    [1, 6, 'map', { bsr: ['4bfde'] }],
    [2, 6, 'card'],
    [3, 6, 'map', { bsr: ['5013b'] }],
    [4, 6, 'map', { bsr: ['5014b'] }],
    [5, 6, 'task', { kind: 'attack', bsr: ['30155'] }],
    [5, 7, 'map', { bsr: ['50155'] }],
    [5, 8, 'move', { kind: 'ghostRun', n: 3 }],
    [4, 8, 'map', { bsr: ['50166'] }],
    [3, 8, 'map', { bsr: ['50040'] }],
    [2, 8, 'card'],
    [2, 9, 'map', { bsr: ['4fb7e'] }],
    [2, 10, 'skip', { kind: 'ghostScare', turns: 1 }]
  ];
  var RISKIER = [
    [13, 2, 'map', { bsr: ['4fde6'] }],
    [13, 3, 'card'],
    [13, 4, 'map', { bsr: ['4feec'] }],
    [13, 5, 'start', { kind: 'grave' }],
    [13, 6, 'task', { kind: 'terror', bsr: ['1f31b'] }],
    [13, 7, 'card'],
    [13, 8, 'map', { bsr: ['4ff40'] }],
    [13, 9, 'skip', { kind: 'pulledUnder', turns: 1, id: 'pulled' }],
    [13, 10, 'warp', { kind: 'swim', to: 'safe' }],
    [13, 11, 'map', { bsr: ['5009e'] }],
    [13, 12, 'task', { kind: 'roadblock', bsr: ['4cd52'] }],
    [13, 13, 'card'],
    [12, 13, 'map', { bsr: ['4ffb8'] }],
    [11, 13, 'map', { bsr: ['4bfde'] }],
    [10, 13, 'warp', { kind: 'current', to: 'pulled' }],
    [9, 13, 'safe', { kind: 'safe', id: 'safe' }],
    [8, 13, 'task', { kind: 'attack', bsr: ['34215'] }],
    [7, 13, 'map', { bsr: ['50155'] }],
    [6, 13, 'card'],
    [5, 13, 'move', { kind: 'evilGhost', n: -5 }],
    [4, 13, 'map', { bsr: ['50040'] }],
    [3, 13, 'move', { kind: 'ghostRun', n: 3 }],
    [2, 13, 'task', { kind: 'cat', bsr: ['19673'] }],
    [2, 12, 'map', { bsr: ['4bfde'] }]
  ];
  var SHARED = [
    [2, 11, 'card'],
    [1, 11, 'map', { bsr: ['501cc'] }],
    [0, 11, 'exit', { kind: 'exit' }]
  ];

  function buildBoard() {
    var spaces = {}, routes = {}, n = 0;
    function add(row, prefix) {
      var id = (row[3] && row[3].id) || (prefix + (++n));
      var sp = Object.assign({ id: id, type: row[2] }, at(row[0], row[1]), row[3] || {});
      delete sp.id; sp.id = id;
      spaces[id] = sp; return id;
    }
    var shared = SHARED.map(function (r) { return add(r, 's'); });
    n = 0; routes.longer = LONGER.map(function (r) { return add(r, 'L'); }).concat(shared);
    n = 0; routes.riskier = RISKIER.map(function (r) { return add(r, 'R'); }).concat(shared);
    return {
      id: 'chester-escape',
      title: "Chester's Escape",
      size: { w: 1000, h: 1000 },
      cell: CELL,
      spaces: spaces,
      routes: routes,
      routeInfo: {
        longer: { name: 'Longer route', blurb: 'Safer ground, more maps. ' + routes.longer.length + ' spaces to the gates.' },
        riskier: { name: 'Riskier route', blurb: 'Shorter, but the river and the graves are waiting. ' + routes.riskier.length + ' spaces.' }
      },
      starts: {
        longer: Object.assign(at(12, 1), { dir: 'left' }),
        riskier: Object.assign(at(13, 1), { dir: 'down' })
      },
      // Bonus maps: every roll that stops without a map draws one of these. All have an
      // easier difficulty than Expert+, so anyone can clear them.
      bonusMaps: ['4fdf9', '5013b', '4ffeb', '501cc', '4f073', '5004a',
        '551d8', '54b78', '53c54', '54b7e', '551b9', '54f58', '54568',
        '54b4d', '550b7', '544cc', '55036', '53a2d', '54b7a'],
      background: null       // designer can set an uploaded image (data URL); null = theme art
    };
  }

  // ---- themes ----------------------------------------------------------------
  var THEMES = {
    cemetery: {
      id: 'cemetery',
      name: 'Haunted cemetery',
      title: "Chester's Escape",
      tagline: 'Help Chester find his way out of the cemetery. If you dare.',
      goal: 'cemetery gates',
      font: "'Grenze Gotisch', Georgia, serif",
      palette: { ground: '#4a6a2c', ground2: '#2f4a1d', stone: '#9aa0a3', stoneDark: '#5d6366', ink: '#2b2f31', accent: '#f2a33a', good: '#3fd04a', bad: '#8b5cf6', water: '#1d4f73' },
      card: { back: 'Chester’s Escape', treasure: 'Treasure card', trick: 'Trick card', task: 'Task card', fate: 'Fate card' },
      kinds: {
        cat:        { title: 'Chased by a cat!', icon: '🐈‍⬛' },
        roadblock:  { title: 'Road blocked!', icon: '🚧' },
        terror:     { title: "You've been terrorized!", icon: '👹' },
        attack:     { title: 'Personal attack!', icon: '😤' },
        ghostScare: { title: 'Scared by a ghost!', icon: '👻' },
        ghostRun:   { title: 'Run from the ghost!', icon: '🏃' },
        flowers:    { title: 'Flowers found!', icon: '💐' },
        evilGhost:  { title: 'Evil ghost got you!', icon: '☠️' },
        grave:      { title: 'Fell in a grave!', icon: '⚰️' },
        pulledUnder:{ title: 'Pulled under by a ghost!', icon: '🫧' },
        swim:       { title: 'Swim to safety!', icon: '🛟' },
        current:    { title: 'Taken by the current!', icon: '🌊' },
        safe:       { title: 'Safe!', icon: '🪨' },
        exit:       { title: 'Cemetery gates', icon: '🚪' }
      },
      words: { card: ['CARD', 'DROP'], start: 'Start', longer: 'Longer route', riskier: 'Riskier route', escaped: 'You escaped!', results: 'Day {n} results' },
      routes: { longer: 'Safer ground, more maps. {n} spaces to the gates.', riskier: 'Shorter, but the river and the graves are waiting. {n} spaces.' }
    },
    christmas: {
      id: 'christmas',
      name: 'Snowy Christmas',
      title: "Chester's Christmas",
      tagline: "Help Santa reach Chester's tombstone home with shiny crow gifts.",
      goal: 'tombstone home',
      font: "'Mountains of Christmas', Georgia, serif",
      taglineSize: 16,
      fontQuery: 'Mountains+of+Christmas:wght@700',
      hat: 'santa',
      banner: ['#d7263d', '#fff'],
      palette: { ground: '#e9f1f7', ground2: '#c9dbe8', stone: '#ffffff', stoneDark: '#9db4c6', ink: '#24384a', accent: '#d7263d', good: '#2fb35a', bad: '#3a6ea5', water: '#a9d6f0' },
      card: { back: 'Chester’s Christmas', treasure: 'Gift card', trick: 'Coal card', task: 'Carol card', fate: 'Snow globe' },
      kinds: {
        cat:        { title: 'Chased by a snowman!', icon: '⛄' },
        roadblock:  { title: 'Snowed in!', icon: '🌨️' },
        terror:     { title: 'Krampus spotted!', icon: '😈' },
        attack:     { title: 'Grumpy elf!', icon: '🧝' },
        ghostScare: { title: 'Brain freeze!', icon: '🥶' },
        ghostRun:   { title: 'Sled downhill!', icon: '🛷' },
        flowers:    { title: 'Found a candy cane!', icon: '🍬' },
        evilGhost:  { title: 'Avalanche!', icon: '🏔️' },
        grave:      { title: 'Stuck in a snowy grave!', icon: '🪦' },
        pulledUnder:{ title: 'Stuck in the slush!', icon: '🫠' },
        swim:       { title: 'Skate to safety!', icon: '⛸️' },
        current:    { title: 'Thin ice!', icon: '❄️' },
        safe:       { title: 'Safe!', icon: '🕯️' },
        exit:       { title: "Chester's tombstone home", icon: '🪦' }
      },
      words: { card: ['GIFT', 'DROP'], start: 'Start', longer: 'Longer route', riskier: 'Riskier route', escaped: 'Gifts delivered!', results: 'Day {n} results', swim: 'Skate!' },
      routes: { longer: "Plowed paths, more maps. {n} spaces to Chester's tombstone.", riskier: 'Shorter, but the frozen river and the snowy graves are waiting. {n} spaces.' }
    },
    thanksgiving: {
      id: 'thanksgiving',
      name: 'Harvest Thanksgiving',
      title: "Chester's Thanksgiving",
      tagline: 'Help Chester reach the harvest feast before the pie is gone.',
      goal: 'feast table',
      font: "'Cherry Swash', Georgia, serif",
      fontQuery: 'Cherry+Swash:wght@700',
      hat: 'pilgrim',
      titleSize: 60,
      taglineSize: 17,
      banner: ['#d9661f', '#fff4dc'],
      palette: { ground: '#e6bd6e', ground2: '#b07a34', stone: '#fff7e6', stoneDark: '#9a6a2e', ink: '#4a2a10', accent: '#d9661f', good: '#4f8a2b', bad: '#b23a1c', water: '#5f9bbd' },
      card: { back: 'Chester’s Thanksgiving', treasure: 'Harvest card', trick: 'Leftovers card', task: 'Chore card', fate: 'Wishbone card' },
      kinds: {
        cat:        { title: 'Chased by the farm cat!', icon: '🐈' },
        roadblock:  { title: 'Hay bales block the road!', icon: '🌾' },
        terror:     { title: 'The farmer saw you!', icon: '🧑‍🌾' },
        attack:     { title: 'Angry turkey!', icon: '🦃' },
        ghostScare: { title: 'Spooked by a scarecrow!', icon: '👒' },
        ghostRun:   { title: 'Ride the hay wagon!', icon: '🚜' },
        flowers:    { title: 'Found a corn cob!', icon: '🌽' },
        evilGhost:  { title: 'Cow stampede!', icon: '🐄' },
        grave:      { title: 'Fell in the mud pit!', icon: '🐖' },
        pulledUnder:{ title: 'Stuck in the cranberry bog!', icon: '🥾' },
        swim:       { title: 'Paddle to safety!', icon: '🛶' },
        current:    { title: 'Swept down the creek!', icon: '🌊' },
        safe:       { title: 'Safe!', icon: '🍂' },
        exit:       { title: 'The feast table', icon: '🍽️' }
      },
      words: { card: ['PIE', 'DROP'], start: 'Start', longer: 'Longer route', riskier: 'Riskier route', escaped: 'Made it to the feast!', results: 'Day {n} results', swim: 'Paddle!' },
      routes: { longer: 'Through the fields, more maps. {n} spaces to the feast table.', riskier: 'Shorter, but the creek and the scarecrows are waiting. {n} spaces.' }
    },
    'taco-thanksgiving': {
      id: 'taco-thanksgiving',
      name: "Taco's Thanksgiving",
      title: "Taco's Thanksgiving",
      tagline: 'Help Taco get to Thanksgiving dinner.',
      goal: 'dinner table',
      font: "'Cherry Swash', Georgia, serif",
      fontQuery: 'Cherry+Swash:wght@700',
      hero: 'taco',
      hat: 'pilgrim',
      look: 'thanksgiving',
      art: 'img/themes/taco-thanksgiving.jpg',   // Hummingbird's board art, title included
      // Taco cut out of the art so he can move; clip keeps him behind the hill.
      artHero: { src: 'img/themes/taco-thanksgiving-taco.png', x: 518.34, y: 87.72, w: 156.3, h: 98.88, clip: 'M488.8,54.2 L702.6,54.2 L702.6,178.9 L699.4,179.1 L696.2,179.4 L693.0,179.6 L689.8,179.8 L686.6,180.0 L683.4,180.1 L680.2,180.3 L677.0,180.4 L673.8,180.6 L670.7,180.7 L667.5,180.8 L664.3,180.8 L661.1,180.9 L657.9,180.9 L654.7,181.0 L651.5,181.0 L648.3,181.0 L645.1,181.0 L641.9,180.9 L638.8,180.9 L635.6,180.8 L632.4,180.7 L629.2,180.6 L626.0,180.5 L622.8,180.4 L619.6,180.2 L616.4,180.1 L613.2,179.9 L610.0,179.7 L606.9,179.5 L603.7,179.3 L600.5,179.0 L597.3,178.8 L594.1,178.5 L590.9,178.2 L587.7,177.9 L584.5,177.6 L581.3,177.2 L578.1,176.9 L575.0,176.5 L571.8,176.1 L568.6,175.7 L565.4,175.3 L562.2,174.9 L559.0,174.4 L555.8,173.9 L552.6,173.5 L549.4,173.0 L546.3,172.5 L543.1,171.9 L539.9,171.4 L536.7,170.8 L533.5,170.2 L530.3,169.6 L527.1,169.0 L523.9,168.4 L520.7,167.8 L517.5,167.1 L514.4,166.4 L511.2,165.8 L508.0,165.1 L504.8,164.3 L501.6,163.6 L498.4,162.8 L495.2,162.1 L492.0,161.3 L488.8,160.5 Z' },
      banner: ['#d9661f', '#fff4dc'],
      palette: { ground: '#f3d27a', ground2: '#d9a24a', stone: '#fff7e6', stoneDark: '#9a6a2e', ink: '#4a2a10', accent: '#d9661f', good: '#4f8a2b', bad: '#b23a1c', water: '#5f9bbd' },
      card: { back: 'Taco’s Thanksgiving', treasure: 'Harvest card', trick: 'Leftovers card', task: 'Chore card', fate: 'Wishbone card' },
      kinds: {
        cat:        { title: 'Chased by the farm cat!', icon: '🐈' },
        roadblock:  { title: 'Hay bales block the road!', icon: '🌾' },
        terror:     { title: 'The farmer saw you!', icon: '🧑‍🌾' },
        attack:     { title: 'Angry turkey!', icon: '🦃' },
        ghostScare: { title: 'Spooked by a scarecrow!', icon: '👒' },
        ghostRun:   { title: 'Ride the hay wagon!', icon: '🚜' },
        flowers:    { title: 'Found a corn cob!', icon: '🌽' },
        evilGhost:  { title: 'Cow stampede!', icon: '🐄' },
        grave:      { title: 'Fell in the mud pit!', icon: '🐖' },
        pulledUnder:{ title: 'Stuck in the cranberry bog!', icon: '🥾' },
        swim:       { title: 'Hop the stepping stones!', icon: '🪨' },
        current:    { title: 'Swept down the creek!', icon: '🌊' },
        safe:       { title: 'Safe!', icon: '🍂' },
        exit:       { title: 'Thanksgiving dinner', icon: '🍽️' }
      },
      words: { card: ['PIE', 'DROP'], start: 'Start', longer: 'Longer route', riskier: 'Riskier route', escaped: 'Made it to dinner!', results: 'Day {n} results', swim: 'Hop across!' },
      routes: { longer: 'Through the fields, more maps. {n} spaces to dinner.', riskier: 'Shorter, but the creek is waiting. {n} spaces.' }
    },
    'taco-christmas': {
      id: 'taco-christmas',
      name: "Taco's Christmas",
      title: "Taco's Christmas",
      tagline: "Help Taco get to Santa's house.",
      goal: 'North Pole',
      font: "'Mountains of Christmas', Georgia, serif",
      fontQuery: 'Mountains+of+Christmas:wght@700',
      hero: 'taco',
      hat: 'santa',
      look: 'christmas',
      art: 'img/themes/taco-christmas.jpg',   // Hummingbird's board art, title included
      // Taco cut out of the art so he can move; clip keeps him behind the hill.
      artHero: { src: 'img/themes/taco-christmas-taco.png', x: 521.53, y: 85.33, w: 128.39, h: 93.3, clip: 'M492.0,51.8 L677.0,51.8 L677.0,172.7 L673.8,173.1 L670.7,173.4 L667.5,173.8 L664.3,174.1 L661.1,174.3 L657.9,174.6 L654.7,174.8 L651.5,175.0 L648.3,175.2 L645.1,175.3 L641.9,175.4 L638.8,175.5 L635.6,175.6 L632.4,175.6 L629.2,175.6 L626.0,175.6 L622.8,175.6 L619.6,175.5 L616.4,175.4 L613.2,175.3 L610.0,175.1 L606.9,174.9 L603.7,174.7 L600.5,174.5 L597.3,174.2 L594.1,174.0 L590.9,173.7 L587.7,173.3 L584.5,173.0 L581.3,172.6 L578.1,172.1 L575.0,171.7 L571.8,171.2 L568.6,170.7 L565.4,170.2 L562.2,169.7 L559.0,169.1 L555.8,168.5 L552.6,167.8 L549.4,167.2 L546.3,166.5 L543.1,165.8 L539.9,165.0 L536.7,164.3 L533.5,163.5 L530.3,162.7 L527.1,161.8 L523.9,161.0 L520.7,160.1 L517.5,159.1 L514.4,158.2 L511.2,157.2 L508.0,156.2 L504.8,155.2 L501.6,154.1 L498.4,153.0 L495.2,151.9 L492.0,150.8 Z' },
      banner: ['#d7263d', '#fff'],
      palette: { ground: '#e9f1f7', ground2: '#c9dbe8', stone: '#ffffff', stoneDark: '#9db4c6', ink: '#24384a', accent: '#d7263d', good: '#2fb35a', bad: '#3a6ea5', water: '#a9d6f0' },
      card: { back: 'Taco’s Christmas', treasure: 'Gift card', trick: 'Coal card', task: 'Carol card', fate: 'Snow globe' },
      kinds: {
        cat:        { title: 'Chased by a snowman!', icon: '⛄' },
        roadblock:  { title: 'Snowed in!', icon: '🌨️' },
        terror:     { title: 'Krampus spotted!', icon: '😈' },
        attack:     { title: 'Grumpy elf!', icon: '🧝' },
        ghostScare: { title: 'Brain freeze!', icon: '🥶' },
        ghostRun:   { title: 'Sled downhill!', icon: '🛷' },
        flowers:    { title: 'Found a candy cane!', icon: '🍬' },
        evilGhost:  { title: 'Avalanche!', icon: '🏔️' },
        grave:      { title: 'Buried in a snowdrift!', icon: '🧊' },
        pulledUnder:{ title: 'Stuck in the slush!', icon: '🫠' },
        swim:       { title: 'Skate to safety!', icon: '⛸️' },
        current:    { title: 'Thin ice!', icon: '❄️' },
        safe:       { title: 'Safe!', icon: '🕯️' },
        exit:       { title: "Santa's house", icon: '🏠' }
      },
      words: { card: ['GIFT', 'DROP'], start: 'Start', longer: 'Longer route', riskier: 'Riskier route', escaped: "Made it to Santa's!", results: 'Day {n} results', swim: 'Skate!' },
      routes: { longer: "Plowed paths, more maps. {n} spaces to Santa's house.", riskier: 'Shorter, but the frozen river is waiting. {n} spaces.' }
    }
  };

  // ---- cards -------------------------------------------------------------------
  // Same 20 effects in every theme, so balance stays the same. Only the words change.
  var EFFECTS = [
    { id: 'c01', cls: 'treasure', effects: [{ type: 'move', n: 2 }] },
    { id: 'c02', cls: 'treasure', effects: [{ type: 'move', n: 3 }] },
    { id: 'c03', cls: 'treasure', effects: [{ type: 'toNext', kind: 'map' }] },
    { id: 'c04', cls: 'treasure', effects: [{ type: 'again' }] },
    { id: 'c05', cls: 'treasure', effects: [{ type: 'shield' }] },
    { id: 'c06', cls: 'treasure', effects: [{ type: 'move', n: 4 }] },
    { id: 'c07', cls: 'treasure', effects: [{ type: 'move', n: 1 }] },
    { id: 'c08', cls: 'treasure', effects: [{ type: 'move', n: 2 }] },
    { id: 'c09', cls: 'trick', effects: [{ type: 'move', n: -3 }] },
    { id: 'c10', cls: 'trick', effects: [{ type: 'skip', turns: 1 }] },
    { id: 'c11', cls: 'trick', effects: [{ type: 'move', n: -2 }] },
    { id: 'c12', cls: 'trick', effects: [{ type: 'skip', turns: 1 }] },
    { id: 'c13', cls: 'trick', effects: [{ type: 'move', n: -1 }] },
    { id: 'c14', cls: 'trick', effects: [{ type: 'skip', turns: 2 }] },
    { id: 'c15', cls: 'trick', effects: [{ type: 'move', n: -2 }] },
    { id: 'c16', cls: 'task', effects: [{ type: 'task' }] },
    { id: 'c17', cls: 'task', effects: [{ type: 'task' }] },
    { id: 'c18', cls: 'task', effects: [{ type: 'move', n: 1 }, { type: 'task' }] },
    { id: 'c19', cls: 'fate', effects: [] },
    { id: 'c20', cls: 'fate', effects: [{ type: 'move', n: 2 }, { type: 'skip', turns: 1 }] }
  ];

  var WORDS = {
    cemetery: {
      c01: ['Energized', '⚡', "Chester is feeling energized. He can't wait to see his girlfriend, Hazel."],
      c02: ['Tailwind', '🌬️', 'A cold gust lifts Chester over three headstones.'],
      c03: ["Hazel's whistle", '🎵', 'Hazel whistles from the gates. Chester flies straight to the next map.'],
      c04: ['Lucky wishbone', '🍀', 'Chester finds a wishbone under the cypress tree.'],
      c05: ['Garlic necklace', '🧄', 'Nothing undead will touch Chester now.'],
      c06: ['Secret crypt passage', '🗝️', 'A loose stone slides away and opens a shortcut.'],
      c07: ['Lantern light', '🏮', 'The groundskeeper lights the path for a moment.'],
      c08: ['Raven escort', '🐦‍⬛', "Chester's cousin shows him a gap in the fence."],
      c09: ['Ghosts got you', '👻', 'Two ghosts drag Chester back toward the chapel.'],
      c10: ['Tangled in cobwebs', '🕸️', 'It takes Chester all night to get free.'],
      c11: ['Black cat', '🐈‍⬛', 'A black cat crosses his path. Chester backs away slowly.'],
      c12: ['Thick fog', '🌫️', "Chester can't see his own wings. Better wait it out."],
      c13: ['Tripped on a headstone', '🪦', 'Ouch. That one was not there a minute ago.'],
      c14: ["Witch's hex", '🧙', 'A curse freezes Chester in place.'],
      c15: ['Owl ambush', '🦉', 'An owl swoops in and Chester flees the wrong way.'],
      c16: ["The organist's request", '🎹', "The ghost organist won't let Chester pass until he hears one more song."],
      c17: ['Skeleton dance-off', '💀', 'The skeletons challenge Chester to a dance. Winner walks out.'],
      c18: ['Graveyard shift', '⛏️', 'Help the groundskeeper finish his playlist. He walks you one space closer.'],
      c19: ['Moonlit rest', '🌕', 'Chester perches on a headstone and takes in the view.'],
      c20: ['Bat swarm', '🦇', 'Bats everywhere! Chester dives ahead, then hides until morning.']
    },
    christmas: {
      c01: ['Extra cocoa', '☕', 'Santa downs a mug of cocoa and picks up the pace.'],
      c02: ['Polar tailwind', '🌬️', 'A north wind pushes the sleigh over three snowy headstones.'],
      c03: ["Rudolph's nose", '🔴', 'A bright red glow lights the way straight to the next map.'],
      c04: ['Wishbone from the feast', '🍗', 'Santa gets the bigger half. Roll again today.'],
      c05: ["Chester's lookout", '🐦‍⬛', 'Chester keeps watch from his tombstone. The next setback misses you.'],
      c06: ['Sleigh shortcut', '🛷', 'The reindeer find a gap in the cemetery fence.'],
      c07: ['Lantern on the path', '🏮', 'A glowing lantern shows the next step.'],
      c08: ['Reindeer sprint', '🦌', 'The reindeer hit top speed over the snow.'],
      c09: ['Snowball ambush', '❄️', 'The snowman gang pelts the sleigh back three spaces.'],
      c10: ['Tangled in lights', '🎄', 'It takes all night to get the sleigh untangled.'],
      c11: ['Slipped on ice', '🧊', 'The sleigh spins out and slides back two spaces.'],
      c12: ['Whiteout', '🌨️', "Santa can't see past the reindeer. Better wait it out."],
      c13: ['Dropped a shiny gift', '🎁', 'A shiny present for Chester falls off the sleigh. Back one space to grab it.'],
      c14: ['Frozen runners', '🥶', 'The sleigh is frozen to the ground for a while.'],
      c15: ['Krampus on the road', '😈', 'Krampus blocks the path and the sleigh doubles back.'],
      c16: ["The ghost carolers' request", '🎶', "The graveyard carolers won't let the sleigh pass until you play one more song."],
      c17: ['Elf dance-off', '🧝', 'The elves challenge Santa to a dance. Winner keeps the sleigh.'],
      c18: ['Polish the shiny gifts', '✨', "Help polish Chester's gifts until they sparkle. The elves move you one space closer."],
      c19: ['Quiet snowfall', '🌨️', 'Snow settles on the headstones. Santa enjoys the view.'],
      c20: ['Cookie rush', '🍪', 'Too many cookies! Santa zooms ahead, then naps it off.']
    },
    thanksgiving: {
      c01: ['Pumpkin spice latte', '☕', 'Chester sips a pumpkin spice latte and picks up the pace.'],
      c02: ['Autumn gust', '🍂', 'A gust of wind blows Chester three rows down the field.'],
      c03: ['Dinner bell', '🔔', 'The dinner bell rings. Chester flies straight to the next map.'],
      c04: ['Lucky wishbone', '🍗', 'Chester gets the bigger half. Roll again today.'],
      c05: ["Grandma's quilt", '🧶', 'Chester is wrapped up warm. The next setback misses you.'],
      c06: ['Hay wagon ride', '🚜', 'Chester hops on the hay wagon and rides four spaces.'],
      c07: ['Porch light', '🕯️', 'The farmhouse porch light shows the next step.'],
      c08: ['Flock of geese', '🦆', 'Chester joins the geese flying south for two spaces.'],
      c09: ['Scarecrow standoff', '👒', 'The scarecrow flaps its arms and Chester backs off three spaces.'],
      c10: ['Food coma', '😴', 'One plate too many. Chester sleeps through the next turn.'],
      c11: ['Slipped on leaves', '🍁', 'A wet leaf pile sends Chester sliding back two spaces.'],
      c12: ['Lost in the corn maze', '🌽', 'Every row looks the same. Better wait it out.'],
      c13: ['Dropped the pie', '🥧', 'The pie slips off the windowsill. Back one space to save it.'],
      c14: ['Dish duty', '🧽', 'Somebody has to wash all those dishes. Chester is stuck for a while.'],
      c15: ['Turkey chase', '🦃', 'An angry turkey chases Chester back two spaces.'],
      c16: ["Grandma's request", '👵', 'Grandma wants one more song before anyone touches dessert.'],
      c17: ['Pie-eating contest', '🏆', 'The cousins say the last slice goes to whoever wins this map.'],
      c18: ['Set the table', '🍴', 'Chester helps set the table and hops one space closer.'],
      c19: ['Count your blessings', '🌅', 'The sun sets over the fields. Chester takes a moment to be thankful.'],
      c20: ['Seconds on stuffing', '🥘', 'Chester zooms ahead for seconds, then naps it off.']
    },
    'taco-thanksgiving': {
      c01: ['Pumpkin spice latte', '☕', 'Taco sips a pumpkin spice latte and picks up the pace.'],
      c02: ['Autumn gust', '🍂', 'A gust of wind rolls Taco three rows down the field.'],
      c03: ['Dinner bell', '🔔', 'The dinner bell rings. Taco hurries straight to the next map.'],
      c04: ['Lucky wishbone', '🍗', 'Taco gets the bigger half. Roll again today.'],
      c05: ['Tortilla blanket', '🧣', 'Taco is wrapped up snug. The next setback misses you.'],
      c06: ['Hay wagon ride', '🚜', 'Taco hops on the hay wagon and rides four spaces.'],
      c07: ['Porch light', '🕯️', 'The farmhouse porch light shows the next step.'],
      c08: ['Flock of geese', '🦆', 'The geese let Taco tag along for two spaces.'],
      c09: ['Scarecrow standoff', '👒', 'A scarecrow flaps in the wind and Taco backs off three spaces.'],
      c10: ['Food coma', '😴', 'One plate too many. Taco sleeps through the next turn.'],
      c11: ['Slipped on leaves', '🍁', 'A wet leaf pile sends Taco sliding back two spaces.'],
      c12: ['Lost in the corn maze', '🌽', 'Every row looks the same. Better wait it out.'],
      c13: ['Spilled the salsa', '🍅', 'The salsa tips over. Back one space to clean it up.'],
      c14: ['Dish duty', '🧽', 'Somebody has to wash all those dishes. Taco is stuck for a while.'],
      c15: ['Turkey chase', '🦃', 'The turkey thinks Taco is cutting in line for dinner and chases Taco back two spaces.'],
      c16: ["Grandma's request", '👵', 'Grandma wants one more song before anyone touches dessert.'],
      c17: ['Pie-eating contest', '🏆', 'The cousins say the last slice goes to whoever wins this map.'],
      c18: ['Set the table', '🍴', 'Taco helps set the table and hops one space closer.'],
      c19: ['Count your blessings', '🌅', 'The sun sets over the fields. Taco takes a moment to be thankful.'],
      c20: ['Seconds on stuffing', '🥘', 'Taco zooms ahead for seconds, then naps it off.']
    },
    'taco-christmas': {
      c01: ['Hot cocoa', '☕', 'Taco warms up with a mug of cocoa and picks up the pace.'],
      c02: ['North wind', '🌬️', 'A north wind pushes Taco three snowy steps ahead.'],
      c03: ["Rudolph's nose", '🔴', 'A bright red glow lights the way straight to the next map.'],
      c04: ['Christmas wish', '🌟', 'Taco makes a wish on the tree topper. Roll again today.'],
      c05: ['Ugly sweater', '🧶', 'Taco bundles up in an ugly sweater. The next setback misses you.'],
      c06: ['Sled ride', '🛷', 'Taco grabs a sled and zooms four spaces downhill.'],
      c07: ['String of lights', '💡', 'A string of lights shows the next step.'],
      c08: ['Reindeer lift', '🦌', 'A friendly reindeer gives Taco a lift for two spaces.'],
      c09: ['Snowball ambush', '❄️', 'The snowman gang pelts Taco back three spaces.'],
      c10: ['Tangled in lights', '🎄', 'It takes all night to get Taco untangled.'],
      c11: ['Slipped on ice', '🧊', 'Taco spins out and slides back two spaces.'],
      c12: ['Whiteout', '🌨️', "Taco can't see a thing. Better wait it out."],
      c13: ['Dropped a present', '🎁', 'A present falls in the snow. Back one space to grab it.'],
      c14: ['Frozen solid', '🥶', 'Taco is frozen to the spot for a while.'],
      c15: ['Grumpy elf', '🧝', 'A grumpy elf sends Taco back two spaces to wait in line.'],
      c16: ['Carolers at the door', '🎶', "The carolers won't let Taco pass until you play one more song."],
      c17: ['Elf dance-off', '🕺', 'The elves challenge Taco to a dance-off. Win this map to keep going.'],
      c18: ['Wrap the presents', '✨', 'Taco helps wrap presents and the elves move you one space closer.'],
      c19: ['Silent night', '🌙', 'The snow goes quiet. Taco enjoys the view.'],
      c20: ['Cookie rush', '🍪', 'Too many cookies! Taco zooms ahead, then naps it off.']
    }
  };

  function cardsFor(themeId) {
    var w = WORDS[themeId] || WORDS.cemetery;
    return EFFECTS.map(function (e) {
      var x = w[e.id];
      return { id: e.id, cls: e.cls, title: x[0], art: x[1], text: x[2], effects: JSON.parse(JSON.stringify(e.effects)) };
    });
  }

  // Plain description of what a card or space does.
  function effectText(fx) {
    switch (fx.type) {
      case 'move': return fx.n > 0 ? 'Move forward ' + fx.n + (fx.n === 1 ? ' space' : ' spaces') : 'Move back ' + (-fx.n) + (fx.n === -1 ? ' space' : ' spaces');
      case 'skip': return fx.turns > 1 ? 'Lose ' + fx.turns + ' turns' : 'Lose a turn';
      case 'again': return 'Roll again today';
      case 'shield': return 'Ignore the next thing that sets you back';
      case 'task': return 'Play a bonus map before your next roll';
      case 'toNext': return 'Jump ahead to the next map space';
      default: return 'Nothing happens';
    }
  }
  function cardEffectText(card) {
    if (!card.effects || !card.effects.length) return 'Nothing happens';
    return card.effects.map(function (fx, i) { var t = effectText(fx); return i ? t.charAt(0).toLowerCase() + t.slice(1) : t; }).join(', then ');
  }
  function spaceEffectText(sp) {
    switch (sp.type) {
      case 'map': return sp.bsr.length > 1 ? 'Play one of these maps' : 'Play this map';
      case 'task': return 'Play this map to continue';
      case 'card': return 'Draw a card';
      case 'move': return sp.n > 0 ? 'Move ahead ' + sp.n + ' spaces' : 'Back up ' + (-sp.n) + ' spaces';
      case 'skip': return sp.turns > 1 ? 'Lose ' + sp.turns + ' turns' : 'Lose a turn';
      case 'start': return 'Return to start';
      case 'warp': return 'Carried to another space';
      case 'safe': return 'Catch your breath';
      case 'exit': return 'Escape!';
      default: return '';
    }
  }

  root.CGContent = {
    CELL: CELL, PAD: PAD,
    boards: { 'chester-escape': buildBoard },
    themes: THEMES,
    cardsFor: cardsFor,
    effectText: effectText, cardEffectText: cardEffectText, spaceEffectText: spaceEffectText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CGContent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
