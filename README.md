# MAUR

*An ant colony under your command.*

A Liero-style destructible-terrain game with a 1998 MS-DOS soul. You are one
ant in a living colony: dig tunnels, forage the forest floor, climb trees,
milk aphids, feed the brood, and drive off the things that bite. As long as
a single ant survives, the colony — and you — live on.

![320x200, VGA palette, scanlines](test/shot-play.png)

## Run it

No build, no dependencies. Open `index.html` in any modern browser and
choose **PLAY SOLO**:

```sh
open index.html          # macOS
# or serve it:
python3 -m http.server   # then http://localhost:8000
```

### Online co-op (local server)

**PLAY ONLINE** needs the game server (Node 22; its only dependency is
`ws`):

```sh
cd server && npm install && npm start    # listening on 127.0.0.1:3006
```

Then open <http://localhost:3006> (the server serves the game too) in up to
four browsers or tabs. A page opened from disk (`file://`) connects to
`ws://localhost:3006/ws`; `?server=ws://host:port/ws` points it elsewhere,
and `?lag=100` adds an artificial 100 ms round trip for testing. Settings
come from the environment or `server/.env` (see `server/.env.example`:
`PORT`, `HOST`, `MAX_ROOMS`, ...). The public server will be
`https://maur.lektorensrud.no` (see `deploy/README.md`).

## How to play

| Action | Keys |
|--------|------|
| Move / climb | `W A S D` or arrow keys |
| Bite / dig | `Space` |
| Pick up / use | `E` |
| Caste ability (soldier: rally, nurse: heal) | `Q` |
| Switch ant | `Tab` |
| Build (hold) | `F` |
| Change build material (earth / thatch / ant gate) | `R` |
| Mark chamber (or, by a tree, an aphid shelter) | `X` |
| Objectives / crystal upgrades | `O` (`←`/`→` page, `Enter` buy) |
| Guide arrow on / off | `G` |
| Skip the current hint | `H` |

- **Hold up against a wall (or tree) to climb.** Ants climb everything.
  Hold up under a roof to hang and crawl upside-down — tunnel ceilings and
  tree branches alike.
- **Bite** digs dirt, grass and leaves; rock and wood don't yield. The same
  bite wounds spiders, centipedes, pillbugs, worms... and prey becomes food.
- **`E`** picks up items, deposits food at any storage chamber, feeds
  hungry larvae, milks aphids for honeydew, and feeds leaves (or your
  thatch load) to a fungus garden.
- `M` map · `Esc`/`P` pause · `N` sound · `C` CRT filter

### Playing online

Up to four players share one colony for one year. **PLAY ONLINE** asks for
your name (remembered in this browser), then **CREATE A MATCH** gives a
four-letter **room code** (no I or O, case doesn't matter) for your friends
to type in with **JOIN WITH A CODE**. The lobby lists everyone in their
colours; the host presses `Enter` to start. Someone who joins a match
already under way picks an ant from the colony (**JOIN THE COLONY**).

The keys are the same as solo. Each player plays its own ant -- a coloured
chevron over it, the others' names over theirs, and the same colours on the
map -- and `Tab` or a death hands you any ant no other player has. The
milestones, the crystals and the upgrades (`O`, any player may buy) belong
to the colony; the hints and the guide arrow are your own. Nothing pauses:
`Esc` opens a menu with **RESUME** and **LEAVE MATCH** while the world runs
on. If the connection drops, the game says so and reconnects by itself
(reloading the page works too): for two minutes your place is kept and
your ant carries on as one of the colony until you are back. When the year
ends (the nuptial flight, or the colony lost) everyone sees the same end
screen. Online matches are not saved.

### Getting started

Spring of year 1 doubles as the tutorial: a hint panel above the HUD
teaches one thing at a time — walking and climbing, biting and the soil
load, carrying food to the storage, building (`F`, `R`), marking a chamber
(`X`), the `O` screen and switching ants (`Tab`). Each hint stays until you
have done it; `H` skips one, and **HINTS** in the title or pause menu turns
them off (your progress is remembered per world, in this browser only).

The **guide arrow** (`G` toggles it, on by default) points the way to the
season's next milestone — the nursery while you raise ants, the entrance
for the mound or the seal, the roomiest royal chamber in autumn, the fallen
fruit in summer; a load of food always to the nearest storage, the nearest
food while the colony is hungry, and the red nest (or its queen, once
found) when the season's work is done. Off screen it sits at the edge of the
view with the target's sign beside it; in sight it bobs over the spot.

The **HUD** has three groups: your ant (caste, health — it frosts over out
in the winter cold — what it carries, the soil and thatch loads with the
selected building material framed in gold and shown as a swatch), the colony
(ants, brood and food against their caps, orange when full; crystals) and
the time (season and year, day of the season and the clock). Messages wait
while the `O` screen, the map or the ant switch is open, and show after.

### One year in the colony

The game is one colony year of four seasons, three in-game days each (about
48 minutes). **Spring** and **summer** are rich; **autumn** brings less food
but a fall of leaves; in **winter** nothing grows, the queen lays slowly,
centipedes come up from the deep more often, and the surface is deadly cold:
an ant outside loses health, unless it is below ground or within a thatched
mound. Foragers stay home, so the colony lives off what it stored (huddled
below, it eats about half as much as in summer). When the stores run dry
the ants starve; the last morsels go to the queen and the princesses, so a
famine thins out the workers long before it takes the crown.

Each season has three **milestones** (press **`O`**): spring — mark a second
storage chamber, raise 5 new ants, store 100 food; summer — thatch a mound
over the entrance, grow to 25 ants, bring home 8 pieces of the **contested
fruit**; autumn — have 150 food
stored as winter comes, dig a roomy royal chamber, raise a princess; winter —
keep the queen alive, keep the entrance sealed or gated, kill 3 centipedes.
Each gives score and crystals; missing one never ends the game, it only costs
stars. In later years the targets grow (more storage, food, ants, a bigger
mound and royal chamber). The random tasks in the corner remain as side jobs.

In autumn, with a roomy royal chamber and well-stocked stores (60% of
their capacity, or 150 food, whichever is less), the queen lays
**princess** eggs. On the first day of spring in year 2 every princess flies
out of the entrance in the **nuptial flight**, and the year is rated 1–3
stars (none without a princess flown): one for a princess flown, one for 3
princesses or 8 of the 12 milestones, and one for the **rival status** —
the red queen slain, or more ants than the red colony on the day of the
flight. Then you may carry on into the next year.
**You can't play the queen** — and if she dies with no princess (grown or
growing) to take her place, the colony is lost.

