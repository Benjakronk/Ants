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

### Online (local server)

**PLAY ONLINE** needs the game server (Node 22; its only dependency is
`ws`):

```sh
cd server && npm install && npm start    # listening on 127.0.0.1:3006
```

Then open <http://localhost:3006> (the server serves the game too) in up to
eight browsers or tabs. A page opened from disk (`file://`) connects to
`ws://localhost:3006/ws`; `?server=ws://host:port/ws` points it elsewhere,
and `?lag=100` adds an artificial 100 ms round trip for testing. The public
server will be `https://maur.lektorensrud.no` (see `deploy/README.md`).

Settings come from the environment or `server/.env` (see
`server/.env.example`):

| Variable | Default | |
|---|---|---|
| `PORT`, `HOST` | `3006`, `127.0.0.1` | where the server listens |
| `MAX_ROOMS` | `4` | matches at once (lobbies included; the persistent worlds come on top) |
| `MAX_PLAYERS` | `8` | players per co-op room and persistent world, 1-8 |
| `SIDE_MAX` | `8` | versus: players a side, 1-8 (8v8: a room of 16) |
| `CPU_BUDGET_MS` | `10` | the CPU every running room together may use, in ms per 16.7 ms frame (about 60% of a core); above it new matches and joins are refused with SERVER FULL |
| `PERSIST_WORLDS` | `1` | persistent worlds: a count (the first of `MAURTUA`, `ENGA`, `SKOGEN`, `LYNGEN`) or a comma-separated list of names; `0` for none |
| `DATA_DIR` | `server/data` | where the worlds are saved (JSON, one file per world plus a `.bak`; gitignored). Must be writable, and backed up |
| `AUTOSAVE_MS` | `120000` | how often a running world saves |
| `ROOM_IDLE_MS`, `ROOM_OVER_MS`, `RECONNECT_MS` | 1 min, 5 min, 2 min | an empty room closes, an ended match closes, a lost player's place is kept |
| `MAX_CONNS` | `64` | WebSocket connections at most |

