# MAUR — plan for the full version

The current game is a strong demo: destructible terrain, wall/ceiling climbing,
a living colony sim and a coherent retro look. What it lacks is *purpose*: no
goal or ending, tasks are random chores, digging has no lasting effect,
the rival colony is set dressing, crystals are just score, and death is free.

The full version gives it a goal (one colony year ending in a nuptial
flight), a core loop (dig → designate chambers → capacity → growth), free-form
building, a real rival colony, and online multiplayer hosted on the VPS at
`maur.lektorensrud.no`.

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
   - **2b done:** `G.colonies` = [black, red] (`G.colony`/`G.rival` aliases),
     faction-agnostic `Colony` and friend-or-foe by `ant.colony`; the
     generated red nest is red's chambers; red queen (2x hp), brood, its own
     forage zone, AI chamber digging, a winter reserve; real raids (soldiers +
     thieves march over, steal from storage, carry it home; spare the queen);
     red queen slain = defeat + 1000 score / 5 crystals; stars: the third is
     the rival (red queen slain, or more ants than red at the flight); the
     summer contested-fruit milestone (replaces "store 2 crystals"); red on
     the map and the O screen; save v5 + v4 migration (red bugs become red
     soldiers). No far-AI throttling was needed (~1.0-1.3 ms/tick with both
     colonies). After review: raids muster out of sight and go in together
     (thieves just behind the soldiers, not stopping for guards), give up
     when stalled, drop wedged raiders and stragglers, and are bigger;
     raiders no longer get stuck in their own crater-eroded nest (nestIn
     hysteresis, shaft-climb watchdog); fighters bite back at whoever bites
     them; the red queen pays her bonus only when the players' colony slew
     her; health bars on her and on bitten enemies, her health on the O
     screen; brighter red ants; a contested-fruit label; nodesim is seeded.
     To Phase 3: raid/rival balance against active players, red
     princesses and a red nuptial flight, raid warnings in the HUD/arrow.
3. **Polish.** Tutorial, objective arrow, HUD, chamber labels, balancing. **Done** (7-hint spring tutorial, guide arrow `G`, regrouped HUD + plurals, charcoal-vs-scarlet factions and enemy health bars, raid banner + FOOD STOLEN, map icons + nest inset, readable labels/gates/shelters/fruit, idle colonies grow past the pop-cap stall, ~80% less mound erosion, soldier rally escort, red queen 1.5x and a wound-ledger bonus, save v6).
4. **Online.** Server, lobby, room codes, persistent worlds; co-op first, then versus. **Done.**
   - **4a done:** `server/` (Node 22 + `ws`, one process: static files,
     `/api/health`, the WebSocket on `/ws`; `MAX_ROOMS`, 4 players a room,
     rooms close 60 s empty or 5 min after the match), each room its own
     sim in a vm context at 60 Hz with 20 Hz per-client delta snapshots
     (entities near the view every time, the rest at 2 Hz, colony state by
     changed key, events per player, terrain edits RLE-packed; the join's
     terrain a deflated diff against the seed's, hash-checked), validated and
     rate-limited input, a crash closes only its room; `js/net.js` (lobby
     with room codes, the render model interpolated 100 ms behind, the local
     ant predicted with the sim's `steerAnt`/`physStep`, reconnect with a
     sessionStorage token within 2 min while the ant plays as an NPC, page
     reload rejoins); sim: `ensurePlayer`/`releasePlayer`/`reclaimAnt`,
     `PLAYER_COLORS`, the dead player told by name; title SOLO / ONLINE,
     name tags, online pause (RESUME / LEAVE MATCH), the shared end screen;
     `deploy/` (pm2, nginx, notes); `netprobe.js`, `netload.js` (4 bots on
     an 80-ant colony: ~5.3 ms/tick, ~42% of a core, ~6.3 KB/s per client on
     the wire; on a natural 39-ant colony 2.8 ms, 22%, 3.6 KB/s). No save
     version change (online matches aren't saved).
   - **4b done:** capacity: far NPCs think less often (every 4 ticks past
     900 px from every player ant, every 2 off screen, every tick within
     260 px or while fighting/fleeing/raiding/rescuing/escorting/burrowing;
     physics every tick, timers count the ticks passed), a cheaper ground
     test, one nursery-danger scan per tick, cheaper pheromone ageing:
     netload's 80-ant room 4.46 -> 3.00 ms/tick (CPU 33% -> 24% of a
     core), nodesim 1.10 -> 0.74 ms/tick, economy within the noise floor;
     a server-wide guard (rolling CPU per frame over all rooms against
     `CPU_BUDGET_MS`, default 10; `MAX_ROOMS` 4) refusing new matches and
     joins with SERVER FULL, the load in `/api/health`. Persistent worlds
     (`PERSIST_WORLDS`, `DATA_DIR`): booted from JSON saves (save.js shared
     with the server, save v7: mode, legacy, history, generation), asleep
     with nobody in them, autosaved (2 min, on sleep, on SIGINT/SIGTERM or
     pm2's shutdown message) atomically with a .bak; flights bank legacy
     (stars x 100 + princesses x 50) and the years go on; a colony lost
     with no heir restarts the world (new seed, legacy and history kept).
     Room browser (PERSISTENT WORLDS, CREATE co-op/versus public/private,
     JOIN WITH CODE, OPEN MATCHES), kick, public toggle. Versus: sides
     picked in the lobby (1-2 each), both colonies played (own takeover,
     milestones, crystals, upgrades, HUD via `G.colIdx`, messages tagged
     by colony), nests equalized from the seed (paired chambers capped to
     the smaller claim, same household), own-side ant gates (`T.gateSplit`),
     equal queens, **no AI raids** in versus, queen slain = instant win,
     else the year-2 flight (stars, princesses, ants); the enemy's private
     numbers never sent. Tests: persistprobe, versusprobe, netprobe
     extended. Not reached: the ~2.5 ms/tick target in netload's worst
     case (all four bots at one nest). Moved to later: red princesses and
     a red nuptial flight, a raid-defence hint (both from Phase 3), a
     "fallen colony's princess founds a new nest" variant (succession stays
     as before; a lost colony restarts the world).
5. **Deploy to the VPS.** **Done 2026-10-20:** live at
   https://maur.lektorensrud.no (pm2 `maur`, port 3006, worlds in
   `/srv/maur/data`, nightly backup). `deploy/README.md` has how it was done
   and how to update; the shared runbook in `../../VPS-deploy` lists the service.