**Crystals** dug from the deep and carried to storage are the colony's
currency: on the second page of the `O` screen they buy upgrades for every
ant — mandibles (bite damage), digging (bigger, faster bites), soldier armor,
and carry speed — three levels each.

### Building

Everything you bite out of the ground goes into your mandibles: soil from
dirt, grass and roots, **thatch** from leaves. The two bars next to your
health show both loads. Hold **`F`** to lay the selected material where you
aim (the gold-framed bar; **`R`** switches): **packed earth** is a tough wall
that takes a worker three bites (a soldier two) and slows burrowing worms,
centipedes and beetles just as much; **thatch** is light and breaks in one
bite. Building never walls in an ant, brood or bug.

The third material is the **ant gate** (costs soil): your colony's ants walk
through it as if it were open air, while bugs, worms, centipedes and rival
ants find it as tough as packed earth. Gate the entrance for winter. Thatch
built over the entrance counts as the **thatched mound**: it speeds the brood
along and keeps the winter cold off ants under it. The colony's own ants
leave built thatch and packed earth standing on their errands (only an ant
truly stuck works its way through packed earth), so leave them a way in. Build thatch on the
surface beside a tree and press `X` there for an **aphid shelter**, which
drips honeydew now and then (not in winter).

### Chambers

The nest's capacity comes from its chambers. Dig out a cavity deep
underground and press **`X`** to mark it as a chamber; press `X` at a marker
to cycle it: **storage** (food capacity), **nursery** (brood and population),
**barracks** (population and the soldier share), **royal chamber** (how
often the queen lays, and room for princesses), **fungus garden** (leaves
in, food out, even in winter), or remove it. A chamber's size is the open space
around its marker; a cramped one counts for nothing. The HUD shows ants,
brood and food against their capacity: when the stores are full, foragers
wait with their loads until you dig and mark more storage. The generated
nest houses about 20 ants: an idle colony fills it in a day and a half and
then stops, until its own workers, once it has been full for half a day,
dig out a small nursery (at most once a season, never in spring) — a
player who digs and marks chambers grows far faster. Chamber names show
above their signs near your ant, never one over another.

On the `M` map, chambers show in their type colours, with aphid shelters,
ant gates, the thatched mound, the fallen fruit and the red nest as little
icons; below it, the nest close up with its chamber signs, and a legend.
Ant gates are woven in bright straw with a lit rim, so they stand out in a
dark tunnel; aphid shelters get a little thatched dome and a sign.

### The colony

