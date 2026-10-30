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
- **Match:** lobby + room code, 1–8 players co-op (4v4 versus), one year (about an hour), ends
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
6. **Eight players.** Rooms of up to 8 (`MAX_PLAYERS`, default 8; versus
   at most half a side, 4v4), eight player colours, spawn spots along the
   mound, a two-column lobby, name tags only on screen and never over one
   another, **A NEW WORKER** for a joiner (or a dead player) with no free
   ant. **Balance by player count**: `G.playerSlots` = *n* (co-op: the
   starting players; versus: the bigger side, both sides alike; a
   a match's `notePlayers` only ever raises it; a persistent world:
   `followPlayers` rounds `G.playerAvg`, a moving average of those
   connected, sampled each in-game hour with a day's time constant, so it
   rises and falls), saved (save v8; older saves: their `playerCount`, or
   1). Each player beyond the first: the played colony's caps +1.5 pop
   and +10 food (co-op players' ants are extra workers, so the queen still
   lays at the start with 8); the milestones more hands make easier
   (raise, food100, mound, contested, stockpile, centipedes) x(1 + 0.15
   (n - 1)), pop25 +2 a player, on top of the year's growth; in co-op the
   AI rival's household, caps (pop, food, brood), raid threshold,
   raid size and its cap all x(1 + 0.1 (n - 1)) (8 players: x1.7, up to
   17 raiders; not its laying pace -- with that, and +15%, idle 8-player
   colonies were raided flat in spring). n = 1 is exactly the old game.
   Load (netload's crowded 80-ant room, `--bots N`, back to back on one
   machine): 4 bots before 3.09 ms/tick (+0.26 snapshots), 25% of a core,
   6.5 KB/s a client; after 3.26 ms (+0.27), 24%, 6.2 KB/s; **8 bots 3.38
   ms (+0.31), 26%, ~7.8 KB/s** -- the sim step barely moves (the bots stay
   near the nest), each client adds ~0.01 ms of snapshots. In process, 8
   players spread over the map (defeating the far-NPC throttle) cost ~25%
   more than 8 at the nest; nothing near the 6 ms mark, so no new
   optimisation, and `CPU_BUDGET_MS` stays 10. Production's `server/.env`
   still says `MAX_PLAYERS=4` until edited (see deploy/README.md).
