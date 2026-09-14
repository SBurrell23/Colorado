// Headless rules harness. Run with: node tests/sim.mjs
import { Engine } from '../src/game/engine.js';
import {
  HABITATS, ANIMALS, DISPLAY_SIZE, buildTileDeck, buildStarters, buildTokenBag, makeTile,
} from '../src/game/tiles.js';
import {
  placeTile, canPlaceTile, openHexes, openTokenHexes, largestCorridor, hexKey,
} from '../src/game/board.js';
import {
  scoreBighorn, scoreElk, scoreTrout, scoreEagle, scoreCoyote, scoreGame,
} from '../src/game/scoring.js';
import {
  HEX_DIRS, opposite, hexToWorld, worldToHex, neighbours,
} from '../src/game/hex.js';
import { animalGroups, sameNeighbourCount, neighbourAnimals, corridorSizes } from '../src/game/board.js';
import { ANIMAL_EXAMPLES, habitatExampleData, exampleEnv } from '../src/game/examples.js';
import { makeRng } from '../src/util/rng.js';
import { chooseBotMove } from '../src/game/ai.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}

/** Build a small environment by hand: [q, r, habitats, wildlife, token]. */
function env(rows) {
  const e = {};
  for (const [q, r, habitats, wildlife, token, rot] of rows) {
    placeTile(e, q, r, makeTile(habitats, wildlife), rot || 0);
    if (token) e[hexKey(q, r)].token = token;
  }
  return e;
}
const ALL = ANIMALS.slice();

// --- hex maths --------------------------------------------------------------
console.log('\nhex maths');
{
  check('six neighbours, all distinct', new Set(neighbours(0, 0).map((n) => n.q + ',' + n.r)).size === 6);
  check('opposite is its own inverse', [0, 1, 2, 3, 4, 5].every((d) => opposite(opposite(d)) === d));
  check('neighbours are mutual', [0, 1, 2, 3, 4, 5].every((d) => {
    const [dq, dr] = HEX_DIRS[d];
    const [bq, br] = HEX_DIRS[opposite(d)];
    return dq + bq === 0 && dr + br === 0;
  }));
  let roundTrips = true;
  for (let q = -4; q <= 4; q++) {
    for (let r = -4; r <= 4; r++) {
      const w = hexToWorld(q, r, 1.2);
      const back = worldToHex(w.x, w.z, 1.2);
      if (back.q !== q || back.r !== r) roundTrips = false;
    }
  }
  check('world position round-trips back to the same hex', roundTrips);
}

// --- the box ----------------------------------------------------------------
console.log('\nthe box');
{
  const rng = makeRng(5);
  const deck = buildTileDeck(rng);
  check('85 habitat tiles', deck.length === 85, String(deck.length));
  check('25 keystones', deck.filter((t) => t.keystone).length === 25,
    String(deck.filter((t) => t.keystone).length));
  check('60 split tiles', deck.filter((t) => t.habitats.length === 2).length === 60);
  check('every tile shows 1 to 3 animals',
    deck.every((t) => t.wildlife.length >= 1 && t.wildlife.length <= 3));
  check('no tile repeats an animal',
    deck.every((t) => new Set(t.wildlife).size === t.wildlife.length));
  check('no split tile repeats a habitat',
    deck.every((t) => new Set(t.habitats).size === t.habitats.length));

  const perAnimal = {};
  for (const t of deck) for (const a of t.wildlife) perAnimal[a] = (perAnimal[a] || 0) + 1;
  const counts = ANIMALS.map((a) => perAnimal[a]);
  check('every animal appears equally often', new Set(counts).size === 1, JSON.stringify(perAnimal));

  const perHabitat = {};
  for (const t of deck) for (const h of t.habitats) perHabitat[h] = (perHabitat[h] || 0) + 1;
  check('every habitat appears equally often',
    new Set(HABITATS.map((h) => perHabitat[h])).size === 1, JSON.stringify(perHabitat));

  check('100 wildlife tokens, 20 each', buildTokenBag(rng).length === 100);
  const starters = buildStarters(rng);
  check('five starter groups of three', starters.length === 5 && starters.every((s) => s.tiles.length === 3));
  check('each starter has a three-animal keystone-habitat tile',
    starters.every((s) => s.tiles[0].tile.wildlife.length === 3 && s.tiles[0].tile.habitats.length === 1));
}