The colony eats from the food stored in the **storage chamber**. The queen
lays eggs while there is food and room (from autumn on she keeps a winter
reserve of 1.5 food per ant); nurses ferry morsels to hungry larvae;
foragers gather seeds on the surface; soldiers patrol and fight, and a
worker or nurse a soldier rallies stands with it until badly hurt. Follow the
**tasks** in the top-left corner — gathering, feeding, digging out the
chambers, defending — to earn colony points.

If your ant dies, you continue as any other ant in the colony — worker,
soldier or nurse. When the last ant falls, or the queen dies without an heir,
the colony is gone.

### The red colony

A **rival red-ant colony** holds the right quarter of the map, and it is as
alive as yours: a red queen (half again as tough as yours) lays in her royal
chamber, red nurses raise the brood, red workers forage their own side of
the forest and red soldiers patrol the nest. It lives by the same rules —
capacity from its chambers, the seasons, winter stores — and digs itself a
few new chambers as it grows over the year.

When it is strong enough (enough ants and food; never in winter, at most
once a day, bolder and bigger as the year goes on) red sends a **raid**:
soldiers and thieves march across the forest, gather just out of sight of
your nest (you are warned when they arrive), then go in together — the
soldiers first, the thieves close behind to slip past the fight to your
storage and carry off food. They spare your queen; the raid ends when the
thieves are laden, too many raiders fall, they have spent long enough at
your gates or stop getting anywhere, and the survivors go home. Red ants
are a bright scarlet with a glossy highlight; a bitten enemy shows a small
health bar for a few seconds.

Each summer a **fruit falls between the nests** (a big red windfall in the
forest and on the `M` map, labelled *contested fruit* when you are near it): both colonies'
foragers race for its pieces. Deliver 8 of them for the summer milestone.

The bonus: fight into the red nest and **kill the red queen**. Don't go
alone: as a soldier, press `Q` and the soldiers
near you (up to eight) fall in behind you for 45 seconds, following you
across the forest and down the red tunnels and fighting whatever they meet
— with a few upgraded soldiers she can be taken in summer or autumn. With
no princess to succeed her, the red colony falls apart — its ants stop
raiding and slowly waste away — and the rival star at the flight is yours.
If your ants dealt at least a quarter of the wounds she took lately you also
get 1000 points and 5 crystals; dead of anything else (a centipede, hunger,
a last scratch from you after something else wore her down) she pays
nothing. Once a player has found her, the map marks her, she carries a
health bar, and the `O` screen shows her health next to a rough count of
the red colony.

While a raid marches on your nest a red banner says so (marching, at the
nest, thieves in the stores) with arrows toward it, and a red marker at the
edge of the view points at the raiders; each theft shows a short *food
stolen* notice. Hurt enemies near you — red ants you bit, spiders,
centipedes, wasps, beetles — show small health bars. Your ants are a dark
charcoal with a pale rim, the rival's a bright scarlet.

### Worlds

Three save slots, each a procedurally generated world: rolling forest floor,
trees with aphid herds in the canopy, rock seams and natural caves below,
and the colony mound with its chambers dug beneath. Your nest sits in the
left quarter of the map, the red colony's in the right quarter, with a long
stretch of open forest beyond each nest to explore. Worlds save automatically
(and on quit) — sink hours into one and come back later. (Online matches,
above, live on the server and aren't saved.)

### Wildlife

| Creature | Disposition |
|----------|-------------|
| Aphid | Milkable; drips honeydew near trees |
| Pillbug | Harmless; curls into a ball when bitten |
| Worm | Tunnels below; slow, nutritious |
| Spider | Surface predator, prowls at night |
| Centipede | Deep predator; follows you down tunnels |
| Wasp | Day-flying striker; dives on ants in the open |
| Beetle | Rare armored bruiser; bulldozes toward the mound |
| Red ants | The rival colony on the far side: foragers, nest soldiers, raids on your stores |

## Development

Plain JavaScript on a 320×200 canvas, integer-scaled, with a hand-built 5×7
bitmap font and WebAudio square-wave sound. No frameworks.

The simulation and the client are separate, so the same simulation can run
on a server. The sim never touches the DOM, audio or translations: it reads
each player's `input` struct and emits `G.events` (messages by string key,
positional sounds, particle bursts), and terrain edits are reported through
`T.onEdit`.

