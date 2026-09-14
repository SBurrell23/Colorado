# Colorado

A 3-D, peer-to-peer, browser tile-laying game set in the Colorado Rockies. Lay
habitat tiles into your own corner of the high meadow, settle the wildlife that
belongs there, and try to end the season with the longest corridors and the
best-placed animals.

**Play it: https://sburrell23.github.io/Colorado/**

It plays by the rules of *Cascadia* — same 85 tiles, same 100 wildlife tokens,
same four-pair display, same three-beat turn, same nature-token economy — with
the wildlife and the landscape moved east over the divide.

---

## The valley

Five habitats — alpine peaks, aspen groves, shortgrass prairie, beaver marsh
and canyon river — and five animals, each with its own way of scoring. Any
animal can settle in any habitat; what matters is how you arrange them.

| Animal | Scores for |
| --- | --- |
| Bighorn sheep | Pairs of exactly two — a lone ram or a crowd of three scores nothing |
| Elk | Straight lines, up to four long; longer lines pay far more |
| Cutthroat trout | Connected runs, but a run with a fork in it scores nothing |
| Golden eagle | Solitude — only eagles with no eagle beside them count |
| Coyote | Variety — one point for each different animal on the six hexes around it |

At the end of twenty turns you score your wildlife, then two points for the
largest corridor of each habitat (plus a three-point bonus if nobody has a
longer one), then one point per unspent nature token.

## A turn

1. **Draft.** Take one of the four tile-and-token pairs on offer. Taking a tile
   from one pair and a token from another costs a nature token.
2. **Lay the tile.** It has to touch what you already have. Rotate with **R**.
3. **Settle the token.** It can only go on a tile showing that animal, on a tile
   with no token yet. If there is nowhere for it, it goes back to the wild.

Laying a keystone tile — one that shows a single animal — and settling that
animal on it earns you a nature token. Four matching tokens in the display clear
themselves automatically; three matching tokens you may clear once a turn for
free, and again after that for a nature token.

## Playing with other people

The host's browser runs the game and everyone else connects straight to it over
WebRTC, using PeerJS only to introduce the two ends. There is no server of ours
in the middle and no account to make: start a game, hand out the six-letter
code, and anyone who types it in joins.

Empty seats can be filled with rangers — three grades of bot, from one that
plays the obvious move to one that reads a turn ahead.

## Running it yourself

There is no build step. Any static file server will do:

```bash
npx --yes http-server . -p 4173 -c-1
```

Then open `http://localhost:4173`.

The rules are testable without a browser — the engine has no DOM in it at all:

```bash
node tests/sim.mjs
```

That checks the hex maths, the composition of the box, corridor matching through
rotated split tiles, every scoring rule, the overpopulation rules and the nature
token economy, then plays forty complete games between bots and checks the
outcome each time. The deploy workflow will not publish a build that fails it.

## What is drawn where

Every pixel in the game is generated at runtime — there is not a single image,
font file or sound file in the repository.

```
src/
  game/      the rules, with no rendering and no DOM
    hex.js       axial coordinates and the six neighbour directions
    tiles.js     the 85 tiles and 100 tokens, and how the box is built
    board.js     placement legality, corridors, animal groups
    scoring.js   the five scoring rules and the end-of-game tally
    engine.js    the authoritative state machine
    ai.js        the ranger bots
  render/
    tileart.js   habitats, animals and tokens, drawn with Canvas 2D
    animals.js   the five wildlife silhouettes
    scene.js     meadow, instanced forest, painted range, sky and clouds
    boardview.js the hex prisms and each player's tableau
    draftview.js the display strip, as an orthographic overlay
    camera.js    the free-roaming board camera
  audio/       every sound effect and the ambient bed, synthesised live
  net/         PeerJS transport, host and client sessions
  ui/          lobby, HUD, settings, modals
```

Some notes for anyone reading the rendering code:

- The forest is three `InstancedMesh`es, so thousands of trees cost three draw
  calls. Density is a settings slider rather than a compromise.
- three.js maps a cylinder cap's UVs from world *z* to *u* and world *x* to *v*,
  so the canvas axes are not world *x*/*z*. Getting that wrong rotates the
  painted hexagon thirty degrees off the prism under it.
- Fog is applied *after* tone mapping, so the sky material is `toneMapped:
  false`; anything else leaves a visible seam at the horizon.

## Licence

The code is mine to give away; the game it plays is *Cascadia*, designed by
Randy Flynn and published by Flatout Games. This is a fan implementation with
different art, different wildlife and no affiliation with them.