// --- placement --------------------------------------------------------------
console.log('\nplacement');
{
  const e = env([[0, 0, ['peak'], ALL]]);
  check('a tile must touch your land', !canPlaceTile(e, 3, 3));
  check('a neighbouring hex is fine', canPlaceTile(e, 1, 0));
  check('an occupied hex is not', !canPlaceTile(e, 0, 0));
  check('six open hexes around one tile', openHexes(e).length === 6, String(openHexes(e).length));

  const e2 = env([[0, 0, ['peak'], ['elk', 'trout']]]);
  check('a token needs a matching symbol', openTokenHexes(e2, 'elk').length === 1);
  check('and will not go where it is absent', openTokenHexes(e2, 'eagle').length === 0);
  e2[hexKey(0, 0)].token = 'elk';
  check('an occupied tile takes no second token', openTokenHexes(e2, 'trout').length === 0);
}

// --- habitat corridors ------------------------------------------------------
console.log('\nhabitat corridors');
{
  const solid = env([[0, 0, ['peak'], ALL], [1, 0, ['peak'], ALL]]);
  check('two matching tiles make a corridor of two', largestCorridor(solid, 'peak') === 2);

  // A split tile touching with its river half does not extend a peak corridor.
  const split = env([
    [0, 0, ['peak'], ALL],
    [1, 0, ['peak', 'river'], ALL, null, 0],
  ]);
  check('a corridor needs both touching edges to match',
    largestCorridor(split, 'peak') === 1, String(largestCorridor(split, 'peak')));

  // Rotated so the peak half faces back, the two join up.
  const joined = env([
    [0, 0, ['peak'], ALL],
    [1, 0, ['peak', 'river'], ALL, null, 3],
  ]);
  check('rotating the split tile joins them', largestCorridor(joined, 'peak') === 2,
    String(largestCorridor(joined, 'peak')));

  const both = env([
    [0, 0, ['peak', 'river'], ALL, null, 0],
    [1, 0, ['peak', 'river'], ALL, null, 3],
  ]);
  check('a split tile can sit in two corridors at once',
    largestCorridor(both, 'peak') === 2 && largestCorridor(both, 'river') === 1,
    largestCorridor(both, 'peak') + '/' + largestCorridor(both, 'river'));
  check('an absent habitat scores nothing', largestCorridor(solid, 'marsh') === 0);
}

// --- the five rule cards ----------------------------------------------------
console.log('\nwildlife scoring');
{
  const pair = env([[0, 0, ['peak'], ALL, 'bighorn'], [1, 0, ['peak'], ALL, 'bighorn']]);
  check('one bighorn pair scores 4', scoreBighorn(pair) === 4, String(scoreBighorn(pair)));
  const trio = env([[0, 0, ['peak'], ALL, 'bighorn'], [1, 0, ['peak'], ALL, 'bighorn'],
    [2, 0, ['peak'], ALL, 'bighorn']]);
  check('three in a huddle is not a pair', scoreBighorn(trio) === 0, String(scoreBighorn(trio)));
  const two = env([[0, 0, ['peak'], ALL, 'bighorn'], [1, 0, ['peak'], ALL, 'bighorn'],
    [0, 3, ['peak'], ALL, 'bighorn'], [1, 3, ['peak'], ALL, 'bighorn']]);
  check('two pairs score 11', scoreBighorn(two) === 11, String(scoreBighorn(two)));

  const line3 = env([[0, 0, ['peak'], ALL, 'elk'], [1, 0, ['peak'], ALL, 'elk'],
    [2, 0, ['peak'], ALL, 'elk']]);
  check('a line of three elk scores 9', scoreElk(line3) === 9, String(scoreElk(line3)));
  const line5 = env([0, 1, 2, 3, 4].map((i) => [i, 0, ['peak'], ALL, 'elk']));
  check('five in a row split best as 4 + 1 = 15', scoreElk(line5) === 15, String(scoreElk(line5)));
  const bent = env([[0, 0, ['peak'], ALL, 'elk'], [1, 0, ['peak'], ALL, 'elk'],
    [1, 1, ['peak'], ALL, 'elk']]);
  check('a bend is two lines, not one', scoreElk(bent) === 7, String(scoreElk(bent)));

  const run3 = env([[0, 0, ['peak'], ALL, 'trout'], [1, 0, ['peak'], ALL, 'trout'],
    [2, 0, ['peak'], ALL, 'trout']]);
  check('a run of three trout scores 8', scoreTrout(run3) === 8, String(scoreTrout(run3)));
  const tangle = env([[0, 0, ['peak'], ALL, 'trout'], [1, 0, ['peak'], ALL, 'trout'],
    [0, -1, ['peak'], ALL, 'trout'], [0, 1, ['peak'], ALL, 'trout']]);
  check('a tangle is not a run', scoreTrout(tangle) === 0, String(scoreTrout(tangle)));

  const eagles = env([[0, 0, ['peak'], ALL, 'eagle'], [3, 0, ['peak'], ALL, 'eagle']]);
  check('two lone eagles score 5', scoreEagle(eagles) === 5, String(scoreEagle(eagles)));
  const perched = env([[0, 0, ['peak'], ALL, 'eagle'], [1, 0, ['peak'], ALL, 'eagle']]);
  check('eagles side by side score nothing', scoreEagle(perched) === 0, String(scoreEagle(perched)));

  const coy = env([[0, 0, ['peak'], ALL, 'coyote'], [1, 0, ['peak'], ALL, 'elk'],
    [0, 1, ['peak'], ALL, 'trout'], [1, -1, ['peak'], ALL, 'elk']]);
  check('a coyote scores per different neighbour', scoreCoyote(coy) === 2, String(scoreCoyote(coy)));
}