```
simulation (runs in the browser or headless in Node)
js/worldgen.js     seeded procedural generation (terrain, nest, trees)
js/terrain.js      per-pixel destructible terrain, digging, building, wear
js/entities.js     ants (player + AI), brood, bugs, items, physics
js/colony.js       colony simulation (one Colony per faction in
                   G.colonies: the players' black, the red rival): food,
                   brood cycle, chambers and capacity, mound/shelters/
                   fungus gardens, crystal upgrades, tasks, spawning, the
                   AI colony's growth and raids, the contested fruit,
                   the year's milestones
js/game.js         world state G, setup/restore (and save migration),
                   player actions (bite, build, mark, buy), the calendar
                   and its year (winter cold, each queen's succession, the
                   rival's defeat, the nuptial flight), stepSim()

client
js/terrainview.js  terrain canvases, repainted from edit rects
js/main.js         input, event handling, camera, rendering, HUD, menus,
                   the tutorial hints, the guide arrow, the map, the
                   online menus and lobby
js/net.js          online client: connection, lobby, reconnect; snapshots
                   into the render model (G.ants, G.colonies... drawn
                   100 ms behind, interpolated), the local ant predicted
                   with the sim's own steering and physics
js/netproto.js     protocol shared with the server: version, code tables,
                   room codes, names, terrain byte packing
js/save.js         localStorage saves, RLE-packed terrain (v6)
js/lang.js         English / Norwegian strings, the plural helper Ln()
js/font.js         bitmap font · js/sfx.js WebAudio bleeps

server (Node 22, `ws`)
server/server.js   HTTP (static files, GET /api/health) and the WebSocket
                   on /ws: messages validated and rate-limited, the 60 Hz
                   loop over the rooms
server/room.js     a room: lobby, slots (faction per player), reconnect
                   tokens, the match's own sim (a vm context of the sim
                   files), inputs in, events out, snapshots at 20 Hz
server/snapshot.js per-client delta snapshots (all entities near the
                   player's view, the rest at 2 Hz), colony state, terrain
                   edits
server/sim.js      loads the sim files into a fresh vm context per room
server/config.js   settings from the environment / server/.env
deploy/            pm2 ecosystem file, nginx block, deploy notes (Phase 5)
```

The protocol is JSON over one WebSocket (permessage-deflate on): `hello`,
`create` / `join` (room code) / `resume` (token), `lobby`, `start`,
`leave`; in a match the client sends held input (`in`, on change and every
100 ms) and presses as messages of their own (`act`, `abil`, `mat`,
`mark`, `buy`, `take`). On joining it gets `world` (the seed, plus the
terrain as a deflated diff against what the seed generates, checked by a
hash), then snapshots: entity records as integer arrays, the ids gone, the
colony state that changed, its own events (messages, sounds, particles)
and the terrain rects edited (run-length packed). A mid-game colony with
four players costs each client about 3-7 KB/s on the wire.

Headless tests (require `npm install` for Playwright):

```sh
node test/smoke.js        # boot, play, dig, climb, save/load, switch, takeover
node test/longsim.js      # fast-forward 3 in-game days of colony simulation
node test/nodesim.js      # the sim alone in plain Node (no browser): build +
                          # mark through the input struct, timings, then a
                          # whole year of both colonies (--no-year skips it)
node test/seasonprobe.js  # seasons, cold, milestones, O screen, queen rules,
                          # princesses, flight + stars + end screens, upgrades,
                          # gates, shelters, fungus gardens, saves + old v3
node test/forageseeds.js  # several seeds headless in parallel: foraging, food,
                          # the red colony's size and raids per day (or per
                          # season for a whole idle year: forageseeds.js 13)
node test/featureprobe.js # caste abilities, switching, brood carrying
node test/langprobe.js    # Norwegian strings, font coverage
node test/rivalprobe.js   # the red colony: queen, brood, foraging, raids and
                          # theft, the contested fruit, the red queen slain,
                          # v5 saves + v4 migration; map and O screen
node test/buildprobe.js   # soil loads, building, chambers, capacity, saves
node test/polishprobe.js  # hints (advance, skip, off), the guide arrow and
                          # its toggle, the raid alert and theft notice,
                          # enemy health bars, plurals in both languages,
                          # the O screen holding the toasts, map icons, gate
                          # rims, rally-follow, the factions' colours
node test/activeyear.js   # a scripted active player through a whole year:
                          # milestones, stars, colony size per season
                          # (--casual: a first-timer's year)
node test/netprobe.js     # online (needs `npm install` in server/): the
                          # server as a child process, two browser pages
                          # (one with 80 ms lag) and raw clients: room
                          # codes, lobby, start, terrain + snapshots (hash-
                          # checked against the server), input, digging,
                          # takeover, targeted messages, reconnect + reload,
                          # mid-match join, upgrades, leave, match end, the
                          # empty room closing, junk, floods, a full room
node test/netload.js      # one room, 4 bots, 2 minutes on a busy colony:
                          # server ms/tick, CPU, bytes/s per client
                          # (--natural: an uncrowded day-1 colony)
```

© 1998 BENSOFT INTERACTIVE (in spirit)
