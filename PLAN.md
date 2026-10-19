# MAUR — plan for the full version

The current game is a strong demo: destructible terrain, wall/ceiling climbing,
a living colony sim and a coherent retro look. What it lacks is *purpose*: no
goal or ending, tasks are random chores, digging has no lasting effect,
the rival colony is set dressing, crystals are just score, and death is free.

The full version gives it a goal (one colony year ending in a nuptial
flight), a core loop (dig → designate chambers → capacity → growth), free-form
building, a real rival colony, and online multiplayer hosted on the VPS at
`ants.lektorensrud.no`.

## Decisions (2026-10-19)

| Question | Decision |
|---|---|
| Online format | **Both** matches and persistent worlds |
| Mode order | **Co-op first**, versus after |
| Local split-screen | **Dropped** (online replaces it) |
| Building | **Free placement** of material, plus a few special structures |

## Game design

### Core loop
Dig space → designate chambers → capacity rises → the colony grows → harder
objectives become reachable.

### Building
- Biting soil puts it in the ant's **soil load** (shown in the HUD). A build
  key places **packed earth** freely, pixel-brush style, in the facing/aimed
  direction. Packed earth takes 2–3 bites to break.
- Leaves and twigs give **thatch**, which builds the mound.
- Special structures: **ant gate** (passable for our ants only), **thatched
  mound** (brood growth, winter survival), **aphid shelter** (passive honeydew),
  **fungus garden** (leaves in → renewable food).
- **Chambers**: dig a cavity and mark it as Storage / Nursery / Barracks / Royal
  chamber. Capacity scales with area and replaces the hardcoded `POP_CAP`.

### Structure: one year in the colony
Each season has 3 milestones in an objectives screen, plus an on-screen arrow
pointing to the active one. The random tasks remain as optional side jobs.

| Season | Theme | Example milestones |
|---|---|---|
| Spring | Establish (doubles as tutorial) | 2nd storage chamber, raise 5 workers, store 100 food |
| Summer | Expand & compete | Thatch the mound, take a contested food site, 25 ants |
| Autumn | Prepare | Winter stockpile, Royal chamber, raise princesses |
| Winter | Survive | Surface deadly, live off stores, nest sealed, centipedes from below |

- **Win:** the nuptial flight. Princesses leave in spring of year 2. Rated 1–3
  stars (princesses, colony size, rival status). **Bonus:** kill the red queen.
- **Lose:** the queen dies with no princess raised. Players can no longer take
  control of the queen.
- **Crystals** become currency for colony upgrades (mandibles, dig speed,
  soldier armor).

### Rival colony
The red ants become a real `Colony` with a queen, brood, foragers and raids
that march out from their own nest. This is also the foundation for versus.

### Online modes
- **Match:** lobby + room code, 1–4 players co-op, one year (about an hour), ends
  with a victory or defeat screen. Later: versus, black vs red with players on each side.
- **Persistent world:** a named world on the server that players drop into.
  Seasons cycle year after year; each nuptial flight banks legacy points. If the
  colony falls with a princess alive, she founds a new nest; otherwise the world
  restarts. Proposal: the sim **hibernates while nobody is connected** (saves CPU
  on the small VPS, and the colony can't die unattended).

## Architecture

- **Server-authoritative.** One Node process runs the sim for each active
  world/match. Clients send inputs and receive entity snapshots about 20 times
  a second, interpolated on the client.
- **Terrain sync:** clients regenerate the world from the seed, and the server
  sends the edit log / RLE terrain on join, then streams dig and build edits.
- **The sim must run without a browser:** no DOM, canvas, audio or translation
  inside the sim. It emits events (`sfx`, `fx`, `msg`, terrain dirty rects)
  that the client renders.
- **Input is data:** a per-player input struct (`dx, dy, bite, act, abil`)
  plus discrete commands (`takeover`). Local keys and network packets feed the same path.
- **Multiple colonies:** `G.colony` → `G.colonies[]` (Phase 2).
- **Deploy:** per `../../VPS-deploy/README-add-service.md`: one pm2 process,
  HTTP and WebSocket on `/ws` on the same port (like tallcountry), port 3006 if
  `ss -ltn` confirms it's free, nginx WebSocket template, certbot once DNS
  resolves. Worlds are saved as JSON files on disk (or Postgres) with backup.

## Phases

0. **Foundations.** Drop split-screen; separate the sim from the client (event
   bus, input structs, terrain dirty rects); takeover per player while the world keeps
   running; the sim runs headless in Node (`test/nodesim.js`). No new gameplay;
   `smoke.js` and `longsim.js` keep passing.
1. **Building and chambers.** Soil load, packed earth, thatch, chamber marking,
   capacity. **Done** (soil/thatch loads, F/R/X, packed-earth wear, chamber
   areas drive food/brood/population/egg-rate caps, save v3). Thatch is plain
   building material for now; its mound warmth effect moves to Phase 2.
2. **Seasons, objectives, the real rival colony, queen rules, crystal upgrades.**
   - **2a done:** calendar from `G.tick` (3-day seasons, 48-min year), season
     effects (food, winter cold, centipedes, slow queen, client tint + snow),
     12 milestones + `O` screen, unplayable queen, princesses, succession and
     loss, nuptial flight with stars and CONTINUE, crystals as currency with 4
     upgrades (`input.buy`), ant gate (`M_GATE`), thatched mound, aphid
     shelters, fungus gardens, save v4. Fixed the forage stall (surface line
     and entrance anchor sinking down the shaft, map-wide spawn caps) and a
     fight leash. After review: NPCs spare built thatch/walls (`spare` in
     `T.dig`), nurses feed larvae lying by the queen (idle colonies grow
     again), the sealed-winter milestone counts, milestone targets grow each
     year, princesses stay out of fights. Moved on: a contested food site milestone and the rival
     status in the stars go to 2b with the real rival; the objective arrow
     and HUD rework stay in 3; legacy points / persistent-world years in 4.
   - **2b:** the real rival `Colony` (`G.colonies`), red queen, raids.
3. **Polish.** Tutorial, objective arrow, HUD, chamber labels, balancing.
4. **Online.** Server, lobby, room codes, persistent worlds; co-op first, then versus.
5. **Deploy to the VPS.**