// --- the habitat bonus ------------------------------------------------------
console.log('\nhabitat bonus');
{
  const big = env([[0, 0, ['peak'], ALL], [1, 0, ['peak'], ALL], [2, 0, ['peak'], ALL]]);
  const small = env([[0, 0, ['peak'], ALL]]);
  const out = scoreGame([{ id: 'a', env: big, nature: 0 }, { id: 'b', env: small, nature: 0 }]);
  check('the longest corridor takes the bonus',
    out.rows[0].habitat.peak.bonus === 2 && out.rows[1].habitat.peak.bonus === 0);
  check('corridor length itself scores', out.rows[0].habitat.peak.size === 3);

  const tie = scoreGame([{ id: 'a', env: big, nature: 0 }, { id: 'b', env: big, nature: 0 }]);
  check('a tie splits the bonus one apiece',
    tie.rows[0].habitat.peak.bonus === 1 && tie.rows[1].habitat.peak.bonus === 1);

  const solo = scoreGame([{ id: 'a', env: big, nature: 3 }]);
  check('nature tokens are a point each', solo.rows[0].nature === 3);
  check('solo takes the bonus only at seven', solo.rows[0].habitat.peak.bonus === 0);
}

// --- a full game ------------------------------------------------------------
console.log('\nfull games');
{
  const rng = makeRng(2024);
  let errors = 0;
  let stalls = 0;
  let tokensPlaced = 0;
  let tilesPlaced = 0;
  let natureEarned = 0;
  const GAMES = 40;

  for (let g = 0; g < GAMES; g++) {
    const n = 1 + Math.floor(rng() * 4);
    const e = new Engine();
    for (let i = 0; i < n; i++) e.addPlayer('p' + i, 'P' + i, i === 0, true);
    const started = e.startGame();
    if (started.error) { errors++; continue; }

    let guard = 0;
    while (e.state.phase === 'playing' && guard++ < 4000) {
      const id = e.currentPlayerId();
      const view = e.viewFor(id);
      const move = chooseBotMove(view, { rng });
      if (!move) { errors++; break; }
      const before = e.state.turnPhase;
      const res = e.handle(id, move);
      if (res && res.error) { errors++; break; }
      if (before === 'tile') tilesPlaced++;
      if (before === 'token' && move.t === 'placeToken') tokensPlaced++;
    }
    if (e.state.phase !== 'gameEnd') { stalls++; continue; }

    // Every player took exactly the agreed number of turns.
    if (!e.state.order.every((id) => e.state.players[id].turnsTaken === e.state.turnsEach)) errors++;
    // Everyone's environment grew by exactly that many tiles, on top of three starters.
    for (const id of e.state.order) {
      const tiles = Object.keys(e.state.players[id].env).length;
      if (tiles !== 3 + e.state.turnsEach) errors++;
      natureEarned += e.state.players[id].nature;
    }
    if (!e.state.result || !e.state.result.ranked.length) errors++;
  }

  check('every game reached a final tally', errors === 0, errors + ' errors');
  check('no game stalled', stalls === 0, stalls + ' stalls');
  check('tiles were actually laid', tilesPlaced > 0, String(tilesPlaced));
  check('tokens were actually settled', tokensPlaced > 0, String(tokensPlaced));
  console.log('  info ' + tilesPlaced + ' tiles, ' + tokensPlaced + ' tokens, '
    + natureEarned + ' nature tokens held at the end');
}