7. **Blueprints.** Building was still hard to use: now a player plans and
   the colony builds. `B` (plan mode): the ant braces, a client-side cursor
   (no lag; up to `PLAN_REACH` 90 px from the ant, the view leaning toward
   it) paints planned pixels on open air with a 3 px brush in the selected
   material (`Space`; `X` erases; `B`/`Esc` done) into the colony's plan
   (`Colony.plan`, at most 6000 px; shared by its players, never seen by the
   other side in versus); planned pixels block nothing and leave the plan
   once built over (`T.onSolid`). `F` by planned pixels (within 18 px)
   fills them, nearest first and the held direction before the rest, a
   clump of up to 12 per `BUILD_CD` from the load each takes (the next ones
   blink); with nothing planned in reach the aimed stamp as before. The
   colony's **build stock** (soil and thatch, 300 each + 50 a player beyond
   the first): spoil overflowing a full load, everything NPCs dig on their
   errands (`Ant.chew`, the workers' chamber digs), a load unloaded with `E`
   at the storage. Idle workers (a colony with 30+ food; at most 3 and 15%
   of its workers; out of the cold in winter) take a `build` errand: to the
   nearest spot the stock can build (by the nest's tunnels or the surface
   walk), 4 px every 20 ticks from the stock, never where anyone stands,
   back to idle when the spot is done or the stock is dry; a spot not
   reached in 40 s (or blocked) is shunned for a minute. Online: the plan
   whole in the world message, then per-snapshot deltas of the pixels
   changed (`pl`, runs of pixels as they stand now), the stocks a view key
   of their own (`k0`/`k1`, private in versus); the input carries the
   cursor and the brush, the sim holds the cursor to the reach and paints
   the stroke between the spots it gets. Save v9 (the plan as runs, the
   stocks; older saves: none). `test/planprobe.js`.
8. **Match round 1: length, the goal in view, personal milestones.**
   - **The year's length** (`G.yearLen`, CREATE A MATCH's LENGTH row, a
     new solo world's slot with `←`/`→`): FULL (4-minute days, 48 min),
     SHORT (2-minute days, 24 min), QUICK (80-second days, 16 min); a
     persistent world is always FULL. Shorter *days*, not fewer: `DAY_LEN`
     became a `let` (`setYearLen`), so everything the calendar paces
     (seasons, a raid a day, the dig task, predator escalation, the night,
     the nest-full hint, the self-dig wait) follows it, while per-tick
     things (walking, digging, eating, the forest's food) stay. To fit:
     brood ageing/hunger and the queens' laying x`G.pace` = sqrt(48/len)
     (x1.41, x1.73); the rival's raids and AI chamber digs at most once per
     FULL day of real time (`raidGap`); the winter reserve per ant x the
     year's share, the princess food bar (60/150/60% of stores) x sqrt of
     it (`princessFood`; QUICK a flat share^0.75 x 60, its autumn too short to stock); milestones by `te` (1: counted through a season
     -- fruit, seal, centipedes; 0.5: built on all year -- raise, food,
     mound, pop25 from a base of 14, stockpile). FULL is unchanged to the
     number. Worldgen untouched. Saved (v10), in `create`/the lobby/the
     room list/the `world` message. Balance (activeyear bot, seeds 1-3):
     flights with stars: active bot FULL 3/3 (3,2,3 stars), SHORT 3/3
     (3,3,3), QUICK 2/3 (3,0,3); casual bot FULL 3/3 (3,2,2), SHORT 3/3
     (2,3,2), QUICK 2/3 (3,0,3); idle colony (the player handed back,
     seeds 1-2) 0/2 in every length (its royal chamber never grows roomy
     enough). QUICK misses on seed 2, a food-poor map (FULL survives it
     with one ant). Load (netload, back to back with HEAD): 4 bots 3.46 ->
     3.33 ms/tick, 30% -> 26% CPU; versus 16 bots 3.54 -> 3.32 ms/tick, 35%
     -> 32% CPU, 9.5 -> 9.2 KB/s a client -- within the noise.
   - **The goal strip** (top right): season, milestones x/3, time left
     (hourglass); from autumn the princesses (grown or growing), in winter
     FLIGHT IN m:ss. It takes whichever of the two top rows has room beside
     the task/milestone lines (else an icon-only form); name tags keep clear
     of the top lines (they drop under their ant).
   - **Personal milestones**: ten tracks x three tiers per player (hunter,
     slayer, forager, digger, builder (built px only), carer, frostbite,
     prospector, herder, survivor), checked once a second from the tally;
     a toast only for that player in its colour (`'@n'` colour token, a
     sound with `to`), 25/50/100 score, a crystal for the top tier of seven
     tracks (at most `PM_GEMS` = 4 a side a year). Synced once a second as `q0`/`q1` (each side only its own);
     the O screen's last page, a column on the held-Tab scoreboard. Saved
     per player in v10 (solo); a world slot keeps them until a newcomer.
   - **Highlights**: `G.over.hl` (every player's numbers, MVP score, the
     milestones it earned; awards MVP, TOP DIGGER/BUILDER/FORAGER, MOST
     KILLS, SURVIVOR); the online end screen's second page (two columns of
     8, versus a side each) and a brief on the result page; a persistent
     world's flight tells the year's MVP and each player its own year.
     `test/matchprobe.js`.
9. **Match round 2: decisive moments, contested crystals, map fog.**
   - **The contested crystal field** (`crystalField`, a pass after
     `genWorld` with its own rng, seed ^ 0x5EEDC0DE; `genNewWorld` =
     both): 5 pairs of veins mirrored about the nests' midpoint (+-10% of
     the width), 200-380 px down (the deep veins 420+), and about as many
     crystal pixels of the outer veins (beyond 10% of the width from the
     middle; at least 3 kept a side) turned back to dirt, a side in turn.
     Seeds 1-4: 13-28% of the crystals in the middle fifth before, 57-77%
     after; the total within 8%. genWorld itself is untouched (HEAD's
     terrain for every seed). New worlds only (newWorld, rebirth); the
     clients and the server use it for the terrain diff's base; a save
     keeps its own terrain.
   - **The golden seed** (`updateRelics`, colony.js): halfway through
     spring, summer and autumn (told at 0.4 of the season; season clock, so
     SHORT/QUICK follow) a seed falls for each played colony 380-700 px
     beyond its rival's mound (co-op/solo/worlds: past the red AI, for
     black; versus: one each side). It lasts a season (crumbles left lying
     past that, or when the next falls); no winter seed (the surface cold
     kills the carrier on a ~3 min trip). Carrier speed x0.7. Home in its
     own storage: +3 crystals, +300, counted (x/3 a year) -- each counts as
     a milestone for the flight's second star (8 of 12) and versus breaks a
     tie after the princesses (stars, princesses, seeds, ants). Into the
     enemy's storage: denied (+100 to the denier). A carrier killed drops
     it; NPC workers fetch a *dropped* seed within 500 px of their nest
     (own: home, the enemy's: denied), never a fresh one; a home side's
     soldiers chase an enemy carrier within 800 px of their nest (3 at once,
     an AI colony 2). Goal strip segment (gold lying, white carried, red
     taken, green home), an O screen row, the map (our seed; a gold ring
     on any carrier), edge markers, a help page per mode, toasts to both
     sides. Save v11 (G.relics, a seed item's rcol/dropped). View keys
     r0/r1 (each side only its own); item record field 5 = 2 + colony.
   - **Map fog** (versus, server/snapshot.js `fog`): a player's ant goes
     to the other side only while seen -- by that side's clients' views
     (+-220 x 140 px around the camera/ant), its player ants (same box) or
     its NPC ants (+-110 x 70); out of sight it is removed from that side's
     model (so from the map), with what it carries. A seed's carrier is
     always shown; a loose seed only within the other side's sight.
     No protocol version bump (an older page draws the seed as a seed).
   `test/relicprobe.js`.
10. **Player raids, chamber reach, CRT key.**
   - `Z` (any caste): `Colony.callRaid` sends the fit NPCs out through the
     AI's own raid machine (`startRaid`, `updateRaid` now also watched for
     a players' colony; it never starts one on its own). One at a time,
     not in winter, `RAID_CALL_CD` (2 min real time) after the raiders are
     home. Told to the colony (`m_raidGo`, `m_raidBack`); the target's
     warnings say ENEMY raiders when the raiders are players' (`m_raidP`..).
     One-shot input `raid` (client, server ONESHOTS).
   - A player's new chamber marker within `CH_REACH` (500 px) of the
     entrance and at most `CH_MAX` (16) markers: a player marked a storage
     at every crystal vein it found.
   - The CRT filter toggles on `V` everywhere (C switches ants in play, and
     toggled the filter from overlays and menus).
   `test/raidprobe.js`.
11. **Jobs.** Players in test sessions were lost (what to do, where to go,
   how the colony works): now every player has a job -- a nudge, never a
   lock (`J` the next one, the `O` screen's new **YOUR JOB** page picks one;
   free, any time). `JOBS` in game.js: **FORAGER**, **BUILDER**, **GUARD**,
   **SEEKER**. A job sets the guide arrow (`jobTarget` in main.js: food /
   the blueprint, the winter gate, a cramped chamber, the mound / a raid,
   an enemy seed carrier, an intruder, the bitten queen, the nest / our
   seed, our raid's target, the crystal field), the season's goal on the
   HUD's first row (`jobGoal`: food stored 60, px built + dug/4 300 or a
   dig task finished, guard points 8, seeker points 3 in a FULL year, x
   sqrt of the year's share; met once a season: a toast, +50 for a player's first goal of the season; the colony's
   task line takes the row a third of the time) and a small perk on the
   job (sim-side): FORAGER +25% food a load stored, BUILDER a stamp/fill
   every 6 ticks instead of 8 (+33%), GUARD +20% bite within `TERRITORY`
   (600 px) of its nest, SEEKER +15% walking speed beyond it (`jobSpeed`
   in `steerAnt`, so the client's prediction agrees). NPCs follow lightly:
   a guard's rally near home puts the soldiers on patrol round the nest
   (`rallyPatrol`), a forager's find with more food about calls up to 3
   idle workers within 700 px (`forageCall`, 20 s apart). Assignment
   (`assignJobs`, `pickJob`): lobby preferences (`J` in the lobby,
   `jobpref`; versus only shown to one's own side) first, then by team
   size (`JOB_FILL`: 1 the need, 2 F B, 3 +G, 4 +F, 5 +S, 8 F3 B2 G2 S1;
   fewer than four: the colony's need takes the last place) and need
   (`colonyNeed`); late joiners and a world's newcomers what the side
   lacks most; solo the need. The colony asks (`jobAsks`: guards for a
   threatened nest, seekers when the seed falls, builders for an open nest
   in winter, foragers in a lean late autumn; 45 s between asks, 3 min
   between the same, not while all have that job). Tallies `guard`,
   `patrol`, `seek`, `digTasks` in the player's stats; highlights add
   **BEST GUARD** and **TOP SEEKER** (forager and builder reuse theirs) and
   each player's job; the scoreboard and the takeover screen show the job
   (the takeover preselects its caste); the personal page lists the job's
   tracks first; a help page per mode. Protocol: `job` one-shot (ONESHOTS),
   `jobset` (by name, like `buy`), `jobpref`; view keys `j0`/`j1` (each
   side only its own). Save v12 (`pjobs`; older saves get jobs afresh).
   Balance (activeyear, its bot now a FORAGER as a solo world gives):
   SHORT seeds 1-3 3/3/3 stars, FULL seed 1 3 stars. Load (netload
   --versus, back to back with HEAD on this machine): 4.08, 3.80, 3.70
   ms/tick against HEAD's 3.63, 3.26 -- the noise is about as wide; in
   process, the same seeded world with and without jobs shows no cost of
   the jobs' own code (checkJob/jobAsks once a second, `jobsView` small).
   `test/jobprobe.js`.
12. **LEARN TO ANT and the first matches' tips.** Four online sessions:
   fun, but players were lost on all of it -- what to do and how to win,
   the keys, the colony's systems, where to go. The spring hints only ran
   in solo, nothing taught online.
   - **LEARN TO ANT** (the title's third entry; `js/learn.js`, client
     only): a guided scenario of eight short chapters (~8 min) on a world
     of its own -- `newWorld(LEARN_SEED)`, then a cramped hollow carved
     beside the nest after the generator (its rng and order untouched; the
     seed's terrain otherwise), `G.tutorial` set: no predators spawn
     (`worldSpawns`), no AI raids (`updateRaid`), no golden seed by itself
     (`updateRelics`), no asks (`jobAsks`); reset by every new world, never
     saved or sent. The chapters (`LEARN_CH`: goals, setup, the arrow's
     target, the goals' checks from the local ant, this player's messages
     and the keys seen through `tutSaw`): 1 the body (walk 80 px, climb,
     a load of 20), 2 food (pick up, store; two seeds by the mound, more if
     the NPCs take them), 3 the nest (dig the hollow to CH_MIN_AREA, `X`
     marks it, `X` again a nursery; the caps before and after), 4 the way
     (`M`, `O`, `G` off and on; the arrow on the red nest), 5 building
     (`F`, `R`, `B` + paint + `B`; a load given), 6 danger (a spider at
     60% by the mound; `C` to a soldier -- its rally made ready -- `Q`,
     the spider slain or fled), 7 the year (`Enter` leaps the calendar:
     summer, autumn with three princesses by the queen, winter, then
     spring of year 2 -- the sim's own flight, its `G.over` caught: the
     stars shown, nothing saved, no end screen), 8 together (a golden seed
     dropped; `J`, the job page, `Tab`, `Z`). A panel above the HUD (the
     camera lifts the ant clear of it): the chapter and keys, what to do,
     the goals ticked (two columns for four); done: why it matters (the HUD
     part it was about framed), `Enter` on. `H` skips; `Esc`: RESUME, SKIP
     CHAPTER, CHAPTERS (the list; each chapter on a fresh world), HELP,
     LEAVE TUTORIAL. The end: YOU'RE READY, the goal in five lines, PLAY
     SOLO / PLAY ONLINE / title. `maur_learn` (done) and `maur_learn_ch`
     (per chapter) in localStorage; no autosave, no save on unload.
   - **Newcomers are offered it**: the title entry is green until done (a
     tick after), the solo world list and the online menu say NEW? L: LEARN
     TO ANT FIRST, and so does the lobby -- on the first free key line under
     the note, else (the 8-row versus lobby, host) the bottom line a third
     of the time; `L` leaves the room for the chapter list.
   - **The first online matches' tips** (`Coach`, `COACH_MATCHES` = 3 a
     browser, `maur_coach`; while HINTS is on): instead of the spring
     hints, in their panel -- your job and how to do it, the arrow and the
     top line, how this mode is won, the keys; then at most one a 45 s,
     each once a match, a tip for what is happening, by job (a laden
     forager, a builder out of soil, a guard with a raid on, a seeker with
     our seed lying) or season (autumn's princesses, winter). `H` moves
     on; the online `Esc` menu got HINTS (RESUME, HELP, HINTS, LEAVE).
     Client-side, from the view it already has: no protocol change.
   - **The spring hints**: kept for whoever skips LEARN TO ANT (a new solo
     world after it gives none -- the same lessons twice would be noise).
   `test/tutprobe.js`; langprobe checks the new strings' widths.
