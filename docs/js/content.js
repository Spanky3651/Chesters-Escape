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
    "taco-halloween": {
      id: "taco-halloween",
      family: 'taco',
      name: "Taco's Halloween",
      title: "Taco's Halloween",
      tagline: "Help Taco reach the haunted house.",
      goal: "haunted house",
      font: "'Creepster', Georgia, serif",
      fontQuery: "Creepster",
      hero: 'taco',
      hat: "witch",
      look: "halloween",
      art: "img/themes/taco-halloween.jpg?v=20261020",   // Hummingbird's board art, title included
      artHero: {"src": "img/themes/taco-halloween-taco.png?v=20261020", "x": 117.22, "y": 55.02, "w": 90.91, "h": 78.15, "move": "hop"},
      banner: ["#ff8a2b", "#2a1040"],
      palette: {"ground": "#b9a3e3", "ground2": "#7d62b8", "stone": "#fff8ef", "stoneDark": "#8a6fb0", "ink": "#3b1d4a", "accent": "#ff8a2b", "good": "#4caf50", "bad": "#8e44ad", "water": "#7d62b8"},
      card: {"back": "Taco’s Halloween", "treasure": "Treat card", "trick": "Trick card", "task": "Spell card", "fate": "Potion card"},
      kinds: {
        cat: { title: "Chased by a black cat!", icon: "🐈‍⬛" },
        roadblock: { title: "Pumpkin pileup!", icon: "🎃" },
        terror: { title: "A witch spotted you!", icon: "🧙" },
        attack: { title: "Bat swarm!", icon: "🦇" },
        ghostScare: { title: "Spooked by a ghost!", icon: "👻" },
        ghostRun: { title: "Run from the ghost!", icon: "🏃" },
        flowers: { title: "Found candy!", icon: "🍬" },
        evilGhost: { title: "Zombie chase!", icon: "🧟" },
        grave: { title: "Fell in a grave!", icon: "⚰️" },
        pulledUnder: { title: "Caught in a spider web!", icon: "🕸️" },
        swim: { title: "Broom ride to safety!", icon: "🧹" },
        current: { title: "Swept into the fog!", icon: "🌫️" },
        safe: { title: "Safe!", icon: "🕯️" },
        exit: { title: "Haunted house", icon: "🏚️" }
      },
      words: {"card": ["CANDY", "DROP"], "start": "Start", "longer": "Longer route", "riskier": "Riskier route", "escaped": "Made it to the haunted house!", "results": "Day {n} results", "swim": "Fly!"},
      routes: {"longer": "The long way around, more maps. {n} spaces to the haunted house.", "riskier": "Shorter, but the ghosts are waiting. {n} spaces."}
    },
    "taco-thanksgiving": {
      id: "taco-thanksgiving",
      family: 'taco',
      name: "Taco's Thanksgiving",
      title: "Taco's Thanksgiving",
      tagline: "Help Taco get to Thanksgiving dinner.",
      goal: "dinner table",
      font: "'Cherry Swash', Georgia, serif",
      fontQuery: "Cherry+Swash:wght@700",
      hero: 'taco',
      hat: "pilgrim",
      look: "thanksgiving",
      art: "img/themes/taco-thanksgiving.jpg?v=20261020",   // Hummingbird's board art, title included
      mapSet: 'taco-thanksgiving',   // Taco's Thanksgiving playlist, 50 maps
      artHero: {"src": "img/themes/taco-thanksgiving-taco.png?v=20261020", "x": 126.0, "y": 122.01, "w": 121.21, "h": 79.74, "move": "hop"},
      banner: ["#d9661f", "#fff4dc"],
      palette: {"ground": "#f3d27a", "ground2": "#d9a24a", "stone": "#fff7e6", "stoneDark": "#9a6a2e", "ink": "#4a2a10", "accent": "#d9661f", "good": "#4f8a2b", "bad": "#b23a1c", "water": "#5f9bbd"},
      card: {"back": "Taco’s Thanksgiving", "treasure": "Harvest card", "trick": "Leftovers card", "task": "Chore card", "fate": "Wishbone card"},
      kinds: {
        cat: { title: "Chased by the farm cat!", icon: "🐈" },
        roadblock: { title: "Hay bales block the road!", icon: "🌾" },
        terror: { title: "The farmer saw you!", icon: "🧑‍🌾" },
        attack: { title: "Angry turkey!", icon: "🦃" },
        ghostScare: { title: "Spooked by a scarecrow!", icon: "👒" },
        ghostRun: { title: "Ride the hay wagon!", icon: "🚜" },
        flowers: { title: "Found a corn cob!", icon: "🌽" },
        evilGhost: { title: "Cow stampede!", icon: "🐄" },
        grave: { title: "Fell in the mud pit!", icon: "🐖" },
        pulledUnder: { title: "Stuck in the cranberry bog!", icon: "🥾" },
        swim: { title: "Hop the stepping stones!", icon: "🪨" },
        current: { title: "Swept down the creek!", icon: "🌊" },
        safe: { title: "Safe!", icon: "🍂" },
        exit: { title: "Thanksgiving dinner", icon: "🍽️" }
      },
      words: {"card": ["PIE", "DROP"], "start": "Start", "longer": "Longer route", "riskier": "Riskier route", "escaped": "Made it to dinner!", "results": "Day {n} results", "swim": "Hop across!"},
      routes: {"longer": "Through the fields, more maps. {n} spaces to dinner.", "riskier": "Shorter, but the creek is waiting. {n} spaces."}
    },
    "taco-christmas": {
      id: "taco-christmas",
      family: 'taco',
      name: "Taco's Christmas",
      title: "Taco's Christmas",
      tagline: "Help Taco get to Santa's house.",
      goal: "North Pole",
      font: "'Mountains of Christmas', Georgia, serif",
      fontQuery: "Mountains+of+Christmas:wght@700",
      hero: 'taco',
      hat: "santa",
      look: "christmas",
      art: "img/themes/taco-christmas.jpg?v=20261020",   // Hummingbird's board art, title included
      artHero: {"src": "img/themes/taco-christmas-taco.png?v=20261020", "x": 74.96, "y": 66.99, "w": 146.73, "h": 114.04, "move": "hill", "clip": "M47.0,35.1 L248.0,35.1 L248.0,190.0 L244.8,189.0 L241.6,187.9 L238.4,187.0 L235.2,186.0 L232.1,185.1 L228.9,184.2 L225.7,183.4 L222.5,182.5 L219.3,181.7 L216.1,181.0 L212.9,180.2 L209.7,179.5 L206.5,178.8 L203.3,178.2 L200.2,177.6 L197.0,177.0 L193.8,176.5 L190.6,175.9 L187.4,175.4 L184.2,175.0 L181.0,174.5 L177.8,174.1 L174.6,173.8 L171.5,173.4 L168.3,173.1 L165.1,172.8 L161.9,172.6 L158.7,172.4 L155.5,172.2 L152.3,172.0 L149.1,171.9 L145.9,171.8 L142.7,171.7 L139.6,171.7 L136.4,171.7 L133.2,171.7 L130.0,171.8 L126.8,171.9 L123.6,172.0 L120.4,172.1 L117.2,172.3 L114.0,172.5 L110.8,172.7 L107.7,173.0 L104.5,173.3 L101.3,173.6 L98.1,174.0 L94.9,174.4 L91.7,174.8 L88.5,175.2 L85.3,175.7 L82.1,176.2 L78.9,176.8 L75.8,177.3 L72.6,177.9 L69.4,178.6 L66.2,179.2 L63.0,179.9 L59.8,180.7 L56.6,181.4 L53.4,182.2 L50.2,183.0 L47.0,183.9 Z"},
      banner: ["#d7263d", "#fff"],
      palette: {"ground": "#e9f1f7", "ground2": "#c9dbe8", "stone": "#ffffff", "stoneDark": "#9db4c6", "ink": "#24384a", "accent": "#d7263d", "good": "#2fb35a", "bad": "#3a6ea5", "water": "#a9d6f0"},
      card: {"back": "Taco’s Christmas", "treasure": "Gift card", "trick": "Coal card", "task": "Carol card", "fate": "Snow globe"},
      kinds: {
        cat: { title: "Chased by a snowman!", icon: "⛄" },
        roadblock: { title: "Snowed in!", icon: "🌨️" },
        terror: { title: "Krampus spotted!", icon: "😈" },
        attack: { title: "Grumpy elf!", icon: "🧝" },
        ghostScare: { title: "Brain freeze!", icon: "🥶" },
        ghostRun: { title: "Sled downhill!", icon: "🛷" },
        flowers: { title: "Found a candy cane!", icon: "🍬" },
        evilGhost: { title: "Avalanche!", icon: "🏔️" },
        grave: { title: "Buried in a snowdrift!", icon: "🧊" },
        pulledUnder: { title: "Stuck in the slush!", icon: "🫠" },
        swim: { title: "Skate to safety!", icon: "⛸️" },
        current: { title: "Thin ice!", icon: "❄️" },
        safe: { title: "Safe!", icon: "🕯️" },
        exit: { title: "Santa's house", icon: "🏠" }
      },
      words: {"card": ["GIFT", "DROP"], "start": "Start", "longer": "Longer route", "riskier": "Riskier route", "escaped": "Made it to Santa's!", "results": "Day {n} results", "swim": "Skate!"},
      routes: {"longer": "Plowed paths, more maps. {n} spaces to Santa's house.", "riskier": "Shorter, but the frozen river is waiting. {n} spaces."}
    },
    "taco-newyear": {
      id: "taco-newyear",
      family: 'taco',
      name: "Taco's New Year",
      title: "Taco's New Year",
      tagline: "Help Taco reach the midnight party.",
      goal: "midnight party",
      font: "'Sniglet', system-ui, sans-serif",
      fontQuery: "Sniglet:wght@800",
      hero: 'taco',
      hat: "party",
      look: "newyear",
      art: "img/themes/taco-newyear.jpg?v=20261020",   // Hummingbird's board art, title included
      artHero: {"src": "img/themes/taco-newyear-taco.png?v=20261020", "x": 77.35, "y": 94.9, "w": 130.78, "h": 101.28, "move": "hill", "clip": "M49.4,63.0 L234.4,63.0 L234.4,201.3 L231.3,200.2 L228.1,199.2 L224.9,198.3 L221.7,197.3 L218.5,196.4 L215.3,195.6 L212.1,194.7 L208.9,193.9 L205.7,193.1 L202.6,192.4 L199.4,191.7 L196.2,191.0 L193.0,190.4 L189.8,189.8 L186.6,189.2 L183.4,188.7 L180.2,188.1 L177.0,187.7 L173.8,187.2 L170.7,186.8 L167.5,186.4 L164.3,186.1 L161.1,185.8 L157.9,185.5 L154.7,185.2 L151.5,185.0 L148.3,184.8 L145.1,184.6 L141.9,184.5 L138.8,184.4 L135.6,184.4 L132.4,184.3 L129.2,184.3 L126.0,184.4 L122.8,184.5 L119.6,184.6 L116.4,184.7 L113.2,184.9 L110.0,185.1 L106.9,185.3 L103.7,185.6 L100.5,185.9 L97.3,186.2 L94.1,186.5 L90.9,186.9 L87.7,187.4 L84.5,187.8 L81.3,188.3 L78.1,188.8 L75.0,189.4 L71.8,190.0 L68.6,190.6 L65.4,191.2 L62.2,191.9 L59.0,192.6 L55.8,193.4 L52.6,194.2 L49.4,195.0 Z"},
      banner: ["#f2c046", "#1d2350"],
      palette: {"ground": "#c7d3f2", "ground2": "#8fa3d8", "stone": "#ffffff", "stoneDark": "#8d97c4", "ink": "#1d2350", "accent": "#f2c046", "good": "#2fb35a", "bad": "#5b6cff", "water": "#8fb7e8"},
      card: {"back": "Taco’s New Year", "treasure": "Sparkler card", "trick": "Fizzle card", "task": "Resolution card", "fate": "Countdown card"},
      kinds: {
        cat: { title: "Chased by a snow dog!", icon: "🐕" },
        roadblock: { title: "Snowed in!", icon: "🌨️" },
        terror: { title: "Party pooper!", icon: "😒" },
        attack: { title: "Popped balloon!", icon: "🎈" },
        ghostScare: { title: "Fell asleep early!", icon: "😴" },
        ghostRun: { title: "Sled to the party!", icon: "🛷" },
        flowers: { title: "Found a party hat!", icon: "🥳" },
        evilGhost: { title: "Avalanche!", icon: "🏔️" },
        grave: { title: "Missed the last bus!", icon: "🚌" },
        pulledUnder: { title: "Stuck in the slush!", icon: "🫠" },
        swim: { title: "Skate across the lake!", icon: "⛸️" },
        current: { title: "Thin ice!", icon: "❄️" },
        safe: { title: "Safe!", icon: "✨" },
        exit: { title: "Midnight party", icon: "🎉" }
      },
      words: {"card": ["PARTY", "DROP"], "start": "Start", "longer": "Longer route", "riskier": "Riskier route", "escaped": "Made it by midnight!", "results": "Day {n} results", "swim": "Skate!"},
      routes: {"longer": "The long way through the snow, more maps. {n} spaces to the party.", "riskier": "Shorter, but the frozen lake is waiting. {n} spaces."}
    },
    "taco-valentine": {
      id: "taco-valentine",
      family: 'taco',
      name: "Taco's Valentine's Day",
      title: "Taco's Valentine's Day",
      tagline: "Help Taco deliver a valentine.",
      goal: "mailbox",
      font: "'Pacifico', Georgia, serif",
      fontQuery: "Pacifico",
      hero: 'taco',
      hat: "heart",
      look: "valentine",
      art: "img/themes/taco-valentine.jpg?v=20261020",   // Hummingbird's board art, title included
      artHero: {"src": "img/themes/taco-valentine-taco.png?v=20261020", "x": 137.16, "y": 120.41, "w": 120.41, "h": 70.18, "move": "hop"},
      banner: ["#ff4d6d", "#fff0f4"],
      palette: {"ground": "#ffd6e0", "ground2": "#f7a8bd", "stone": "#ffffff", "stoneDark": "#d68aa0", "ink": "#7a1030", "accent": "#ff4d6d", "good": "#2fb35a", "bad": "#c2185b", "water": "#f7a8bd"},
      card: {"back": "Taco’s Valentine’s Day", "treasure": "Sweetheart card", "trick": "Heartbreak card", "task": "Love note card", "fate": "Cupid card"},
      kinds: {
        cat: { title: "Chased by a kitten!", icon: "🐱" },
        roadblock: { title: "Rose bushes block the path!", icon: "🌹" },
        terror: { title: "Cupid missed!", icon: "💘" },
        attack: { title: "Jealous pigeon!", icon: "🐦" },
        ghostScare: { title: "Got shy!", icon: "😳" },
        ghostRun: { title: "Run to the mailbox!", icon: "🏃" },
        flowers: { title: "Found a bouquet!", icon: "💐" },
        evilGhost: { title: "Lost the valentine!", icon: "💔" },
        grave: { title: "Back to write a new one!", icon: "✍️" },
        pulledUnder: { title: "Stuck in the snow!", icon: "☃️" },
        swim: { title: "Hop the stones!", icon: "🪨" },
        current: { title: "Blown away by the wind!", icon: "🌬️" },
        safe: { title: "Safe!", icon: "💗" },
        exit: { title: "Valentine mailbox", icon: "📮" }
      },
      words: {"card": ["HEART", "DROP"], "start": "Start", "longer": "Longer route", "riskier": "Riskier route", "escaped": "Valentine delivered!", "results": "Day {n} results", "swim": "Hop!"},
      routes: {"longer": "The scenic way, more maps. {n} spaces to the mailbox.", "riskier": "Shorter, but the wind is waiting. {n} spaces."}
    },
    "taco-easter": {
      id: "taco-easter",
      family: 'taco',
      name: "Taco's Easter",
      title: "Taco's Easter",
      tagline: "Help Taco find the Easter basket.",
      goal: "Easter basket",
      font: "'Sniglet', system-ui, sans-serif",
      fontQuery: "Sniglet:wght@800",
      hero: 'taco',
      hat: "bunny",
      look: "spring",
      art: "img/themes/taco-easter.jpg?v=20261020",   // Hummingbird's board art, title included
      artHero: {"src": "img/themes/taco-easter-taco.png?v=20261020", "x": 76.56, "y": 87.72, "w": 125.2, "h": 113.24, "move": "hill", "clip": "M48.6,55.8 L227.3,55.8 L227.3,181.3 L224.1,181.8 L220.9,182.3 L217.7,182.8 L214.5,183.3 L211.3,183.7 L208.1,184.2 L204.9,184.7 L201.8,185.1 L198.6,185.5 L195.4,186.0 L192.2,186.4 L189.0,186.8 L185.8,187.2 L182.6,187.6 L179.4,188.0 L176.2,188.4 L173.0,188.8 L169.9,189.1 L166.7,189.5 L163.5,189.8 L160.3,190.2 L157.1,190.5 L153.9,190.9 L150.7,191.2 L147.5,191.5 L144.3,191.8 L141.1,192.1 L138.0,192.4 L134.8,192.6 L131.6,192.9 L128.4,193.2 L125.2,193.4 L122.0,193.7 L118.8,193.9 L115.6,194.2 L112.4,194.4 L109.3,194.6 L106.1,194.8 L102.9,195.0 L99.7,195.2 L96.5,195.4 L93.3,195.6 L90.1,195.7 L86.9,195.9 L83.7,196.0 L80.5,196.2 L77.4,196.3 L74.2,196.4 L71.0,196.6 L67.8,196.7 L64.6,196.8 L61.4,196.9 L58.2,197.0 L55.0,197.0 L51.8,197.1 L48.6,197.2 Z"},
      banner: ["#e75480", "#fff"],
      palette: {"ground": "#c9e98a", "ground2": "#8cc152", "stone": "#ffffff", "stoneDark": "#8fb06a", "ink": "#2f4a1d", "accent": "#e75480", "good": "#3fa34d", "bad": "#e75480", "water": "#7fc8f8"},
      card: {"back": "Taco’s Easter", "treasure": "Egg card", "trick": "Rain card", "task": "Hunt card", "fate": "Basket card"},
      kinds: {
        cat: { title: "Chased by a puppy!", icon: "🐶" },
        roadblock: { title: "Spring shower!", icon: "🌧️" },
        terror: { title: "The gardener saw you!", icon: "🧑‍🌾" },
        attack: { title: "Angry goose!", icon: "🦆" },
        ghostScare: { title: "A bee buzzed by!", icon: "🐝" },
        ghostRun: { title: "Hop like a bunny!", icon: "🐇" },
        flowers: { title: "Found an egg!", icon: "🥚" },
        evilGhost: { title: "Lamb stampede!", icon: "🐑" },
        grave: { title: "Fell in a rabbit hole!", icon: "🕳️" },
        pulledUnder: { title: "Stuck in the mud!", icon: "🥾" },
        swim: { title: "Hop the stones!", icon: "🪨" },
        current: { title: "Swept down the stream!", icon: "🌊" },
        safe: { title: "Safe!", icon: "🌷" },
        exit: { title: "Easter basket", icon: "🧺" }
      },
      words: {"card": ["EGG", "DROP"], "start": "Start", "longer": "Longer route", "riskier": "Riskier route", "escaped": "Found the basket!", "results": "Day {n} results", "swim": "Hop!"},
      routes: {"longer": "Across the meadow, more maps. {n} spaces to the basket.", "riskier": "Shorter, but the stream is waiting. {n} spaces."}
    },
    "taco-summer": {
      id: "taco-summer",
      family: 'taco',
      name: "Taco's Summer",
      title: "Taco's Summer",
      tagline: "Help Taco reach the beach party.",
      goal: "beach party",
      font: "'Sniglet', system-ui, sans-serif",
      fontQuery: "Sniglet:wght@800",
      hero: 'taco',
      hat: "shades",
      look: "summer",
      art: "img/themes/taco-summer.jpg?v=20261020",   // Hummingbird's board art, title included
      artHero: {"src": "img/themes/taco-summer-taco.png?v=20261020", "x": 102.87, "y": 126.0, "w": 130.78, "h": 66.99, "move": "hop"},
      banner: ["#ffb703", "#0b4f6c"],
      palette: {"ground": "#f6dfae", "ground2": "#e8c27f", "stone": "#ffffff", "stoneDark": "#c9a46a", "ink": "#0b4f6c", "accent": "#ffb703", "good": "#2fb35a", "bad": "#ff7b00", "water": "#3ab0e2"},
      card: {"back": "Taco’s Summer", "treasure": "Sunshine card", "trick": "Sunburn card", "task": "Beach card", "fate": "Seashell card"},
      kinds: {
        cat: { title: "Chased by a seagull!", icon: "🐦" },
        roadblock: { title: "Sandcastle in the way!", icon: "🏰" },
        terror: { title: "Lifeguard whistle!", icon: "🛟" },
        attack: { title: "Crab pinch!", icon: "🦀" },
        ghostScare: { title: "Sunburn!", icon: "🥵" },
        ghostRun: { title: "Ride a wave!", icon: "🏄" },
        flowers: { title: "Found a seashell!", icon: "🐚" },
        evilGhost: { title: "Big wave!", icon: "🌊" },
        grave: { title: "Buried in the sand!", icon: "🏖️" },
        pulledUnder: { title: "Stuck in the sand!", icon: "🩴" },
        swim: { title: "Swim to safety!", icon: "🏊" },
        current: { title: "Rip current!", icon: "🌀" },
        safe: { title: "Safe!", icon: "🌴" },
        exit: { title: "Beach party", icon: "🎉" }
      },
      words: {"card": ["SUN", "DROP"], "start": "Start", "longer": "Longer route", "riskier": "Riskier route", "escaped": "Made it to the party!", "results": "Day {n} results", "swim": "Swim!"},
      routes: {"longer": "Down the boardwalk, more maps. {n} spaces to the party.", "riskier": "Shorter, but the waves are waiting. {n} spaces."}
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
    },
    "taco-halloween": {
      c01: ["Full-size candy bar", "🍫", "Taco scores the good stuff and picks up the pace."],
      c02: ["Broom ride", "🧹", "A friendly witch gives Taco a lift three spaces."],
      c03: ["Jack-o-lantern glow", "🎃", "The pumpkin lights the way straight to the next map."],
      c04: ["Lucky black cat", "🐈‍⬛", "This one is good luck. Roll again today."],
      c05: ["Garlic necklace", "🧄", "Nothing spooky gets close. The next setback misses you."],
      c06: ["Haunted hayride", "🚜", "Taco hops on the hayride for four spaces."],
      c07: ["Candle in the window", "🕯️", "A little light shows the next step."],
      c08: ["Friendly ghost", "👻", "A friendly ghost floats Taco two spaces ahead."],
      c09: ["Wrong house", "🏠", "No candy here. Taco backs up three spaces."],
      c10: ["Candy coma", "🍭", "Too much candy. Taco sits out the next turn."],
      c11: ["Spider drop", "🕷️", "A spider lands on Taco, who jumps back two spaces."],
      c12: ["Lost in the fog", "🌫️", "Taco can't see the path. Better wait it out."],
      c13: ["Spilled the candy bag", "🛍️", "Back one space to pick it all up."],
      c14: ["Wrapped like a mummy", "🧻", "It takes a while to get Taco unwrapped."],
      c15: ["Haunted mirror", "🪞", "Taco sees something spooky and runs back two spaces."],
      c16: ["Witch's spell", "🔮", "The witch lifts the spell after you play one more song."],
      c17: ["Costume contest", "🎭", "Win this map to take home the costume prize."],
      c18: ["Hand out candy", "🍬", "Taco hands out candy at the door and hops one space closer."],
      c19: ["Full moon", "🌕", "Taco howls at the moon. Nothing happens."],
      c20: ["Sugar rush", "⚡", "Taco zooms ahead on candy, then crashes."]
    },
    "taco-newyear": {
      c01: ["Party playlist", "🎶", "The perfect song comes on and Taco picks up the pace."],
      c02: ["Firework boost", "🎆", "A firework lights up the sky and Taco dashes three spaces."],
      c03: ["Party invite", "💌", "The invite has a map on it. Jump ahead to the next map."],
      c04: ["Lucky charm", "🍀", "A new year, a new chance. Roll again today."],
      c05: ["Cozy scarf", "🧣", "Bundled up for the cold. The next setback misses you."],
      c06: ["Party bus", "🚌", "Taco catches the party bus and rides four spaces."],
      c07: ["Sparkler light", "✨", "A sparkler shows the next step."],
      c08: ["Confetti cannon", "🎊", "The confetti cannon blasts Taco two spaces ahead."],
      c09: ["Wrong turn", "🧭", "Taco follows the wrong fireworks and backs up three spaces."],
      c10: ["Sugar crash", "🍭", "Too many party snacks. Taco sits out the next turn."],
      c11: ["Slipped on confetti", "🎉", "Taco slides back two spaces on a pile of confetti."],
      c12: ["Lost the party hat", "🎩", "Taco goes back to look for it. Better wait it out."],
      c13: ["Dropped the noisemaker", "📯", "Back one space to pick it up."],
      c14: ["Stuck in traffic", "🚗", "Everyone is heading to the party. Taco is stuck for a while."],
      c15: ["Popped balloon", "🎈", "The bang startles Taco back two spaces."],
      c16: ["Party request", "🎤", "The DJ wants one more song before Taco gets in."],
      c17: ["New Year resolution", "📝", "Taco promised to play more maps this year. Time to start."],
      c18: ["Help set up", "🪩", "Taco hangs the disco ball and hops one space closer."],
      c19: ["Make a wish", "🌠", "Taco watches a shooting star and makes a wish."],
      c20: ["Midnight sprint", "⏰", "Taco races ahead for the countdown, then needs a nap."]
    },
    "taco-valentine": {
      c01: ["Chocolate box", "🍫", "One chocolate and Taco picks up the pace."],
      c02: ["Cupid's arrow", "💘", "Cupid gives Taco a lift three spaces."],
      c03: ["Love letter", "💌", "The address points straight to the next map."],
      c04: ["Two hearts", "💕", "A sweet surprise. Roll again today."],
      c05: ["Warm hug", "🤗", "Taco feels loved. The next setback misses you."],
      c06: ["Bike for two", "🚲", "Taco rides along for four spaces."],
      c07: ["Candle glow", "🕯️", "A candle shows the next step."],
      c08: ["Heart balloon", "🎈", "A heart balloon floats Taco two spaces ahead."],
      c09: ["Wrong address", "📭", "Taco has to turn back three spaces."],
      c10: ["Too many sweets", "🍬", "Taco sits out the next turn."],
      c11: ["Dropped the roses", "🥀", "Taco goes back two spaces to pick them up."],
      c12: ["Lost in thought", "💭", "Taco is daydreaming. Better wait it out."],
      c13: ["Smudged the card", "✏️", "Back one space to fix it."],
      c14: ["Line at the flower shop", "💐", "Everyone needs flowers today. Taco is stuck for a while."],
      c15: ["Heartbreak", "💔", "A sad song plays and Taco walks back two spaces."],
      c16: ["Serenade", "🎻", "Taco needs one more song to set the mood."],
      c17: ["Dance contest", "💃", "Win this map to win the dance."],
      c18: ["Write a poem", "📜", "Taco writes a sweet poem and hops one space closer."],
      c19: ["Starry night", "🌙", "Taco looks up at the stars and smiles."],
      c20: ["Candy hearts", "💝", "Taco zooms ahead on candy hearts, then naps it off."]
    },
    "taco-easter": {
      c01: ["Jelly beans", "🍬", "A handful of jelly beans and Taco picks up the pace."],
      c02: ["Spring breeze", "🌬️", "A warm breeze carries Taco three spaces."],
      c03: ["Egg trail", "🥚", "A trail of eggs leads straight to the next map."],
      c04: ["Four-leaf clover", "🍀", "Lucky find. Roll again today."],
      c05: ["Bunny ears", "🐰", "Taco hears trouble coming. The next setback misses you."],
      c06: ["Wheelbarrow ride", "🌻", "The gardener wheels Taco four spaces."],
      c07: ["Butterfly guide", "🦋", "A butterfly shows the next step."],
      c08: ["Bunny hop", "🐇", "Taco hops two spaces like a bunny."],
      c09: ["Rain shower", "🌧️", "Taco runs back three spaces to find cover."],
      c10: ["Chocolate nap", "🍫", "Too much chocolate. Taco sits out the next turn."],
      c11: ["Muddy puddle", "💦", "Taco slips back two spaces."],
      c12: ["Lost in the tall grass", "🌾", "Every way looks the same. Better wait it out."],
      c13: ["Cracked an egg", "🍳", "Oops. Back one space to clean it up."],
      c14: ["Garden duty", "🪴", "The gardener needs help planting. Taco is stuck for a while."],
      c15: ["Bee chase", "🐝", "A bee chases Taco back two spaces."],
      c16: ["Egg hunt", "🔍", "The kids say you need one more song to join the hunt."],
      c17: ["Egg painting contest", "🎨", "Win this map to take the prize for best egg."],
      c18: ["Fill the baskets", "🧺", "Taco helps fill the baskets and hops one space closer."],
      c19: ["Spring blossoms", "🌸", "The blossoms smell great. Taco stops to enjoy them."],
      c20: ["Sugar rush", "🍭", "Taco zooms ahead on candy, then naps it off."]
    },
    "taco-summer": {
      c01: ["Cold lemonade", "🍋", "A cold lemonade and Taco picks up the pace."],
      c02: ["Ocean breeze", "🌬️", "The breeze pushes Taco three spaces."],
      c03: ["Treasure map", "🗺️", "The map leads straight to the next map space."],
      c04: ["Lucky starfish", "⭐", "Lucky find. Roll again today."],
      c05: ["Sunscreen", "🧴", "Taco is covered. The next setback misses you."],
      c06: ["Surfboard ride", "🏄", "Taco catches a wave for four spaces."],
      c07: ["Tiki torch", "🔥", "A tiki torch lights the next step."],
      c08: ["Beach ball bounce", "🏐", "The beach ball bounces Taco two spaces ahead."],
      c09: ["Seagull steals a chip", "🐦", "Taco chases it back three spaces."],
      c10: ["Hammock nap", "😴", "Taco sits out the next turn."],
      c11: ["Hot sand", "🥵", "Ouch! Taco hops back two spaces."],
      c12: ["Lost a flip-flop", "🩴", "Taco has to find it. Better wait it out."],
      c13: ["Dropped the ice cream", "🍦", "Back one space to save it."],
      c14: ["Buried in the sand", "🏖️", "The kids buried Taco. Stuck for a while."],
      c15: ["Crab chase", "🦀", "A crab chases Taco back two spaces."],
      c16: ["Beach DJ", "🎧", "The DJ wants one more song before the party starts."],
      c17: ["Sandcastle contest", "🏰", "Win this map to win the sandcastle contest."],
      c18: ["Set up the umbrella", "⛱️", "Taco helps set up the umbrella and hops one space closer."],
      c19: ["Sunset", "🌅", "Taco watches the sun go down over the water."],
      c20: ["Snow cone rush", "🍧", "Taco zooms ahead for a snow cone, then naps it off."]
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

  // ---- map sets -----------------------------------------------------------------
  // Another set of songs for the same board: a map key for every map and blocker space
  // (by space id) and its own bonus maps. A theme or a clan picks one; the layout is unchanged.
  var MAP_SETS = {
    // Taco's Thanksgiving maps for the Beaters board (Oct 25, 2026): Thanksgiving, food, family and
    // friends songs, unranked. Spread for fairness: both routes get the same average song length and
    // density, every d4 roll reaches a similar mix, and no mapper repeats back to back. The 7 lightest
    // songs are the bonus maps.
    'taco-thanksgiving': {
      title: "Taco's Thanksgiving",
      author: 'hummingbird',
      authorUrl: 'https://beatleader.com/u/76561198786758592',
      authorBl: '76561198786758592',
      authorAvatar: 'https://cdn.assets.beatleader.com/76561198786758592R27.png',
      credit: 'Every map on this board was picked to the song rules hummingbird set for this game. The spaces were then balanced so both routes play fair.',
      spaces: {
        L1: ['1672e'],   // Peanut Butter Jelly (Halcyon12 & JohnnyDee, 3:24)
        L2: ['15a5b'],   // All My Friends (officialMECH, 3:26)
        L3: ['79db'],   // Chicken Soup (xScaramouche, 3:30)
        L5: ['3aaf'],   // Cool Friends (Murtagh & Veschell Remix) (WolfBeats, 4:01)
        L6: ['94d2'],   // Boogie Oogie Oogie (TechButterfly, 3:45)
        L8: ['4bc3f'],   // Sugar (Andynak, 3:24)
        L9: ['30890'],   // Magical Girl and Chocolate (Kerokichi, 3:09)
        L10: ['4eb7f'],   // Candy (Bellus, 1:56)
        L11: ['43f4c'],   // Sugar (Najoko, 3:41)
        L13: ['193c1'],   // Sunset Tea Cup (Kival Evan & shad, 3:06)
        L14: ['7d93'],   // FRIENDS (fruhead, 3:26)
        L16: ['30c23'],   // Sugar Rush Ride (eurnkung, 3:08)
        L17: ['3d69b'],   // The Phoenix (Kival Evan, 4:05)
        L18: ['1abb5'],   // Cha Kai Mook (Bubble Tea) (NoteIIEvil, 4:11)
        L19: ['547a7'],   // COOK (TheGeriatricJedi, 2:52)
        L20: ['38930'],   // Chasing That Feeling (eurnkung, 3:04)
        L22: ['e0ac'],   // Fall for the Team (ConnorJC, 3:14)
        L24: ['ae5f'],   // BUBBLE TEA (officialMECH, 2:36)
        L25: ['7468'],   // What a Fool Believes (TechButterfly, 3:38)
        L26: ['a68b'],   // Bad Apple!! (Bloodcloak, 6:10)
        L27: ['4024b'],   // Sweet Dreams (eurnkung, 3:11)
        L28: ['184ba'],   // Butter (aggrogahu & SimplyMarvellous, 2:44)
        L30: ['1f078'],   // Sharing The World (Danrabomb, 4:08)
        L31: ['1194'],   // Honey I\'m Good (Ayeywn, 3:14)
        L32: ['248e'],   // Dance, Dance (Skyler Wallace, 3:02)
        L33: ['339bb'],   // Chocolate Adventure (rinka_michibiki, 3:26)
        L35: ['3ea'],   // Welcome to the Family (Invidia, 3:47)
        L36: ['2452d'],   // ABC Chak Kra Took (NoteIIEvil, 2:22)
        L38: ['1669'],   // Donut Hole feat. Gumi (Todokete, 3:30)
        R1: ['36f1f'],   // Honey or Spice (Bellus, 3:04)
        R3: ['26ee5'],   // Together (minsiii, 3:46)
        R5: ['1ccdb'],   // LALISA & friends "A Kpop RAP ATTACK" (Nuggetz, 3:19)
        R7: ['32c72'],   // Sweet Juice (fatahkent, 3:15)
        R9: ['b005'],   // Mission Accomplished (Wolfb, 4:19)
        R10: ['4ee5b'],   // Wannabe (grizlor, 2:48)
        R12: ['1ff9c'],   // Koisuru Fortune Cookie (NoteIIEvil, 4:48)
        R13: ['36f01'],   // CAKE (Jonas, 3:21)
        R15: ['32e02'],   // Sugar Rush (winteredge, 3:11)
        R16: ['27a13'],   // The Middle (TetsuBeats, 2:49)
        R19: ['15db5'],   // Powersnake (DNQ, 3:46)
        R21: ['8e13'],   // Brotherswing (Booj, 3:43)
        R22: ['1cd24'],   // Taco Tuesday (ODC, 2:14)
        s2: ['a751']   // Virtual Friends (Skyler Wallace, 3:38)
      },
      bonusMaps: ['19000', '22b2d', '31c05', '36312', 'bbb', '41f8b', '10c24']
    }
  }; /*MAPSETS*/

  // The board with a map set's songs in it. No set (or an unknown one) gives the original songs.
  function boardFor(setId) { var b = buildBoard(); applyMapSet(b, setId); return b; }
  function applyMapSet(board, setId) {
    var set = MAP_SETS[setId], base = buildBoard();
    if (!board || !board.spaces) return false;
    Object.keys(board.spaces).forEach(function (id) {
      var sp = board.spaces[id], keys = set ? set.spaces[id] : base.spaces[id] && base.spaces[id].bsr;
      if ((sp.type === 'map' || sp.type === 'task') && keys) sp.bsr = keys.slice();
    });
    board.bonusMaps = (set ? set.bonusMaps : base.bonusMaps).slice();
    if (set) { board.mapSet = setId; board.mapsBy = set.author || ''; } else { delete board.mapSet; delete board.mapsBy; }
    return true;
  }

  root.CGContent = {
    CELL: CELL, PAD: PAD,
    boards: { 'chester-escape': buildBoard },
    mapSets: MAP_SETS, boardFor: boardFor, applyMapSet: applyMapSet,
    themes: THEMES,
    cardsFor: cardsFor,
    effectText: effectText, cardEffectText: cardEffectText, spaceEffectText: spaceEffectText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CGContent;
})(typeof globalThis !== 'undefined' ? globalThis : this);