`GET /api/health` answers `{ ok, rooms, players, uptime, load, budget,
full, worlds: [...] }` (`load`: the rooms' CPU in ms per frame).

## How to play

| Action | Keys |
|--------|------|
| Move / climb | `W A S D` or arrow keys |
| Bite / dig | `Space` |
| Pick up / use | `E` |
| Caste ability (soldier: rally, nurse: heal) | `Q` |
| Call a raid on the enemy nest | `Z` |
| Your job: the next one (forager, builder, guard, seeker) | `J` |
| Switch ant | `C` |
| Scoreboard (hold) | `Tab` |
| Build (hold) | `F` |
| Plan mode: draw a blueprint (`Space` plan, `X` erase, `B`/`Esc` done) | `B` |
| Change build material (earth / thatch / ant gate) | `R` |
| Mark chamber (or, by a tree, an aphid shelter) | `X` |
| Objectives / crystal upgrades / your job / personal milestones | `O` (`←`/`→` page, `Enter` buy or take the job) |
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
- `M` map · `Esc`/`P` pause · `N` sound · `V` CRT filter

### Playing online

**PLAY ONLINE** asks for your name (remembered in this browser), then
offers four ways in:

- **PERSISTENT WORLDS** -- the server's named worlds (`MAURTUA`, ...), each
  listed with its players (up to 8), year and season, and its legacy.
  `Enter` drops you in at any time; you pick an ant (**JOIN THE COLONY**).
  A world sleeps while nobody is in it (its colony can't die unattended)
  and is saved on the server. Its seasons cycle year after year: the
  nuptial flight doesn't end it, it banks **legacy points** (stars x 100 +
  princesses flown x 50, shown in a toast, on the world list and on the
  third page of the `O` screen, **WORLD HISTORY**) and the colony carries on
  into a bigger next year. A queen who dies with a princess is succeeded;
  a colony lost with no heir starts the world over -- a new seed, a fresh
  colony -- with its legacy and history kept. Always co-op.
- **CREATE A MATCH** -- **co-op** (1-8 players, one colony, one year; the
  end screen has no CONTINUE) or **versus**; its **LENGTH**: a **FULL
  YEAR** (about 48 minutes), **SHORT** (24) or **QUICK** (16) -- see *One
  year in the colony*; **public** (listed under OPEN MATCHES) or **private**
  (by code only). You get a four-letter **room code** (no I or O, case
  doesn't matter).
- **JOIN WITH A CODE** -- any match, public or private.
- **OPEN MATCHES** -- public matches with room to spare, in their lobby or
  already **UNDER WAY** (you join the running match and pick an ant), each
  with its length (the lobby's title says it too).

The lobby lists everyone in their colours, in two columns of four (versus:
black on the left, red on the right, up to eight each under a smaller room
code; a player who dropped out is dimmed). `J` picks the **job** you'd like
(ANY, then each in turn -- its icon shows by your name, versus only to your
own side; the match honours it when it starts, see *Jobs*). `H` opens the
help: how the match works and how it's won, the golden seed, the jobs,
what to do through the year, the controls.
The host presses `Enter` to start, `Tab` to make the match public or
private, and `Up`/`Down` + `X` to kick a player (who is told so). Someone
who joins a match already under way picks an ant from the colony (**JOIN
THE COLONY**); if every ant is already played (or none of a playable caste
is left), **A NEW WORKER** comes out of the entrance for them -- the same
after a death with no ant free. When the server is busy
(too many matches, or its CPU budget used up) it says **SERVER FULL**.

**Versus**: black against red, 1-8 players a side (`Left`/`Right` in the
lobby picks yours; the host can start once both sides have a player). Each
side plays its own colony -- its own ants to take over (never the queen),
its own milestones, crystals and upgrades, its own HUD, map, `O` screen
and guide arrow, its own messages -- and never sees the other side's
stores, crystals or milestones. Both nests are made equal from the seed
(each pair of matching chambers counts only the smaller one's room, and
both start with the same household, a worker more for each player beyond
the first on the bigger side, so an 8v8 still has NPCs to forage), each
side passes only its own ant
gates, the queens are equally tough, and there are no AI raids (the NPCs
of both colonies forage, nurse and defend; the attacking is the players'
job -- a soldier's `Q` brings an escort). Kill the enemy queen while she
has no heir and your side wins at once; otherwise the nuptial flight in
spring of year 2 decides it: more stars wins, then more princesses flown,
then more ants. No hints in versus. The end screen shows both sides.

The keys are the same as solo. Each player plays its own ant -- a coloured
chevron over it (eight colours), the others' names over theirs while they
are on screen (the nearest first; a tag with no room left in a crowd is
left out), and the same colours on the map. Hold `Tab` for the
**scoreboard**: each player's kills (the killing blow, or the last bite
within five seconds), deaths, food carried into the storage, and earth
dug and built, the most kills first (versus: a block a side). `C` or a death hands
you any ant no other player has. The
milestones, the crystals and the upgrades (`O`, any player may buy) belong
to the colony; the hints and the guide arrow are your own. Nothing pauses:
`Esc` opens a menu with **RESUME**, **HELP** (the same pages as the lobby's
`H`, for the mode played) and **LEAVE MATCH** (**LEAVE WORLD**, back to the
world list) while the world runs on; a message at the start points to it. If the connection drops, the game says so and
reconnects by itself (reloading the page works too): for two minutes your
place is kept and your ant carries on as one of the colony until you are
back. When a match's year ends (the nuptial flight, or the colony lost)
everyone sees the same end screen -- the result, and with `→` the
**HIGHLIGHTS**: the awards (**MVP**, a weighted score of everything a
player did; **TOP DIGGER**, **TOP BUILDER**, **TOP FORAGER**, **MOST
KILLS**; **SURVIVOR**, the fewest deaths; the jobs' **BEST GUARD** and
**TOP SEEKER**, by guard and seeker points -- the foragers and builders
have theirs already), every player's job, MVP score and
the personal milestones it earned this match (versus: both sides, a column
each -- the enemy's milestones and jobs are shown only here), and your own by name.
The result page names the MVP and what you won. Matches are not saved;
persistent worlds are (on the server).

**Personal milestones.** Besides the colony's milestones every player has
its own: ten tracks of three tiers each, for every way of playing --
**HUNTER** (kills: 1, 5, 15), **SLAYER** (predators: 1, 3, 6),
**FORAGER** (food stored: 20, 100, 300), **DIGGER** (earth dug: 500,
3000, 10000 px), **BUILDER** (earth built: 150, 800, 3000 px),
**CARER** (ants healed or rallied, larvae fed by hand: 3, 15, 40),
**FROSTBITE** (seconds out on the winter surface: 15, 40, 90),
**PROSPECTOR** (crystals carried home: 1, 3, 6), **HERDER** (aphids
milked: 1, 5, 15) and **SURVIVOR** (seasons lived through without dying:
1, 2, 4). A tier reached is a toast only you see, in your colour, and
gives the colony 25/50/100 points; the top tier of most tracks (not
digging, building or milking) also a crystal, at most 4 a side a year. The last page of the `O`
screen lists them, with the next goal of each and how far along you are;
the held-`Tab` scoreboard counts each player's (versus: your side's). In a
persistent world they belong to your place in it (a newcomer taking an old
place starts over), and its nuptial flight tells everyone the year's MVP
and each player its awards and the milestones it earned that year.

**More players, the same challenge.** A world is balanced for its number
of players, *n*: a co-op match for the players who start it, versus for
the bigger side (both sides alike; a match never gets easier when players
leave), a persistent world for the players who have been in it lately: a
moving average of those connected, with a time constant of an in-game
day (about 4 minutes of play), so a brief crowd doesn't make it a crowd's
world for good, and it eases back when they go (saved with it). Co-op players' ants are workers on top of the colony's own
household, so each player beyond the first gives the colony room for 1.5
more ants and 10 more food, and the queen can still lay with eight at the
mound. The milestones that more hands make easier grow by 15% a player
beyond the first, on top of the yearly growth -- new ants raised, food
stored, the mound, the contested fruit, the winter stockpile, centipedes
killed -- and the colony size by 2 ants a player; the rest (a second
storage, the royal chamber, a princess, the seal, the queen) stay as they
are. In co-op the red rival grows to match: its household, caps and
brood room, the colony it needs before it raids and the size of its
raids all by 10% a player beyond the first (8 players: x1.7, up to 17
raiders; its queen lays at her usual pace). One player plays exactly the game as it was.

### Jobs

Every player has a **job** -- a nudge toward where the colony needs hands,
never a lock: `J` switches to the next one, or pick one on the `O`
screen's **YOUR JOB** page (`Up`/`Down`, `Enter`), any time, for free.

| Job | The guide arrow points to | Its goal this season (the top line) | Perk while on the job | Suits |
|---|---|---|---|---|
| **FORAGER** | the nearest food (loose food, the fallen fruit, else an aphid); laden, the storage | food stored (60 in a FULL year) | each load stored worth **+25%** | worker |
| **BUILDER** | the blueprint's nearest pixel, in winter the entrance to gate, a cramped chamber, the mound in summer | px built + a quarter of the px dug (300), or a dig task finished | build stamps and blueprint fills every 6 ticks instead of 8 (**+33%**) | worker |
| **GUARD** | a raid on the nest, an enemy carrying a golden seed, an intruder at home, the queen bitten; else the nest (far off its entrance, near it the queen) | defence points (8): a foe slain near home 1 (a predator or an armed ant 2), a raid turned back while home 2, a minute on the rounds near home 1 | **+20%** bite within 600 px of its own nest | soldier |
| **SEEKER** | our golden seed out there, our raid's target, the crystal field midway between the nests | finds (3): a crystal home 1, a golden seed home 3 (denied 1), a raid called 2 | **+15%** walking speed beyond 600 px of its own nest | soldier |

A SHORT or QUICK year's goals are x0.71 / x0.58 (the square root of its
share). A goal met is a toast for you (and +50 to the colony, for your first goal of the season), once a
season; the next season counts afresh. The perks are the server's (and
small); nursing stays the nurse caste's on any job. The colony's NPCs
follow lightly: a GUARD soldier's rally (`Q`) near home sends the soldiers
it reaches on patrol round the nest instead of falling in behind it (away
from home it is the escort as before), and a FORAGER that picks up food
(or milks an aphid) where more lies calls up to 3 idle workers within 700
px to forage there (at most every 20 seconds). The switch overlay (`C`,
or a death) preselects the caste the job suits.

**Who gets which.** A match hands the jobs out at its start: first what
each player asked for in the lobby, then by the team's size -- 1 player
the job the colony needs most; 2 forager, builder; 3 + guard; 4 + a second
forager; 5 + seeker; 6-8 a second builder, a second guard, a third forager
(fewer than four: the colony's need takes the last place if it isn't among
them). A late joiner (and a persistent world's newcomer) gets the job its
side lacks most. A solo player gets the colony's need. **The colony asks**
as its need shifts, a toast to its side for anyone to answer (`J`): **THE
NEST NEEDS GUARDS** (a raid marching on it, an enemy carrying a golden seed
near it, the queen bitten), **A GOLDEN SEED FELL: SEEKERS**, **BUILDERS:
SEAL THE NEST** (winter with the entrance open), **FORAGERS WANTED: WINTER
IS NEAR** (late autumn short of stores) -- one ask in 45 seconds at most,
the same one every 3 minutes at most, and not while every player of the
side already has that job. The scoreboard (`Tab`) shows each player's job
icon (versus: your own side's only -- the enemy's jobs are never sent);
the O screen's personal milestones list the job's tracks first.

### Getting started

Spring of year 1 doubles as the tutorial: a hint panel above the HUD
teaches one thing at a time — walking and climbing, biting and the soil
load, carrying food to the storage, building (`F`, `R`; `B` plans a
blueprint), marking a chamber (`X`), the `O` screen and switching ants (`C`). Each hint stays until you
have done it; `H` skips one, and **HINTS** in the title or pause menu turns
them off (your progress is remembered per world, in this browser only).

The **guide arrow** (`G` toggles it, on by default) points where your job
wants you (see *Jobs*); with nothing there for the job, the way to the
season's next milestone — the nursery while you raise ants, the entrance
for the mound or the seal, the roomiest royal chamber in autumn, the fallen
fruit in summer; a load of food always to the nearest storage, the nearest
food while the colony is hungry, and the red nest (or its queen, once
found) when the season's work is done. Off screen it sits at the edge of the
view with the target's sign beside it; in sight it bobs over the spot.

The **goal strip** at the top right keeps the season in view: its name,
the milestones done this season (x/3) and the time left in it (an
hourglass, m:ss); from autumn the princesses raised (grown or growing),
and in winter the time to the nuptial flight. It sits beside the job and
milestone lines (on whichever of the two top rows has room, shortened to
an icon if it must); name tags keep clear of it. The first row is your
job's: its icon and the season's goal (e.g. `FORAGER: FOOD HOME 12/60`,
then GOAL MET); the colony's task takes the row a third of the time, and a
task just done has it while it blinks.

The **HUD** has three groups: your ant (caste, health — it frosts over out
in the winter cold — what it carries, the soil and thatch loads with the
selected building material framed in gold and shown as a swatch), the colony
(ants, brood and food against their caps, orange when full; crystals) and
the time (season and year, day of the season and the clock). Messages wait
while the `O` screen, the map or the ant switch is open, and show after.

### One year in the colony

The game is one colony year of four seasons, three in-game days each (about
48 minutes). A match (and a new solo world: `←`/`→` on an empty slot) may
be **SHORT** (2-minute days, 24 minutes) or **QUICK** (80-second days, 16
minutes): the same twelve days, each shorter, so everything the calendar
paces -- the seasons, a raid at most a day, the day's dig task, the
predators growing bolder, the night -- comes sooner, while what an ant does
in a second (walking, digging, eating, the forest's food growing back)
stays the same. To fit, the brood grows and the queens lay a little
quicker (x1.41 SHORT, x1.73 QUICK), the queen's winter reserve is as
much smaller as the winter, the stores a princess egg wants are x0.71
(SHORT) or x0.58 (QUICK) of a full year's, the red rival raids and digs new
chambers no more often in real time than in a full year, and the
milestones that measure what a season's time buys shrink with it (SHORT:
raise 4, store 70, a 175 px mound, 22 ants, 4 pieces of fruit, 105 for
winter, a seal half as long, 2 centipedes; QUICK: 3, 60, 145, 20, 3, 85,
a third as long, 1). A persistent world is always a full year. **Spring** and **summer** are rich; **autumn** brings less food
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
aim (the gold-framed bar; **`R`** switches). While `F` is held your ant
braces where it stands -- on the ground, on a wall or under a roof -- and
the direction keys only aim (eight ways, shown by a cross; a red x: no
room there), so you can build up, down or diagonally without walking off;
in mid-air it falls as usual. **Packed earth** is a tough wall
that takes a worker three bites (a soldier two) and slows burrowing worms,
centipedes and beetles just as much; **thatch** is light and breaks in one
bite. Building never walls in an ant, brood or bug.

**Blueprints.** Press **`B`** for plan mode: your ant braces where it is
(in mid-air it lands first) and a cursor appears -- the direction keys move
it (slowly at first, faster as you hold them), up to 90 px from your ant,
and the view leans toward it. Hold **`Space`** to paint planned pixels with
a small brush in the selected material (`R` switches), hold **`X`** to rub
them out; `B` or `Esc` ends plan mode (a bar over the HUD shows the keys,
the material, the plan's size and the stocks). A plan only marks open air,
blocks nothing, and is your colony's: everyone playing it sees it (as a
pulsing ghost in the material's colour, faintly on the `M` map) and adds to
it; in versus the other side never sees yours. A colony plans at most 6000
pixels. Then **fill it**: hold `F` by planned pixels (within about 18 px) and
your ant fills them -- the nearest first, those in the held direction before
the rest, a small clump at a time from the load each material takes (the
pixels it fills next blink); with nothing planned in reach `F` builds where
you aim, as before. **The workers help:** the colony keeps a **build stock**
of soil and thatch (300 of each, 50 more per player beyond the first) --
whatever spoil no longer fits a player's full load, whatever the NPCs dig
on their errands, and any load you unload with `E` at the storage
(empty-handed). While the colony isn't hungry, an idle worker now and then
becomes a builder (at most 3 at once, and no more than 15% of the workers):
it walks to the nearest spot of the plan the stocks can build, fills a few
pixels every third of a second, and goes back to its chores when the spot
is done or the stock runs dry; a spot it can't reach is left alone for a
minute. Builders never dig for soil, never build where anyone stands, and in
winter only work out of the cold. A planned pixel built over by anyone
leaves the plan. The stocks show on the `O` screen.

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
around its marker; a cramped one counts for nothing. New markers go within
500 px of the entrance, and a nest keeps at most 16. The HUD shows ants,
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

**The golden seed.** Halfway through spring, summer and autumn (you are
told a little before) a golden seed falls in the forest *beyond* the red
nest -- past it, on the far side from home. Carry it (`E`) to your storage:
+3 crystals, +300 points, and each one brought home counts as a milestone
for the flight's second star (the goal strip and the `O` screen count them,
x/3). It is heavy (its carrier moves at 70%), the red soldiers near their
nest go for its carrier, a carrier that dies drops it where it fell, and
workers fetch a dropped seed lying near their own nest -- ours bring it
home, red ones destroy it. It lasts a season, then crumbles; none falls in
winter. In versus each side has its own, beyond the other's nest: bring
yours home and guard theirs (its carrier shows on your map; carried into
your storage it is destroyed). Seeds break a versus tie after the
princesses (stars, princesses, seeds, ants).

**Crystals in the middle.** A new world's crystals lie mostly in a
contested field between the two nests, shallower than the deep veins
(reachable by midsummer); the far veins are fewer. **Map fog (versus):** a
rival player shows on your map (and is sent to you at all) only while one
of your side's players or ants can see it -- except a seed's carrier.

The bonus: fight into the red nest and **kill the red queen**. Don't go
alone: as a soldier, press `Q` and the soldiers
near you (up to eight) fall in behind you for 45 seconds, following you
across the forest and down the red tunnels and fighting whatever they meet
— with a few upgraded soldiers she can be taken in summer or autumn.
Or press **`Z`** (any caste) to **call a raid**: the colony's fit NPCs —
soldiers to fight, workers to carry off food, up to ten and never more
than 40% of the colony — muster short of the enemy nest and go in
together, exactly like the red raids; go along and lead them. One raid at
a time, none in winter, and the colony needs two minutes after its raiders
are home before it musters again. In versus the other side is warned of
ENEMY raiders. With
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
positional sounds, particle bursts; a colony's own ones tagged with it, so
in versus they reach only that side), and terrain edits are reported
through `T.onEdit`. `G.mode` is `solo`, `coop`, `versus` or `world`;
`G.colIdx` is whose eyes `G.colony` / `G.rival` see through (a red player's
client sets 1). `G.yearLen` (`full`, `short`, `quick`; `setYearLen`) sets
`DAY_LEN`, which every sim file reads, and `G.pace`, the brood's and the
queens' quickening (saved, and sent with the world to the clients).

An NPC far from every player's ant thinks less often -- every 4 ticks
beyond 900 px, every other tick off screen, every tick within 260 px or
while it fights, flees, raids, rescues, escorts or burrows -- while its
physics still runs every tick and its timers count the ticks that passed,
so a far forager's errands take as long as a near one's.

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
js/save.js         the world as data (serializeWorld, shared with the
                   server) and the browser's localStorage slots; RLE-packed
                   terrain (v7)
js/lang.js         English / Norwegian strings, the plural helper Ln()
js/font.js         bitmap font · js/sfx.js WebAudio bleeps

server (Node 22, `ws`)
server/server.js   HTTP (static files, GET /api/health) and the WebSocket
                   on /ws: messages validated and rate-limited, the room
                   browser, the 60 Hz loop over the rooms, the CPU-load
                   guard (SERVER FULL), the persistent worlds booted from
                   their saves, a graceful stop that saves them
server/room.js     a room: a co-op or versus match (lobby, sides, public/
                   private, kick) or a persistent world (asleep with nobody
                   in it, autosaved, reborn when its colony is lost); slots
                   (faction per player), reconnect tokens, its own sim (a vm
                   context of the sim files), inputs in, events out (a
                   colony's only to its side), snapshots at 20 Hz
server/snapshot.js per-client delta snapshots (all entities near the
                   player's view, the rest at 2 Hz), colony state (versus:
                   the enemy colony's public face only), terrain edits
server/store.js    the worlds' save files: atomic writes, one backup
server/sim.js      loads the sim files (and save.js) into a fresh vm
                   context per room
server/config.js   settings from the environment / server/.env
deploy/            pm2 ecosystem file, nginx block, the worlds' nightly
                   backup script, deploy notes (Phase 5)
```

The protocol is JSON over one WebSocket (permessage-deflate on): `hello`,
`list` (the room browser), `create` (mode, public, len: the year's length) / `join` (room code) /
`enter` (a persistent world by name) / `resume` (token), `lobby`, `side`,
`pub`, `kick`, `start`, `leave`; in a match the client sends held input
(`in`, on change and every 100 ms) and presses as messages of their own
(`act`, `abil`, `mat`, `mark`, `buy`, `take`); in plan mode the held
input carries the cursor and the brush too (`plan`, `px`, `py`, `paint`;
the sim holds the cursor to the ant's reach and paints the stroke between
the spots it gets). On joining it gets `world` (the seed and the year's
length, plus the
terrain as a deflated diff against what the seed generates, checked by a
hash, and its own colony's blueprint whole), then snapshots: entity records
as integer arrays, the ids gone, the colony state that changed, its own
events (messages, sounds, particles), the terrain rects edited (run-length
packed) and its colony's blueprint changes (`pl`: runs of pixels, each as
it stands now -- a material or gone; versus: never the other side's). Once
a second come the scoreboard (`sc`) and its side's personal milestones
(`q0`/`q1`: each player's tiers as a digit a track and the counts behind
them; versus: never the other side's -- they come with the end screen's
`over`, with every player's numbers and the awards). The jobs come in
every snapshot whose key changed (`j0`/`j1`: per player its job and the
season's goal -- done, needed, met; versus: never the other side's). `J`
is the one-shot `job` (server ONESHOTS), the O screen's pick `jobset`
(a job by name, like `buy`), the lobby's preference `jobpref` (in the
`lobby` message as each player's `j`, versus only to its own side). A mid-game colony with
four to eight players costs each client about 3-8 KB/s on the wire.

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
node test/planprobe.js    # blueprints: plan mode (B, Esc), the cursor's reach,
                          # painting only air, erasing, materials, the cap; F
                          # filling the plan (only planned pixels, from the
                          # load, never walling an ant in) or the aimed stamp;
                          # the stocks; NPC builders over several seeds (and
                          # stopping with the stock empty); online co-op and
                          # versus (each side only its own plan, small
                          # deltas); v9 saves and older ones; screenshots
                          # (--no-browser / --no-net skip parts)
node test/polishprobe.js  # hints (advance, skip, off), the guide arrow and
                          # its toggle, the raid alert and theft notice,
                          # enemy health bars, plurals in both languages,
                          # the O screen holding the toasts, map icons, gate
                          # rims, rally-follow, the factions' colours
node test/activeyear.js   # a scripted active player through a whole year:
                          # milestones, stars, colony size per season
                          # (--casual: a first-timer's year; --idle: the
                          # player's ant handed to the colony; --len short
                          # or quick: a shorter year)
node test/matchprobe.js   # the year's length (FULL/SHORT/QUICK days and
                          # targets, the calendar at the short pace, a short
                          # year to its flight, v10 saves), personal
                          # milestones (through play and tallies, only for
                          # their player, in its colour, rewarded once), the
                          # awards, a persistent world's year; online: CREATE
                          # with LENGTH, OPEN MATCHES and the lobby, the
                          # room's sim, toasts and each side's personal view
                          # only for its own, the highlights in `over`; a
                          # page: the LENGTH row, the goal strip (spring,
                          # winter, name tags clear of it), the O screen's
                          # page, the scoreboard, the end screens after a
                          # co-op match of 8 and versus of 16 (EN + NO), as
                          # screenshots (--no-browser skips the page)
node test/raidprobe.js    # Z: a players' colony calls its raids; chambers near
                          # the nest and capped
node test/jobprobe.js     # jobs: assignment by team size, need and lobby
                          # preference, a late joiner, J and the O page's
                          # pick, each perk only on its job and where it
                          # applies, a guard's rally on patrol, a forager's
                          # call, the season's goal, the tallies, the asks
                          # (rate-limited), job awards, worlds, v12 saves;
                          # online (raw clients: the lobby's preference,
                          # j0/j1 per side, the protocol); a page: lobby, HUD
                          # line, O pages, switch overlay, scoreboard and
                          # highlights (EN + NO) (--no-browser skips it)
node test/relicprobe.js   # match round 2: the crystal field (genWorld as
                          # HEAD's), the golden seed (timing FULL/SHORT,
                          # reward, flight star, versus tie-break, denial,
                          # carrier death, NPC soldiers and fetchers,
                          # crumbling, v11 saves), versus map fog on the
                          # server, screenshots (--no-browser skips them)
node test/netprobe.js     # online (needs `npm install` in server/): the
                          # server as a child process, two browser pages
                          # (one with 80 ms lag) and raw clients: the online
                          # menu, the world list, room codes, lobby, public
                          # and private (OPEN MATCHES), a kick, start,
                          # terrain + snapshots (hash-checked against the
                          # server), input, digging, takeover, targeted
                          # messages, reconnect + reload, mid-match join,
                          # upgrades, leave, match end, the empty room
                          # closing, junk, floods, a full room, SERVER FULL
                          # (MAX_ROOMS and the CPU budget)
node test/persistprobe.js # persistent worlds (raw clients, a temp DATA_DIR):
                          # boot from PERSIST_WORLDS, sleep with nobody in
                          # (ticks stand still), wake on a join, atomic
                          # autosave + .bak, a flight banking legacy and
                          # going on, a lost colony restarting the world
                          # (new seed, legacy and history kept), a graceful
                          # stop saving it, a restart loading it the same,
                          # a corrupt save falling back to the backup
node test/versusprobe.js  # versus: the sim alone (equal nests on every
                          # seed, own gates, no AI raids, the flight's
                          # verdict, succession) and online (2 pages + 2 raw
                          # clients): CREATE -> versus, sides in the lobby,
                          # the start rule, 2v2, takeover in one's own
                          # colony, each side's HUD/milestones/crystals and
                          # nothing private of the enemy's, messages that
                          # stay on their side, the enemy queen slain
node test/eightprobe.js   # rooms of 8 and the balance by player count: the
                          # sim alone (1 player keeps the old caps, targets
                          # and red rival; 8 get room for the queen to lay,
                          # scaled targets, a bigger rival; spawn spots;
                          # the count only rising; v8 saves + older ones
                          # migrated; a fresh worker when no ant is free),
                          # then raw clients (8 in co-op, the 9th refused,
                          # versus 8v8, a 9th on a side refused, the 17th
                          # turned away, a colour each on a side, a
                          # mid-match joiner's fresh worker, a persistent
                          # world) and a page: the lobby of 8 (co-op) and
                          # 16 (versus) and name tags, as screenshots
                          # (--no-browser skips the page)
node test/netload.js      # one room, 4 bots (--bots N: up to 8), 2 minutes
                          # on a busy colony: server ms/tick (the whole
                          # run's average), CPU, the guard's load, bytes/s
                          # per client (--natural: an uncrowded day-1 colony)
```

© 2026 Lektor Ensrud