// --- overpopulation ---------------------------------------------------------
console.log('\noverpopulation');
{
  const e = new Engine();
  ['A', 'B'].forEach((n, i) => e.addPlayer('p' + i, n, i === 0));
  e.startGame();
  // Force four of a kind onto the display and re-run the check.
  e.state.display.forEach((d) => { d.token = 'elk'; });
  e.resolveOverpopulation();
  const after = e.state.display.map((d) => d.token).filter(Boolean);
  check('four matching tokens clear themselves',
    !(after.length === DISPLAY_SIZE && after.every((t) => t === 'elk')), JSON.stringify(after));

  // Three matching may be cleared once, for free.
  const e2 = new Engine();
  ['A', 'B'].forEach((n, i) => e2.addPlayer('q' + i, n, i === 0));
  e2.startGame();
  const cur = e2.currentPlayerId();
  e2.state.display[0].token = 'eagle';
  e2.state.display[1].token = 'eagle';
  e2.state.display[2].token = 'eagle';
  e2.state.display[3].token = 'elk';
  e2.state.culledThisTurn = false;
  const free = e2.handle(cur, { t: 'cull', indices: [0, 1, 2] });
  check('three matching clear for free', !free.error, free.error);
  check('the free clear is once per turn', e2.state.culledThisTurn === true);
  check('a second clear now costs a nature token',
    !!e2.handle(cur, { t: 'cull', indices: [0] }).error);
}

// --- nature tokens ----------------------------------------------------------
console.log('\nnature tokens');
{
  const e = new Engine();
  e.addPlayer('solo', 'Solo', true);
  e.startGame();
  const p = e.state.players.solo;

  check('a mismatched pair is refused without a token',
    !!e.handle('solo', { t: 'draft', tileIndex: 0, tokenIndex: 1 }).error);

  // Earn one the honest way first, so the supply is not already full.
  p.nature = 1;
  e.state.natureLeft -= 1;
  const before = e.state.natureLeft;
  const res = e.handle('solo', { t: 'draft', tileIndex: 0, tokenIndex: 1 });
  check('with a token, any tile pairs with any animal', !res.error, res.error);
  check('the spent token goes back to the supply', e.state.natureLeft === before + 1);
  check('and leaves the player', p.nature === 0);

  // Settling on a keystone tile earns one back.
  const e2 = new Engine();
  e2.addPlayer('solo', 'Solo', true);
  e2.startGame();
  const p2 = e2.state.players.solo;
  const spot = openHexes(p2.env)[0];
  e2.state.display[0].tile = makeTile(['peak'], ['elk']);   // a keystone
  e2.state.display[0].token = 'elk';
  e2.handle('solo', { t: 'draft', index: 0 });
  e2.handle('solo', { t: 'placeTile', q: spot.q, r: spot.r, rot: 0 });
  check('a keystone tile is offered for the token', e2.state.turnPhase === 'token');
  e2.handle('solo', { t: 'placeToken', q: spot.q, r: spot.r });
  check('settling a keystone earns a nature token', p2.nature === 1, String(p2.nature));
}

// --- the worked examples in the help sheet ----------------------------------
// These are the pictures new players learn the rules from, so they are held to
// the rules themselves rather than to whatever looked right when drawn.
console.log('\nhelp-sheet examples');
{
  const marked = (cells, m) => cells.filter((c) => c.mark === m).map((c) => hexKey(c.q, c.r));

  const sheep = ANIMAL_EXAMPLES.bighorn;
  const sheepEnv = exampleEnv(sheep.cells);
  const sheepGroups = animalGroups(sheepEnv, 'bighorn').map((g) => g.length).sort();
  check('the bighorn example is a pair and a separate three',
    JSON.stringify(sheepGroups) === '[2,3]', JSON.stringify(sheepGroups));
  check('its tick is on the pair',
    animalGroups(sheepEnv, 'bighorn').some((g) => g.length === 2 && g.includes(marked(sheep.cells, '✓')[0])));
  check('its cross is on the three',
    animalGroups(sheepEnv, 'bighorn').some((g) => g.length === 3 && g.includes(marked(sheep.cells, '✗')[0])));
  check('and it scores what the rule card says', scoreBighorn(sheepEnv) === 4, String(scoreBighorn(sheepEnv)));

  const elkEnv = exampleEnv(ANIMAL_EXAMPLES.elk.cells);
  check('the elk example is a line of four', scoreElk(elkEnv) === 13, String(scoreElk(elkEnv)));

  const trout = ANIMAL_EXAMPLES.trout;
  const cleanEnv = exampleEnv(trout.cells);
  check('the trout example is a clean run of four', scoreTrout(cleanEnv) === 12, String(scoreTrout(cleanEnv)));
  const forkedEnv = exampleEnv(trout.cells, { includeDim: true });
  check('and the faded trout really would fork it', scoreTrout(forkedEnv) === 0, String(scoreTrout(forkedEnv)));

  const eagle = ANIMAL_EXAMPLES.eagle;
  const eagleEnv = exampleEnv(eagle.cells);
  check('the eagle example has exactly two loners', scoreEagle(eagleEnv) === 5, String(scoreEagle(eagleEnv)));
  for (const k of marked(eagle.cells, '✓')) {
    const [q, r] = k.split(',').map(Number);
    check('the ticked eagle at ' + k + ' is alone', sameNeighbourCount(eagleEnv, q, r, 'eagle') === 0);
  }
  for (const k of marked(eagle.cells, '✗')) {
    const [q, r] = k.split(',').map(Number);
    check('the crossed eagle at ' + k + ' is not', sameNeighbourCount(eagleEnv, q, r, 'eagle') > 0);
  }
  // An eagle minds other eagles and nothing else, so at least one of the ones
  // that scores has to be shown with company -- otherwise the picture teaches
  // "eagles want an empty hill", which is not the rule.
  check('a scoring eagle is shown with other animals beside it',
    marked(eagle.cells, '✓').some((k) => {
      const [q, r] = k.split(',').map(Number);
      return [...neighbourAnimals(eagleEnv, q, r)].some((a) => a !== 'eagle');
    }));

  const coyote = ANIMAL_EXAMPLES.coyote;
  const coyoteEnv = exampleEnv(coyote.cells);
  const [ck] = marked(coyote.cells, '✓');
  const [cq, cr] = ck.split(',').map(Number);
  const kinds = [...neighbourAnimals(coyoteEnv, cq, cr)].filter((a) => a !== 'coyote');
  check('the coyote example really has four different neighbours', kinds.length === 4, kinds.join(','));
  check('and scores four', scoreCoyote(coyoteEnv) === 4, String(scoreCoyote(coyoteEnv)));

  // Each habitat teaches a different lesson about corridors, and each one
  // states the run lengths the rules should find in it.
  const shapes = new Set();
  for (const habitat of HABITATS) {
    const data = habitatExampleData(habitat);
    const env = exampleEnv(data.cells);
    for (const [h, want] of Object.entries(data.expect)) {
      const got = corridorSizes(env, h);
      check(habitat + ': ' + h + ' runs are ' + want.join('+'),
        JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
    }
    // The numbered tiles walk the longest run, so there should be as many of
    // them as that run is long.
    const numbered = data.cells.filter((c) => /^[0-9]$/.test(c.mark || ''));
    if (numbered.length) {
      check(habitat + ': the numbers walk the whole run',
        numbered.length === data.expect[habitat][0], String(numbered.length));
    }
    shapes.add(data.cells.map((c) => c.q + ',' + c.r + ':' + (c.rot === undefined ? 'w' : c.rot)).join('|'));
  }
  check('all five corridor examples are different shapes', shapes.size === HABITATS.length,
    String(shapes.size));
}

// --- waving an animal on ----------------------------------------------------
// Cascadia lets you decline a wildlife token even when it would fit, which
// matters because several rules punish a crowd.
console.log('\nwaving an animal on');
{
  const e = new Engine();
  e.addPlayer('a', 'A', true);
  e.addPlayer('b', 'B', false);
  e.startGame();
  const id = e.currentPlayerId();
  const p = e.state.players[id];

  // Walk the display until a pair turns up whose animal has somewhere to go.
  let found = -1;
  for (let i = 0; i < DISPLAY_SIZE; i++) {
    const slot = e.state.display[i];
    if (slot.tile && slot.token && openTokenHexes(p.env, slot.token).length) { found = i; break; }
  }
  check('a placeable pair is on offer to test with', found >= 0);
  const animal = e.state.display[found].token;
  const bagBefore = e.bag.length;
  e.handle(id, { t: 'draft', index: found });
  const spot = openHexes(p.env).filter((h) => canPlaceTile(p.env, h.q, h.r))[0];
  e.handle(id, { t: 'placeTile', q: spot.q, r: spot.r, rot: 0 });
  check('the animal could have been settled', e.state.turnPhase === 'token');

  const tokensBefore = Object.values(p.env).filter((t) => t.token).length;
  const res = e.handle(id, { t: 'skipToken' });
  check('waving it on is allowed', !res.error, res.error);
  check('nothing was settled',
    Object.values(p.env).filter((t) => t.token).length === tokensBefore);
  check('the animal went back into the bag', e.bag.includes(animal) && e.bag.length >= bagBefore - 1);
  check('and the turn passed on', e.currentPlayerId() !== id);
  check('you cannot wave on an animal you are not holding',
    !!e.handle(e.currentPlayerId(), { t: 'skipToken' }).error);
}

// --- taking a pair back -----------------------------------------------------
console.log('\nputting a pair back');
{
  const e = new Engine();
  e.addPlayer('a', 'A', true);
  e.addPlayer('b', 'B', false);
  e.startGame();
  const id = e.currentPlayerId();
  const before = e.state.display.map((d) => (d.tile ? d.tile.id : null));
  e.handle(id, { t: 'draft', index: 1 });
  check('drafting empties the slot', e.state.display[1].tile === null);
  e.handle(id, { t: 'undraft' });
  check('escape puts the tile back', e.state.display[1].tile.id === before[1]);
  check('and the turn is back at the draft', e.state.turnPhase === 'draft');
  check('and it is still the same ranger', e.currentPlayerId() === id);

  // A mismatched pair costs a token; putting it back returns the token.
  const p = e.state.players[id];
  p.nature = 1;
  e.state.natureLeft -= 1;
  e.handle(id, { t: 'draft', tileIndex: 0, tokenIndex: 2 });
  check('a mismatched pair costs a token', p.nature === 0);
  e.handle(id, { t: 'undraft' });
  check('putting it back refunds the token', p.nature === 1, String(p.nature));
  check('and both slots are whole again',
    !!e.state.display[0].tile && !!e.state.display[2].token);

  const again = e.handle(id, { t: 'undraft' });
  check('nothing to put back once the draft is undone', !!again.error);
}

// --- illegal moves ----------------------------------------------------------
console.log('\nillegal moves');
{
  const e = new Engine();
  ['A', 'B'].forEach((n, i) => e.addPlayer('p' + i, n, i === 0));
  e.startGame();
  const cur = e.currentPlayerId();
  const other = e.state.order.find((id) => id !== cur);
  check('out-of-turn moves are refused', !!e.handle(other, { t: 'draft', index: 0 }).error);
  check('placing before drafting is refused', !!e.handle(cur, { t: 'placeTile', q: 5, r: 5, rot: 0 }).error);
  check('unknown moves are refused', !!e.handle(cur, { t: 'wander' }).error);

  e.handle(cur, { t: 'draft', index: 0 });
  check('drafting twice is refused', !!e.handle(cur, { t: 'draft', index: 1 }).error);
  check('a floating tile is refused', !!e.handle(cur, { t: 'placeTile', q: 9, r: 9, rot: 0 }).error);
  check('a token before its tile is refused', !!e.handle(cur, { t: 'placeToken', q: 0, r: 0 }).error);
}

console.log('\n' + (failures ? failures + ' FAILURES' : 'all checks passed'));
process.exit(failures ? 1 : 0);
