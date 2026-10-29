// MAUR -- UI strings, English / Norwegian. LANG indexes every [en, no] pair.
'use strict';

let LANG = 0;
try { LANG = localStorage.getItem('maur_lang') === 'no' ? 1 : 0; } catch (e) {}

function setLang(no) {
  LANG = no ? 1 : 0;
  try { localStorage.setItem('maur_lang', no ? 'no' : 'en'); } catch (e) {}
}

const STR = {
  // words
  w_on:  ['ON', 'PÅ'],
  w_off: ['OFF', 'AV'],
  w_day: ['DAY', 'DAG'],
  w_score: ['SCORE', 'POENG'],
  w_brood: ['BROOD', 'YNGEL'],
  w_dead: ['DEAD', 'DØD'],
  w_joining: ['JOINING', 'BLIR MED'],
  w_cramped: ['CRAMPED!', 'TRANGT!'],

  // menus & screens
  ui_start: ['PLAY SOLO', 'SPILL ALENE'],
  ui_online: ['PLAY ONLINE', 'SPILL PÅ NETT'],
  ui_help: ['HELP', 'HJELP'],
  ui_sound: ['SOUND: {0}', 'LYD: {0}'],
  ui_crt: ['CRT: {0}', 'CRT: {0}'],
  ui_lang: ['LANGUAGE: ENGLISH', 'SPRÅK: NORSK'],
  ui_tagline: ['AN ANT COLONY UNDER YOUR COMMAND', 'EN MAURKOLONI UNDER DIN KOMMANDO'],
  ui_choose: ['CHOOSE A WORLD', 'VELG EN VERDEN'],
  ui_world: ['WORLD {0}', 'VERDEN {0}'],
  ui_empty: ['EMPTY - A NEW COLONY AWAITS', 'TOM - EN NY KOLONI VENTER'],
  ui_eraseArm: ['X AGAIN TO ERASE!', 'X IGJEN FOR Å SLETTE!'],
  ui_slotKeys: ['ENTER: PLAY', 'ENTER: SPILL'],
  ui_slotKeys2: ['X: ERASE    ESC: BACK', 'X: SLETT    ESC: TILBAKE'],
  ui_pressSpace: ['PRESS SPACE', 'TRYKK MELLOMROM'],
  ui_pressEnter: ['PRESS ENTER', 'TRYKK ENTER'],
  ui_howto: ['HOW TO ANT', 'SLIK MAURER DU'],
  ui_escBack: ['ESC: BACK', 'ESC: TILBAKE'],
  ui_paused: ['PAUSED', 'PAUSE'],
  ui_resume: ['RESUME', 'FORTSETT'],
  ui_saveGame: ['SAVE GAME', 'LAGRE SPILL'],
  ui_saveQuit: ['SAVE + QUIT', 'LAGRE + AVSLUTT'],
  ui_switchAnt: ['SWITCH ANT', 'BYTT MAUR'],
  ui_lendLegs: ['LEND YOUR LEGS ELSEWHERE.', 'LÅN BORT BEINA DINE.'],
  ui_youDied: ['YOU DIED', 'DU DØDE'],
  ui_colonyLives: ['THE COLONY LIVES ON.', 'KOLONIEN LEVER VIDERE.'],
  ui_continueAs: ['CONTINUE AS:', 'FORTSETT SOM:'],
  ui_player: ['PLAYER {0}', 'SPILLER {0}'],
  ui_switchKeys: ['ENTER: SWITCH   ESC: CANCEL', 'ENTER: BYTT   ESC: AVBRYT'],
  // (no ant free in the colony: a new one comes out of the entrance)
  ui_freshWorker: ['A NEW WORKER', 'EN NY ARBEIDER'],
  ui_takeOver: ['ENTER: TAKE OVER', 'ENTER: TA OVER'],
  ui_gameover1: ['THE COLONY', 'KOLONIEN'],
  ui_gameover2: ['HAS PERISHED', 'HAR GÅTT UNDER'],
  ui_survived: ['SURVIVED {0} DAYS', 'OVERLEVDE {0} DAGER'],
  ui_survived_1: ['SURVIVED 1 DAY', 'OVERLEVDE 1 DAG'],
  ui_finalScore: ['FINAL SCORE: {0}', 'SLUTTPOENG: {0}'],
  ui_foodGathered: ['FOOD GATHERED: {0}', 'MAT SANKET: {0}'],
  ui_tasksDone: ['TASKS DONE: {0}', 'OPPDRAG UTFØRT: {0}'],
  ui_antsBorn: ['ANTS BORN: {0}', 'MAUR FØDT: {0}'],
  ui_antsLost: ['ANTS LOST: {0}', 'MAUR MISTET: {0}'],
  ui_predSlain: ['PREDATORS SLAIN: {0}', 'ROVDYR DREPT: {0}'],

  // in-game messages
  m_welcome: ['WELCOME BACK TO THE COLONY', 'VELKOMMEN TILBAKE TIL KOLONIEN'],
  m_gather: ['GATHER FOOD FOR THE COLONY', 'SANK MAT TIL KOLONIEN'],
  m_saved: ['GAME SAVED', 'SPILL LAGRET'],
  m_sound: ['SOUND {0}', 'LYD {0}'],
  m_pDied: ['{0} DIED!', '{0} DØDE!'],
  m_youDied: ['YOU DIED!', 'DU DØDE!'],
  m_queenDead: ['THE QUEEN IS DEAD!', 'DRONNINGEN ER DØD!'],
  m_antDied: ['AN ANT HAS DIED', 'EN MAUR HAR DØDD'],
  m_larvaDied: ['A LARVA HAS PERISHED', 'EN LARVE HAR OMKOMMET'],
  m_slain: ['{0} IS SLAIN!', '{0} ER DREPT!'],
  m_fed: ['FED THE LARVA', 'MATET LARVEN'],
  m_milked: ['MILKED THE APHID! +HONEYDEW', 'MELKET BLADLUSA! +HONNINGDUGG'],
  m_rally: ['RALLY! {0} ANTS ANSWER THE CALL', 'TIL KAMP! {0} MAUR SVARER PÅ ROPET'],
  m_rally_1: ['RALLY! 1 ANT ANSWERS THE CALL', 'TIL KAMP! 1 MAUR SVARER PÅ ROPET'],
  m_follow: ['TO ME! {0} SOLDIERS FOLLOW YOU', 'TIL MEG! {0} SOLDATER FØLGER DEG'],
  m_follow_1: ['TO ME! 1 SOLDIER FOLLOWS YOU', 'TIL MEG! 1 SOLDAT FØLGER DEG'],
  m_rallyAlone: ['RALLY! BUT NO ONE IS NEAR', 'TIL KAMP! MEN INGEN ER I NÆRHETEN'],
  m_noFood: ['NOT ENOUGH FOOD TO HEAL', 'IKKE NOK MAT TIL Å HELBREDE'],
  m_healed: ['SOOTHING TOUCH: {0} HEALED', 'LINDRENDE PLEIE: {0} HELBREDET'],
  m_noRally: ['NO SOLDIERS NEAR ENOUGH TO RALLY', 'INGEN SOLDATER NÆR NOK TIL Å SAMLE'],
  m_noWounded: ['NOBODY IS WOUNDED', 'INGEN ER SÅRET'],
  m_carrying: ['CARRYING {0}', 'BÆRER {0}'],
  m_noSwitch: ['NO OTHER ANTS TO SWITCH TO', 'INGEN ANDRE MAUR Å BYTTE TIL'],
  m_nowPlaying: ['NOW PLAYING: {0}', 'SPILLER NÅ: {0}'],
  m_foodStored: ['+{0} FOOD STORED', '+{0} MAT LAGRET'],
  m_alarm: ['A SOLDIER SOUNDS THE ALARM!', 'EN SOLDAT SLÅR ALARM!'],
  m_emerged: ['A NEW {0} HAS EMERGED!', 'EN NY {0} HAR KOMMET FREM!'],
  m_eggLaid: ['THE QUEEN HAS LAID AN EGG', 'DRONNINGEN HAR LAGT ET EGG'],
  m_starving: ['THE COLONY IS STARVING!', 'KOLONIEN SULTER!'],
  m_newTask: ['NEW TASK: {0}', 'NYTT OPPDRAG: {0}'],
  m_defend: ['NEW TASK: DEFEND THE COLONY!', 'NYTT OPPDRAG: FORSVAR KOLONIEN!'],
  m_taskDone: ['TASK COMPLETE! +{0}', 'OPPDRAG UTFØRT! +{0}'],
  m_complete: ['{0} - COMPLETE!', '{0} - UTFØRT!'],
  m_spider: ['A SPIDER PROWLS THE FOREST FLOOR!', 'EN EDDERKOPP LUSKER PÅ SKOGBUNNEN!'],
  m_centi: ['SOMETHING SLITHERS IN THE DEEP...', 'NOE ÅLER SEG I DYPET...'],
  m_wasp: ['AN ANGRY BUZZ ON THE WIND...', 'EN SINT SUMMING PÅ VINDEN...'],
  m_beetle: ['SOMETHING HEAVY TRUNDLES CLOSER...', 'NOE TUNGT TRAMPER NÆRMERE...'],
  m_raid: ['RED RAIDERS ARE MARCHING ON THE NEST!', 'RØDE RØVERE MARSJERER MOT TUA!'],
  m_raidSteal: ['RED RAIDERS ARE STEALING FROM THE STORES!', 'RØDE RØVERE STJELER FRA LAGRENE!'],
  m_raidOver: ['THE RED RAIDERS RETREAT', 'DE RØDE RØVERNE TREKKER SEG TILBAKE'],
  m_foodStolen: ['FOOD STOLEN! -{0}', 'MAT STJÅLET! -{0}'],
  m_queenFound: ['YOU HAVE FOUND THE RED QUEEN!', 'DU HAR FUNNET DEN RØDE DRONNINGEN!'],
  m_rivalSlain: ['THE RED QUEEN IS SLAIN! +{0} +{1}\x13', 'DEN RØDE DRONNINGEN ER DREPT! +{0} +{1}\x13'],
  m_rivalDied: ['THE RED QUEEN HAS DIED - BUT NOT BY YOUR HAND', 'DEN RØDE DRONNINGEN ER DØD - MEN IKKE FOR DIN HÅND'],
  m_siteFell: ['A FRUIT HAS FALLEN BETWEEN THE NESTS!', 'EN FRUKT HAR FALT MELLOM TUENE!'],
  ui_siteLabel: ['CONTESTED FRUIT', 'OMSTRIDT FRUKT'],

  // tasks
  t_gather: ['GATHER FOOD', 'SANK MAT'],
  t_feed: ['FEED THE LARVAE', 'MAT LARVENE'],
  t_hunt: ['DRIVE OFF {0}', 'JAG BORT {0}'],
  t_dig: ['EXPAND THE CHAMBERS', 'UTVID KAMRENE'],
  t_crystal: ['FIND A CRYSTAL BELOW', 'FINN EN KRYSTALL I DYPET'],

  // underground riches
  m_crystalFound: ['YOU DUG OUT A CRYSTAL!', 'DU GRAVDE FREM EN KRYSTALL!'],

  // building
  mat_packed: ['PACKED EARTH', 'STAMPET JORD'],
  mat_thatch: ['THATCH', 'STRÅ'],
  m_buildMat: ['BUILDING WITH {0}', 'BYGGER MED {0}'],
  m_noSoil: ['NO SOIL - DIG FIRST', 'INGEN JORD - GRAV FØRST'],
  m_noRoom: ['NO ROOM THERE - AIM AT AN OPEN SPACE', 'IKKE PLASS DER - SIKT MOT ET ÅPENT ROM'],
  // blueprints (B: plan mode) and the builders' stocks
  m_planFull: ['THE PLAN IS FULL ({0} PIXELS) - X ERASES', 'BYGGEPLANEN ER FULL ({0} PIKSLER) - X VISKER UT'],
  m_stocked: ['{0} SOIL, {1} THATCH TO THE BUILDERS', '{0} JORD, {1} STRÅ TIL BYGGERNE'],
  m_stockFull: ['THE BUILD STOCK IS FULL', 'BYGGEFORRÅDET ER FULLT'],
  ui_planKeys: ['SPACE: PLAN  X: ERASE  R: MATERIAL  B: DONE', 'MELLOMROM: TEGN  X: VISK UT  R: BYTT  B: FERDIG'],
  ui_planCount: ['PLAN {0}/{1}', 'PLAN {0}/{1}'],
  ui_stockShort: ['STOCK \x0F{0} \x10{1}', 'FORRÅD \x0F{0} \x10{1}'],
  ui_stockLine: ['BUILD STOCK \x0F{0} \x10{1}  PLAN {2}', 'BYGGEFORRÅD \x0F{0} \x10{1}  PLAN {2}'],
  m_noThatch: ['NO THATCH - BITE LEAVES FIRST', 'INGEN STRÅ - BIT AV BLADER FØRST'],

  // chambers
  ch_storage: ['STORAGE', 'LAGER'],
  ch_nursery: ['NURSERY', 'YNGELKAMMER'],
  ch_barracks: ['BARRACKS', 'SOLDATKAMMER'],
  ch_royal: ['ROYAL CHAMBER', 'DRONNINGKAMMER'],
  m_chamberNew: ['NEW CHAMBER: {0}', 'NYTT KAMMER: {0}'],
  m_chamberType: ['MARKED AS {0}', 'MERKET SOM {0}'],
  m_chamberGone: ['CHAMBER MARKER REMOVED', 'KAMMERMERKET ER FJERNET'],
  m_workersDug: ['THE WORKERS HAVE DUG OUT A NEW {0}', 'ARBEIDERNE HAR GRAVD UT ET NYTT {0}'],
  m_lastRoyal: ["THE QUEEN'S ONLY ROYAL CHAMBER CAN'T CHANGE", 'DRONNINGENS ENESTE KAMMER KAN IKKE ENDRES'],
  m_chamberFixed: ["THE NEST'S FIRST {0} CAN'T CHANGE", 'TUAS FØRSTE {0} KAN IKKE ENDRES'],
  m_markDeep: ['MARK CHAMBERS DEEPER UNDERGROUND', 'MERK KAMRE DYPERE UNDER BAKKEN'],
  m_shelterTree: ['CHAMBERS GO UNDERGROUND, APHID SHELTERS BY TREES', 'KAMRE UNDER JORDA, BLADLUSLY VED ET TRE'],
  m_markClose: ['TOO CLOSE TO ANOTHER CHAMBER', 'FOR NÆR ET ANNET KAMMER'],
  m_markCramped: ['TOO CRAMPED - DIG OUT MORE SPACE', 'FOR TRANGT - GRAV UT MER PLASS'],
  m_storageFull: ['STORAGE FULL - DIG AND MARK MORE STORAGE', 'LAGERET ER FULLT - GRAV OG MERK MER LAGER'],
  m_storageFullNpc: ['THE STORES ARE FULL! MARK MORE STORAGE (X)', 'LAGRENE ER FULLE! MERK MER LAGER (X)'],

  // special structures
  mat_gate: ['ANT GATE', 'MAURPORT'],
  ch_fungus: ['FUNGUS GARDEN', 'SOPPHAGE'],
  m_gardenFed: ['THE FUNGUS GARDEN GROWS (\x14{0})', 'SOPPHAGEN VOKSER (\x14{0})'],
  m_gardenFull: ['THE FUNGUS GARDEN IS FULL', 'SOPPHAGEN ER FULL'],
  m_shelterNew: ['APHID SHELTER BUILT! HONEYDEW WILL FLOW', 'BLADLUSLY BYGGET! HONNINGDUGGEN VIL RENNE'],
  m_shelterThatch: ['BUILD MORE THATCH HERE FOR AN APHID SHELTER', 'BYGG MER STRÅ HER FOR ET BLADLUSLY'],
  m_shelterClose: ['TOO CLOSE TO ANOTHER APHID SHELTER', 'FOR NÆR ET ANNET BLADLUSLY'],
  m_shelterMax: ['THE COLONY CAN TEND NO MORE SHELTERS', 'KOLONIEN KAN IKKE STELLE FLERE LY'],
  m_shelterGone: ['AN APHID SHELTER HAS FALLEN APART', 'ET BLADLUSLY HAR FALT SAMMEN'],
  ui_shelter: ['APHID SHELTER', 'BLADLUSLY'],
  ui_shelterIdle: ['DORMANT IN WINTER', 'HVILER OM VINTEREN'],
  ui_shelterWeak: ['NEEDS MORE THATCH!', 'TRENGER MER STRÅ!'],

  // the year
  season_spring: ['SPRING', 'VÅR'],
  season_summer: ['SUMMER', 'SOMMER'],
  season_autumn: ['AUTUMN', 'HØST'],
  season_winter: ['WINTER', 'VINTER'],
  m_season: ['A NEW SEASON: {0}, YEAR {1}', 'NY ÅRSTID: {0}, ÅR {1}'],
  m_seasonDone: ['SEASON OVER: {0}/3 MILESTONES', 'ÅRSTIDEN ER OVER: {0}/3 DELMÅL'],
  m_milestone: ['DONE: {0}! +{1}\x13', 'NÅDD: {0}! +{1}\x13'],
  m_cold: ['THE COLD BITES! GET UNDER THE MOUND OR BELOW', 'KULDEN BITER! SØK LY UNDER TUA ELLER JORDA'],
  m_royalEgg: ['THE QUEEN HAS LAID A ROYAL EGG', 'DRONNINGEN HAR LAGT ET KONGELIG EGG'],
  m_princess: ['A PRINCESS HAS EMERGED!', 'EN PRINSESSE HAR KOMMET FREM!'],
  m_newQueen: ['A PRINCESS IS CROWNED THE NEW QUEEN!', 'EN PRINSESSE KRONES TIL NY DRONNING!'],
  m_flight: ['THE NUPTIAL FLIGHT! {0} PRINCESSES TAKE WING', 'BRYLLUPSFLUKTEN! {0} PRINSESSER LETTER'],
  m_flight1: ['THE NUPTIAL FLIGHT! A PRINCESS TAKES WING', 'BRYLLUPSFLUKTEN! EN PRINSESSE LETTER'],
  m_nestFull: ['NEST FULL: DIG OUT AND MARK A NURSERY (X)', 'TUA ER FULL: GRAV UT OG MERK ET YNGELKAMMER (X)'],
  m_objHint: ['PRESS O FOR OBJECTIVES AND UPGRADES', 'TRYKK O FOR MÅL OG OPPGRADERINGER'],
  m_noFlight: ['SPRING, BUT NO PRINCESS TO FLY...', 'VÅR, MEN INGEN PRINSESSE Å SENDE UT...'],

  // milestones
  o_storage2: ['MARK {0} STORAGE CHAMBERS', 'MERK {0} LAGERKAMRE'],
  o_raise: ['RAISE {0} NEW ANTS', 'AL OPP {0} NYE MAUR'],
  o_food100: ['STORE {0} FOOD', 'LAGRE {0} MAT'],
  o_mound: ['THATCH A MOUND OVER THE ENTRANCE', 'BYGG EN STRÅTUE OVER INNGANGEN'],
  o_pop25: ['GROW TO {0} ANTS', 'VOKS TIL {0} MAUR'],
  o_contested: ['BRING HOME {0} PIECES OF CONTESTED FRUIT', 'BÆR HJEM {0} FRUKTBITER FRA STRIDSPLASSEN'],
  o_stockpile: ['{0} FOOD STORED AS WINTER COMES', '{0} MAT PÅ LAGER NÅR VINTEREN KOMMER'],
  o_royal: ['DIG A ROOMY ROYAL CHAMBER', 'GRAV ET ROMSLIG DRONNINGKAMMER'],
  o_princess: ['RAISE A PRINCESS', 'AL OPP EN PRINSESSE'],
  o_queen: ['KEEP THE QUEEN ALIVE', 'HOLD DRONNINGEN I LIVE'],
  o_sealed: ['KEEP THE ENTRANCE SEALED OR GATED', 'HOLD INNGANGEN STENGT MED JORD ELLER PORT'],
  o_centipedes: ['KILL 3 CENTIPEDES', 'DREP 3 TUSENBEIN'],

  // crystal upgrades
  up_mandibles: ['MANDIBLES', 'KJEVER'],
  up_digging: ['DIGGING', 'GRAVING'],
  up_armor: ['SOLDIER ARMOR', 'SOLDATRUSTNING'],
  up_carry: ['CARRY SPEED', 'BÆREHASTIGHET'],
  upd_mandibles: ['EVERY ANT BITES 25% HARDER A LEVEL', 'ALLE MAUR BITER 25% HARDERE PER NIVÅ'],
  upd_digging: ['BIGGER, FASTER BITES FOR EVERY ANT', 'STØRRE OG RASKERE BITT FOR ALLE MAUR'],
  upd_armor: ['SOLDIERS TAKE 20% LESS DAMAGE A LEVEL', 'SOLDATER TAR 20% MINDRE SKADE PER NIVÅ'],
  upd_carry: ['LADEN ANTS WALK 12% FASTER A LEVEL', 'LASTEDE MAUR GÅR 12% RASKERE PER NIVÅ'],
  m_crystal: ['THE CRYSTAL JOINS THE HOARD! (\x13{0})', 'KRYSTALLEN HAVNER I SKATTEN! (\x13{0})'],
  m_upgraded: ['UPGRADE: {0}, LEVEL {1}', 'OPPGRADERING: {0}, NIVÅ {1}'],
  m_upgMax: ['ALREADY AT THE TOP LEVEL', 'ALLEREDE PÅ HØYESTE NIVÅ'],
  m_noCrystals: ['NOT ENOUGH CRYSTALS - NEEDS {0}', 'IKKE NOK KRYSTALLER - TRENGER {0}'],

  // the objectives screen (O)
  ui_objectives: ['OBJECTIVES', 'MÅL'],
  ui_upgrades: ['UPGRADES', 'OPPGRADERINGER'],
  ui_seasonYear: ['{0} - YEAR {1}', '{0} - ÅR {1}'],
  ui_daysLeft: ['{0} DAYS LEFT', '{0} DAGER IGJEN'],
  ui_daysLeft_1: ['1 DAY LEFT', '1 DAG IGJEN'],
  ui_lastDay: ['LAST DAY', 'SISTE DAG'],
  ui_atEnd: ['JUDGED AS THE SEASON ENDS', 'AVGJØRES NÅR ÅRSTIDEN ER OVER'],
  ui_mound: ['MOUND: {0} THATCH', 'TUE: {0} STRÅ'],
  ui_sealed: ['ENTRANCE SEALED', 'INNGANGEN STENGT'],
  ui_open: ['ENTRANCE OPEN', 'INNGANGEN ÅPEN'],
  ui_crystals: ['CRYSTALS: {0}', 'KRYSTALLER: {0}'],
  ui_yearGoal: ['RAISE PRINCESSES FOR SPRING OF YEAR {0}', 'AL OPP PRINSESSER TIL VÅREN I ÅR {0}'],
  ui_rival: ['RED COLONY: ABOUT {0} ANTS', 'DEN RØDE KOLONIEN: CA. {0} MAUR'],
  ui_rivalSlain: ['THE RED QUEEN IS SLAIN', 'DEN RØDE DRONNINGEN ER DREPT'],
  ui_rivalDied: ['THE RED QUEEN IS DEAD', 'DEN RØDE DRONNINGEN ER DØD'],
  ui_score: ['SCORE: {0}', 'POENG: {0}'],
  ui_rivalQueen: ['QUEEN {0}%', 'DRONNING {0}%'],
  ui_storeCap: ['STORES HOLD {0}: MARK MORE STORAGE (X)', 'LAGRENE RYMMER {0}: MERK MER LAGER (X)'],
  ui_seasonDay: ['{0} D{1}', '{0} D{1}'],
  ui_level: ['LV {0}', 'NIVÅ {0}'],
  ui_max: ['MAX', 'MAKS'],
  ui_objKeys: ['LEFT/RIGHT: PAGE    O/ESC: CLOSE', 'VENSTRE/HØYRE: SIDE    O/ESC: LUKK'],
  ui_upgKeys: ['ENTER: BUY   LEFT/RIGHT: PAGE   O: CLOSE', 'ENTER: KJØP  VENSTRE/HØYRE: SIDE  O: LUKK'],

  // the year's end
  ui_winTitle: ['NUPTIAL FLIGHT!', 'BRYLLUPSFLUKT!'],
  ui_noFlight1: ['THE YEAR ENDS', 'ÅRET ER OMME'],
  ui_noFlight2: ['WITHOUT A FLIGHT', 'UTEN BRYLLUPSFLUKT'],
  r_queen: ['THE QUEEN DIED WITH NO HEIR', 'DRONNINGEN DØDE UTEN ARVING'],
  r_extinct: ['THE LAST ANT HAS FALLEN', 'DEN SISTE MAUREN HAR FALT'],
  r_flight: ['{0} PRINCESSES FLEW OUT TO FOUND NEW NESTS', '{0} PRINSESSER FLØY UT FOR Å GRUNNLEGGE NYE TUER'],
  r_flight1: ['A PRINCESS FLEW OUT TO FOUND A NEW NEST', 'EN PRINSESSE FLØY UT FOR Å GRUNNLEGGE EN NY TUE'],
  r_noFlight: ['NO PRINCESS WAS RAISED IN TIME', 'INGEN PRINSESSE BLE ALT OPP I TIDE'],
  ui_milestones: ['MILESTONES: {0}/12', 'DELMÅL: {0}/12'],
  ui_colonySize: ['COLONY: {0} ANTS', 'KOLONI: {0} MAUR'],
  ui_colonySize_1: ['COLONY: 1 ANT', 'KOLONI: 1 MAUR'],
  ui_rivalWon: ['RIVAL: BIGGER THAN THE RED COLONY', 'RIVAL: STØRRE ENN DEN RØDE KOLONIEN'],
  ui_rivalLost: ['RIVAL: THE RED COLONY IS BIGGER', 'RIVAL: DEN RØDE KOLONIEN ER STØRRE'],
  ui_rivalDead: ['RIVAL: THE RED QUEEN IS DEAD', 'RIVAL: DEN RØDE DRONNINGEN ER DØD'],
  ui_continue: ['CONTINUE THE COLONY', 'FORTSETT KOLONIEN'],
  ui_toTitle: ['RETURN TO TITLE', 'TILBAKE TIL TITTEL'],

  // the HUD: season and year, day and clock
  ui_hudSeason: ['{0} Y{1}', '{0}, ÅR {1}'],
  ui_hudClock: ['DAY {0} {1}', 'DAG {0} {1}'],

  // the guide arrow (G) and the hints (spring of year 1 is the tutorial)
  ui_hints: ['HINTS: {0}', 'TIPS: {0}'],
  m_arrow: ['GUIDE ARROW {0} (G)', 'VEIVISERPIL {0} (G)'],
  m_hintsOff: ['HINTS OFF - TURN THEM BACK ON IN THE MENU', 'TIPS AV - SLÅ DEM PÅ IGJEN I MENYEN'],
  ui_hintHead: ['HINT {0}/{1}', 'TIPS {0}/{1}'],
  ui_hintKeys: ['H: SKIP', 'H: HOPP OVER'],
  h_move: ['WALK WITH WASD OR THE ARROW KEYS.\nHOLD UP AGAINST A WALL TO CLIMB IT.',
    'GÅ MED WASD ELLER PILTASTENE.\nHOLD W ELLER PIL OPP MOT EN VEGG FOR Å KLATRE.'],
  h_dig: ['SPACE BITES AND DIGS. THE SOIL YOU\nDIG FILLS YOUR LOAD (THE BROWN BAR).',
    'MELLOMROM BITER OG GRAVER. JORDA DU\nGRAVER HAVNER I LASTEN (BRUN SØYLE).'],
  h_food: ['FIND FOOD ON THE FOREST FLOOR. E PICKS\nIT UP, E AT THE STORAGE STORES IT.',
    'FINN MAT PÅ SKOGBUNNEN. E PLUKKER\nDEN OPP, E VED LAGERET LEGGER DEN INN.'],
  h_build: ['HOLD F TO BUILD (YOU AIM), R: MATERIAL.\nB: PLAN A BLUEPRINT - THE WORKERS BUILD IT.',
    'HOLD F FOR Å BYGGE (DU SIKTER), R: MATERIALE.\nB: TEGN EN BYGGEPLAN - ARBEIDERNE BYGGER DEN.'],
  h_mark: ['DIG OUT A HOLLOW DEEP DOWN AND PRESS X\nIN IT TO MARK A CHAMBER. X AGAIN: TYPE.',
    'GRAV UT ET HULROM DYPT NEDE OG TRYKK X\nDER INNE FOR Å MERKE ET KAMMER. X IGJEN: TYPE.'],
  h_obj: ["PRESS O FOR THE SEASON'S MILESTONES\nAND THE CRYSTAL UPGRADES.",
    'TRYKK O FOR ÅRSTIDENS DELMÅL\nOG KRYSTALLOPPGRADERINGENE.'],
  h_tab: ['C SWITCHES TO ANOTHER ANT: A SOLDIER\nFIGHTS AND RALLIES (Q), A NURSE HEALS.',
    'C BYTTER TIL EN ANNEN MAUR: SOLDATEN\nSLÅSS OG SAMLER TROPPER (Q), PLEIEREN LEGER.'],
  h_done: ['THAT IS THE BASICS. THE ARROW (G) POINTS\nTHE WAY TO YOUR NEXT MILESTONE.',
    'DET VAR DET VIKTIGSTE. PILEN (G) VISER\nVEIEN TIL NESTE DELMÅL.'],

  // the raid alert
  ui_raidMarch: ['RAID! RED ANTS MARCH ON THE NEST', 'ANGREP! RØDE MAUR MARSJERER MOT TUA'],
  ui_raidNest: ['RAID! RED ANTS AT THE NEST', 'ANGREP! RØDE MAUR VED TUA'],
  ui_raidSteal: ['RAID! THIEVES IN THE STORES', 'ANGREP! TYVER I LAGERET'],
  ui_raidFlee: ['THIEVES FLEE WITH OUR FOOD!', 'TYVER FLYKTER MED MATEN VÅR!'],

  // the map's legend (short names)
  lg_storage: ['STORAGE', 'LAGER'],
  lg_nursery: ['NURSERY', 'YNGEL'],
  lg_barracks: ['BARRACKS', 'SOLDATER'],
  lg_royal: ['ROYAL', 'DRONNING'],
  lg_fungus: ['FUNGUS', 'SOPPHAGE'],
  lg_shelter: ['APHIDS', 'BLADLUS'],
  lg_gate: ['ANT GATE', 'MAURPORT'],
  lg_mound: ['MOUND', 'TUE'],
  lg_fruit: ['FRUIT', 'FRUKT'],
  lg_red: ['RED NEST', 'RØD TUE'],
  ui_ourNest: ['OUR NEST', 'VÅR TUE'],

  // online: the menus and the lobby
  ui_onlineTitle: ['ONLINE', 'PÅ NETT'],
  ui_yourName: ['YOUR NAME', 'DITT NAVN'],
  ui_nameKeys: ['TYPE YOUR NAME   ENTER: OK   ESC: BACK', 'SKRIV NAVNET DITT   ENTER: OK   ESC: TILBAKE'],
  ui_create: ['CREATE A MATCH', 'OPPRETT ET SPILL'],
  ui_joinCode: ['JOIN WITH A CODE', 'BLI MED VIA KODE'],
  ui_back: ['BACK', 'TILBAKE'],
  ui_coopNote: ['1-8 PLAYERS, ONE COLONY, ONE YEAR', '1-8 SPILLERE, EN KOLONI, ETT ÅR'],
  ui_onlineNote: ['PERSISTENT WORLDS, CO-OP AND VERSUS', 'VARIGE VERDENER, SAMARBEID OG KAMP'],
  ui_worlds: ['PERSISTENT WORLDS', 'VARIGE VERDENER'],
  ui_openMatches: ['OPEN MATCHES', 'ÅPNE SPILL'],
  ui_worldsNote: ['DROP IN ANY TIME - THE COLONY LIVES ON', 'BLI MED NÅR DU VIL - KOLONIEN LEVER VIDERE'],
  ui_createNote: ['CO-OP OR VERSUS, PUBLIC OR PRIVATE', 'SAMARBEID ELLER KAMP, ÅPENT ELLER PRIVAT'],
  ui_joinNote: ["WITH A FRIEND'S ROOM CODE", 'MED ROMKODEN TIL EN VENN'],
  ui_openNote: ['PUBLIC MATCHES WITH ROOM FOR MORE', 'ÅPNE SPILL MED LEDIG PLASS'],
  ui_underWay: ['UNDER WAY', 'I GANG'],
  ui_inLobby: ['IN THE LOBBY', 'I LOBBYEN'],
  ui_listing: ['ASKING THE SERVER...', 'SPØR SERVEREN...'],
  ui_noWorlds: ['NO WORLDS ON THIS SERVER', 'INGEN VERDENER PÅ DENNE SERVEREN'],
  ui_noOpen: ['NO OPEN MATCHES - CREATE ONE!', 'INGEN ÅPNE SPILL - OPPRETT ET!'],
  ui_asleep: ['ASLEEP', 'SOVER'],
  ui_legacyN: ['LEGACY {0}', 'ARV {0}'],
  ui_worldColony: ['COLONY {0}', 'KOLONI {0}'],
  ui_serverFull: ['THE SERVER IS FULL RIGHT NOW', 'SERVEREN ER FULL AKKURAT NÅ'],
  ui_modeCoop: ['CO-OP', 'SAMARBEID'],
  ui_modeVersus: ['VERSUS', 'KAMP'],
  ui_hostIs: ['HOST: {0}', 'VERT: {0}'],
  ui_crMode: ['MODE: {0}', 'MODUS: {0}'],
  ui_crVis: ['VISIBILITY: {0}', 'SYNLIGHET: {0}'],
  ui_public: ['PUBLIC', 'ÅPEN'],
  ui_private: ['PRIVATE', 'PRIVAT'],
  ui_crGo: ['CREATE', 'OPPRETT'],
  ui_versusNote: ['BLACK AGAINST RED, 1-8 PLAYERS A SIDE', 'SVART MOT RØD, 1-8 SPILLERE PÅ HVER SIDE'],
  ui_pubNote: ['PUBLIC: LISTED UNDER OPEN MATCHES', 'ÅPEN: VISES UNDER ÅPNE SPILL'],
  ui_privNote: ['PRIVATE: JOIN BY ROOM CODE ONLY', 'PRIVAT: BARE MED ROMKODE'],
  ui_crKeys: ['UP/DOWN: CHOOSE  LEFT/RIGHT: CHANGE  ENTER: OK', 'OPP/NED: VELG  VENSTRE/HØYRE: ENDRE  ENTER: OK'],
  ui_lobbyPub: ['PUBLIC - LISTED UNDER OPEN MATCHES', 'ÅPEN - VISES UNDER ÅPNE SPILL'],
  ui_lobbyPriv: ['PRIVATE - JOIN BY CODE ONLY', 'PRIVAT - BARE MED KODE'],
  ui_lobbyHostKeys: ['UP/DOWN + X: KICK   TAB: PUBLIC/PRIVATE', 'OPP/NED + X: KAST UT   TAB: ÅPEN/PRIVAT'],
  ui_sideKeys: ['LEFT/RIGHT: PICK YOUR SIDE', 'VENSTRE/HØYRE: VELG SIDE'],
  ui_needSides: ['A PLAYER ON EACH SIDE TO START', 'EN SPILLER PÅ HVER SIDE FOR Å STARTE'],
  ui_black: ['BLACK', 'SVART'],
  ui_red: ['RED', 'RØD'],
  ui_leaveWorld: ['LEAVE WORLD', 'FORLAT VERDENEN'],
  ui_enterCode: ['TYPE THE ROOM CODE', 'SKRIV ROMKODEN'],
  ui_codeKeys: ['ENTER: JOIN   ESC: BACK', 'ENTER: BLI MED   ESC: TILBAKE'],
  ui_connecting: ['CONNECTING...', 'KOBLER TIL...'],
  ui_loading: ['LOADING THE WORLD...', 'LASTER VERDENEN...'],
  ui_roomCode: ['ROOM CODE', 'ROMKODE'],
  ui_shareCode: ['FRIENDS JOIN WITH THIS CODE', 'DEL KODEN MED VENNENE DINE'],
  ui_lobbyPlayers: ['PLAYERS {0}/{1}', 'SPILLERE {0}/{1}'],
  ui_host: ['HOST', 'VERT'],
  ui_you: ['YOU', 'DU'],
  ui_offline: ['OFF', 'BORTE'],   // (a lobby tag: short, the name is dimmed too)
  ui_hostStart: ['ENTER: START THE MATCH', 'ENTER: START SPILLET'],
  ui_waitHost: ['WAITING FOR THE HOST TO START...', 'VENTER PÅ AT VERTEN STARTER...'],
  ui_inProgress: ['THE MATCH IS ON - JOINING...', 'SPILLET ER I GANG - BLIR MED...'],
  ui_lobbyLeave: ['H: HOW TO PLAY   ESC: LEAVE', 'H: SLIK SPILLER DU   ESC: FORLAT'],
  ui_scores: ['SCORES', 'POENG'],
  ui_scoreCols: ['KILLS,DEATHS,FOOD,DUG,BUILT', 'DREP,DØD,MAT,GRAVD,BYGD'],
  ui_helpKeys: ['LEFT/RIGHT: PAGE {0}/{1}   ESC: BACK', 'VENSTRE/HØYRE: SIDE {0}/{1}   ESC: TILBAKE'],
  m_helpHint: ['ESC > HELP: HOW THE MATCH WORKS', 'ESC > HJELP: SLIK VIRKER SPILLET'],
  ui_menu: ['MENU', 'MENY'],
  ui_worldRuns: ['THE WORLD KEEPS RUNNING', 'VERDENEN GÅR VIDERE'],
  ui_leaveMatch: ['LEAVE MATCH', 'FORLAT SPILLET'],
  ui_netLost: ['CONNECTION LOST - RECONNECTING', 'MISTET FORBINDELSEN - KOBLER TIL IGJEN'],
  ui_joinColony: ['JOIN THE COLONY', 'BLI MED I KOLONIEN'],
  ui_pickAnt: ['PICK AN ANT TO PLAY.', 'VELG EN MAUR Å SPILLE SOM.'],
  ui_matchOver: ['THE MATCH IS OVER', 'SPILLET ER OVER'],
  m_netJoined: ['{0} JOINED THE COLONY', '{0} BLE MED I KOLONIEN'],
  m_netLeft: ['{0} LEFT THE MATCH', '{0} FORLOT SPILLET'],
  m_netDropped: ['{0} LOST THE CONNECTION', '{0} MISTET FORBINDELSEN'],
  m_netBack: ['{0} IS BACK', '{0} ER TILBAKE'],
  m_coopStart: ['YOUR COLONY: {0} PLAYERS. GOOD LUCK!', 'KOLONIEN DERES: {0} SPILLERE. LYKKE TIL!'],
  m_coopStart_1: ['YOUR COLONY AWAITS. GOOD LUCK!', 'KOLONIEN DIN VENTER. LYKKE TIL!'],
  m_vsBlack: ['YOU ARE BLACK - SLAY THE RED QUEEN!', 'DU ER SVART - DREP DEN RØDE DRONNINGEN!'],
  m_vsRed: ['YOU ARE RED - SLAY THE BLACK QUEEN!', 'DU ER RØD - DREP DEN SVARTE DRONNINGEN!'],
  m_worldWelcome: ['WELCOME TO {0} - COLONY {1}, YEAR {2}', 'VELKOMMEN TIL {0} - KOLONI {1}, ÅR {2}'],
  m_legacy: ['THE FLIGHT BANKED {0} LEGACY (TOTAL {1})', 'FLUKTEN GA {0} I ARV (TOTALT {1})'],
  m_reborn: ['THE COLONY IS LOST - COLONY {0} BEGINS', 'KOLONIEN ER TAPT - KOLONI {0} BEGYNNER'],
  m_queenFoundVs: ['YOU HAVE FOUND THE ENEMY QUEEN!', 'DU HAR FUNNET FIENDENS DRONNING!'],
  m_queenAttacked: ['OUR QUEEN IS UNDER ATTACK!', 'DRONNINGEN VÅR BLIR ANGREPET!'],
  ui_rebornNote: ['COLONY {0} BEGINS - PICK AN ANT', 'KOLONI {0} BEGYNNER - VELG EN MAUR'],

  // online: the persistent world's story, the versus match
  ui_history: ['WORLD HISTORY', 'VERDENENS HISTORIE'],
  ui_legacyLine: ['LEGACY {0} - COLONY {1} - FLIGHT: SPRING YEAR {2}', 'ARV {0} - KOLONI {1} - FLUKT: VÅREN I ÅR {2}'],
  ui_noHistory: ['NOTHING YET: THE FIRST FLIGHT IS IN YEAR 2', 'INGENTING ENNÅ: FØRSTE FLUKT ER I ÅR 2'],
  ui_histNote: ['LEGACY PER FLIGHT: STAR X100, PRINCESS X50', 'ARV PER FLUKT: STJERNE X100, PRINSESSE X50'],
  h_when: ['COLONY {0}, YEAR {1}', 'KOLONI {0}, ÅR {1}'],
  h_flight: ['FLIGHT', 'FLUKT'],
  h_noFlight: ['NO FLIGHT', 'INGEN FLUKT'],
  h_lost: ['LOST', 'TAPT'],
  ui_enemy: ['ENEMY COLONY: ABOUT {0} ANTS', 'FIENDEN: CA. {0} MAUR'],
  ui_ourQueen: ['OUR QUEEN {0}%', 'VÅR DRONNING {0}%'],
  ui_vsGoal: ['SLAY THEIR QUEEN, OR WIN THE FLIGHT IN YEAR {0}', 'DREP FIENDENS DRONNING ELLER VINN FLUKTEN I ÅR {0}'],
  lg_enemy: ['ENEMY', 'FIENDE'],
  ui_vsWin: ['VICTORY!', 'SEIER!'],
  ui_vsLose: ['DEFEAT', 'NEDERLAG'],
  ui_vsDraw: ['A DRAW', 'UAVGJORT'],
  ui_vsWinner0: ['THE BLACK ANTS WIN', 'DE SVARTE MAURENE VINNER'],
  ui_vsWinner1: ['THE RED ANTS WIN', 'DE RØDE MAURENE VINNER'],
  r_vsQueen0: ['THE BLACK QUEEN FELL WITH NO HEIR', 'DEN SVARTE DRONNINGEN FALT UTEN ARVING'],
  r_vsQueen1: ['THE RED QUEEN FELL WITH NO HEIR', 'DEN RØDE DRONNINGEN FALT UTEN ARVING'],
  r_vsExtinct0: ['THE BLACK COLONY IS WIPED OUT', 'DEN SVARTE KOLONIEN ER UTRYDDET'],
  r_vsExtinct1: ['THE RED COLONY IS WIPED OUT', 'DEN RØDE KOLONIEN ER UTRYDDET'],
  r_vsFlight: ['THE NUPTIAL FLIGHTS DECIDED IT', 'BRYLLUPSFLUKTENE AVGJORDE DET'],
  r_vsDraw: ['THE FLIGHTS WERE EVEN', 'FLUKTENE VAR LIKE GODE'],
  ui_vsStars: ['STARS', 'STJERNER'],
  ui_vsFlown: ['PRINCESSES', 'PRINSESSER'],
  ui_vsAnts: ['ANTS', 'MAUR'],
  ui_vsMiles: ['MILESTONES', 'DELMÅL'],

  // online: what can go wrong
  e_noRoom: ['NO MATCH WITH THAT CODE', 'FANT INGEN SPILL MED DEN KODEN'],
  e_full: ['THAT MATCH IS FULL', 'DET SPILLET ER FULLT'],
  e_over: ['THAT MATCH HAS ENDED', 'DET SPILLET ER OVER'],
  e_busy: ['SERVER FULL - TRY AGAIN IN A LITTLE WHILE', 'SERVEREN ER FULL - PRØV IGJEN OM LITT'],
  e_kicked: ['THE HOST REMOVED YOU FROM THE MATCH', 'VERTEN KASTET DEG UT AV SPILLET'],
  e_sides: ['VERSUS NEEDS A PLAYER ON EACH SIDE', 'KAMP TRENGER EN SPILLER PÅ HVER SIDE'],
  e_sideFull: ['THAT SIDE IS FULL (2 AT MOST)', 'DEN SIDEN ER FULL (HØYST 2)'],
  e_noWorld: ['NO WORLD BY THAT NAME', 'FANT INGEN VERDEN MED DET NAVNET'],
  e_mode: ['UNKNOWN GAME MODE', 'UKJENT SPILLMODUS'],
  e_notHost: ['ONLY THE HOST CAN DO THAT', 'BARE VERTEN KAN GJØRE DET'],
  e_started: ['THE MATCH HAS STARTED', 'SPILLET HAR STARTET'],
  e_crash: ['THE MATCH CRASHED - SORRY!', 'SPILLET KRASJET - BEKLAGER!'],
  e_version: ['A NEW VERSION IS OUT - RELOAD THE PAGE', 'NY VERSJON - LAST INN SIDEN PÅ NYTT'],
  e_conn: ['CANNOT REACH THE SERVER', 'FÅR IKKE KONTAKT MED SERVEREN'],
  e_lost: ['THE CONNECTION WAS LOST', 'FORBINDELSEN BLE BRUTT'],
  e_closed: ['THE MATCH WAS CLOSED', 'SPILLET BLE STENGT'],
  e_noName: ['TYPE A NAME FIRST', 'SKRIV ET NAVN FØRST'],
  e_noSlot: ['YOUR PLACE IN THE MATCH IS GONE', 'PLASSEN DIN I SPILLET ER BORTE'],
  e_elsewhere: ['YOU JOINED FROM ANOTHER WINDOW', 'DU BLE MED FRA ET ANNET VINDU'],
  e_generic: ['SOMETHING WENT WRONG', 'NOE GIKK GALT'],
};

function L(key) {
  const e = STR[key];
  let s = e ? e[LANG] : key;
  for (let i = 1; i < arguments.length; i++) s = s.replace('{' + (i - 1) + '}', arguments[i]);
  return s;
}

// a count in a sentence: `key` with n as {0} (more args follow as {1}...),
// or its singular `key_1` when n is 1 and the string has one ("SURVIVED 1
// DAY", "1 PRINSESSE"). Norwegian and English share the rule: 1 is singular.
function Ln(key, n, ...rest) {
  const k = Math.round(n) === 1 && STR[key + '_1'] ? key + '_1' : key;
  return L(k, n, ...rest);
}

// names (definite forms where English needs "THE ...")
const CASTE_NAME = {
  worker: ['WORKER', 'ARBEIDER'],
  soldier: ['SOLDIER', 'SOLDAT'],
  nurse: ['NURSE', 'PLEIER'],
  queen: ['QUEEN', 'DRONNING'],
  princess: ['PRINCESS', 'PRINSESSE'],
};
function casteName(c) { return (CASTE_NAME[c] || [c, c])[LANG]; }

const BUG_NAME_DEF = {
  spider: ['THE SPIDER', 'EDDERKOPPEN'],
  centipede: ['THE CENTIPEDE', 'TUSENBEINET'],
  wasp: ['THE WASP', 'VEPSEN'],
  beetle: ['THE BEETLE', 'BILLEN'],
  aphid: ['THE APHID', 'BLADLUSA'],
  pillbug: ['THE PILLBUG', 'SKRUKKETROLLET'],
  worm: ['THE WORM', 'MARKEN'],
};
function bugNameDef(k) {
  return (BUG_NAME_DEF[k] || ['THE ' + String(k).toUpperCase(), String(k).toUpperCase()])[LANG];
}

const BROOD_NAME_DEF = {
  egg: ['THE EGG', 'EGGET'],
  larva: ['THE LARVA', 'LARVEN'],
};
function broodNameDef(k) { return (BROOD_NAME_DEF[k] || [k, k])[LANG]; }

// simulation messages arrive as { key, args }; an arg may be a name token
// ({ caste }, { bug }, { brood }, { key }) translated here, on the client
function msgArg(a) {
  if (a && typeof a === 'object') {
    if (a.player !== undefined) return playerName(a.player);
    if (a.caste) return casteName(a.caste);
    if (a.bug) return bugNameDef(a.bug);
    if (a.brood) return broodNameDef(a.brood);
    if (a.key) return L(a.key, ...(a.args || []));
  }
  return a;
}
// a player by index: its name online, PLAYER n offline
function playerName(i) {
  const p = typeof G !== 'undefined' && G.players[i];
  return p && p.name ? p.name : L('ui_player', i + 1);
}

// an error key from the server (or the connection) as text
function errText(key) { return STR[key] ? L(key) : L('e_generic'); }

// (a count of 1 as the first arg picks the singular, as in Ln)
function msgText(m) {
  const args = (m.args || []).map(msgArg);
  return args.length && typeof args[0] === 'number' ? Ln(m.key, ...args) : L(m.key, ...args);
}

// tasks carry type (+ kind for hunts), not baked text -- translated at draw
// time so saves stay language-neutral. Older saves' hunt tasks lack kind;
// fall back to looking the bug up while it's still alive.
function taskText(t) {
  switch (t.type) {
    case 'gather': return L('t_gather');
    case 'feed': return L('t_feed');
    case 'dig': return L('t_dig');
    case 'crystal': return L('t_crystal');
    case 'hunt': {
      const k = t.kind || (G.bugs.find(b => b.id === t.targetId) || {}).kind;
      return L('t_hunt', k ? bugNameDef(k) : '?');
    }
  }
  return t.text || t.type;
}

function introText() {
  return LANG === 1 ? [
    'VÅR. TELEN HAR SLUPPET TAKET.',
    '',
    'DYPT UNDER SKOGBUNNEN RØRER',
    'EN UNG DRONNING PÅ SEG. KOLONIEN',
    'HENNES ER LITEN, SULTEN OG',
    'OMRINGET AV TING SOM BITER.',
    '',
    'DU ER EN AV ARBEIDERNE HENNES.',
    'GRAV. SANK. MAT YNGELEN.',
    'FORSVAR TUA.',
    '',
    'AL OPP PRINSESSER I ÅR: VÅREN',
    'I ÅR 2 FLYR DE UT PÅ',
    'BRYLLUPSFLUKTEN.',
    '',
    'KOLONIEN MÅ OVERLEVE.',
  ] : [
    'SPRING. THE THAW HAS COME.',
    '',
    'DEEP BENEATH THE FOREST FLOOR,',
    'A YOUNG QUEEN STIRS. HER COLONY',
    'IS SMALL, HUNGRY, AND SURROUNDED',
    'BY THINGS THAT BITE.',
    '',
    'YOU ARE ONE OF HER WORKERS.',
    'DIG. FORAGE. FEED THE BROOD.',
    'DEFEND THE NEST.',
    '',
    'RAISE PRINCESSES THIS YEAR: IN',
    'THE SPRING OF YEAR 2 THEY TAKE',
    'WING ON THE NUPTIAL FLIGHT.',
    '',
    'THE COLONY MUST SURVIVE.',
  ];
}

function helpText() {
  return LANG === 1 ? [
    ['KONTROLLER', '#ffe080'],
    ['  WASD / PILER .. GÅ / KLATRE', '#c8b890'],
    ['  MELLOMROM ..... BIT / GRAV', '#c8b890'],
    ['  E ............. PLUKK OPP / BRUK', '#c8b890'],
    ['  Q ............. EVNE (SAMLE / LEGE)', '#c8b890'],
    ['  C ............. BYTT MAUR (HOLD TAB: POENG)', '#c8b890'],
    ['  F (HOLD) / B .. BYGG / BYGGEPLAN', '#c8b890'],
    ['  R ............. JORD / STRÅ / MAURPORT', '#c8b890'],
    ['  X ............. MERK KAMMER / BLADLUSLY', '#c8b890'],
    ['  O ............. MÅL / OPPGRADERINGER', '#c8b890'],
    ['M: KART  G: PIL  H: HOPP OVER TIPS  ESC: PAUSE', '#a09070'],
    ['BÆR MAT TIL LAGERET. MERK KAMRE FOR Å VOKSE.', '#a8e8a0'],
    ['AL OPP PRINSESSER OM HØSTEN: NESTE VÅR', '#a8e8a0'],
    ['FLYR DE UT. DRONNINGEN MÅ LEVE!', '#a8e8a0'],
    ['VINTEREN FRYSER: BYGG STRÅTUE OG SAMLE MAT.', '#a8e8a0'],
    ['BONUS: DREP DEN RØDE DRONNINGEN I ØST.', '#ff9080'],
  ] : [
    ['CONTROLS', '#ffe080'],
    ['  WASD / ARROWS . MOVE / CLIMB', '#c8b890'],
    ['  SPACE ......... BITE / DIG', '#c8b890'],
    ['  E ............. PICK UP / USE', '#c8b890'],
    ['  Q ............. ABILITY (RALLY / HEAL)', '#c8b890'],
    ['  C ............. SWITCH ANT (HOLD TAB: SCORES)', '#c8b890'],
    ['  F (HOLD) / B .. BUILD / BLUEPRINT', '#c8b890'],
    ['  R ............. EARTH / THATCH / ANT GATE', '#c8b890'],
    ['  X ............. MARK CHAMBER / APHID SHELTER', '#c8b890'],
    ['  O ............. OBJECTIVES / UPGRADES', '#c8b890'],
    ['M: MAP  G: GUIDE ARROW  H: SKIP HINT  ESC: PAUSE', '#a09070'],
    ['BRING FOOD TO STORAGE. MARK CHAMBERS TO GROW.', '#a8e8a0'],
    ['RAISE PRINCESSES IN AUTUMN: THE NEXT', '#a8e8a0'],
    ['SPRING THEY FLY. KEEP THE QUEEN ALIVE!', '#a8e8a0'],
    ['WINTER FREEZES: THATCH A MOUND, STOCK FOOD.', '#a8e8a0'],
    ['BONUS: SLAY THE RED QUEEN IN HER EASTERN NEST.', '#ff9080'],
  ];
}

// the help screen's pages for a mode ('solo', 'coop', 'versus', 'world'):
// online, first how the match works and how it's won, then what to do
// through the year; the controls last (solo: the controls first)
function helpPages(mode) {
  const no = LANG === 1;
  const H = '#ffe080', B = '#c8b890', WIN = '#a8e8a0', LOSE = '#ff9080';
  const page = (title, rows) => ({ title, lines: rows.map(r => typeof r === 'string' ? [r, B] : r) });
  const todo = page(no ? 'HVA GJØR JEG?' : 'WHAT DO I DO?', no ? [
    ['VÅR OG SOMMER', H],
    'BÆR MAT TIL LAGERET (E). GRAV UT KAMRE OG',
    'MERK DEM (X) SÅ KOLONIEN KAN VOKSE.',
    'TEGN BYGG MED B: LEDIGE ARBEIDERE BYGGER DEM.',
    'MÅLENE (O) OG PILEN (G) VISER VEIEN.',
    ['HØST', H],
    'ET ROMSLIG DRONNINGKAMMER OG FULLE LAGRE FÅR',
    'DRONNINGEN TIL Å LEGGE PRINSESSER.',
    ['VINTER', H],
    'INGEN MAT VOKSER OG KULDEN BITER: SAMLE MAT,',
    'BYGG STRÅTUE OVER INNGANGEN (F, R), STENG MED',
    'EN MAURPORT.',
    ['HELE TIDEN', H],
    'HOLD DRONNINGEN I LIVE. SOLDATER (Q) SAMLER',
    'FØLGE, AMMER (Q) LEGER. DØR DU, TAR DU EN NY',
    'MAUR. C BYTTER MAUR, HOLD TAB FOR POENGENE.',
  ] : [
    ['SPRING AND SUMMER', H],
    'BRING FOOD TO THE STORAGE (E). DIG OUT ROOMS',
    'AND MARK THEM AS CHAMBERS (X) TO GROW.',
    'PLAN WALLS WITH B: IDLE WORKERS BUILD THEM.',
    'THE MILESTONES (O) AND THE ARROW (G) GUIDE YOU.',
    ['AUTUMN', H],
    'A ROOMY ROYAL CHAMBER AND WELL-STOCKED STORES',
    'GET THE QUEEN LAYING PRINCESSES.',
    ['WINTER', H],
    'NO FOOD GROWS AND THE COLD BITES: STOCK FOOD,',
    'THATCH A MOUND OVER THE ENTRANCE (F, R), CLOSE',
    'IT WITH AN ANT GATE.',
    ['ALWAYS', H],
    'KEEP THE QUEEN ALIVE. SOLDIERS (Q) RALLY AN',
    'ESCORT, NURSES (Q) HEAL. IF YOU DIE, PICK',
    'ANOTHER ANT. C SWITCHES ANTS; HOLD TAB: SCORES.',
  ]);
  const controls = page(L('ui_howto'), helpText());
  if (mode === 'coop') return [page(no ? 'SAMARBEID' : 'THE CO-OP MATCH', no ? [
    'EN KOLONI SOM DERE SPILLER SAMMEN, I ETT ÅR:',
    '12 DAGER PÅ 4 MINUTTER, CIRKA 48 MINUTTER.',
    '',
    ['MÅLET', H],
    'BRUDEFLUKTEN FØRSTE VÅRDAG I ÅR 2. OM HØSTEN',
    'LEGGER DRONNINGEN PRINSESSER - AL DEM OPP.',
    '',
    ['ÅRET FÅR 1-3 STJERNER', H],
    ['- EN PRINSESSE FLYR UT', WIN],
    ['- 3 PRINSESSER, ELLER 8 AV DE 12 MÅLENE (O)', WIN],
    ['- DEN RØDE DRONNINGEN DREPT, ELLER FLERE', WIN],
    ['  MAUR ENN DEN RØDE KOLONIEN', WIN],
    '',
    ['TAPT: DRONNINGEN DØR UTEN EN PRINSESSE,', LOSE],
    ['ELLER ALLE MAURENE DØR.', LOSE],
  ] : [
    'ONE COLONY, PLAYED TOGETHER, FOR ONE YEAR:',
    '12 DAYS OF 4 MINUTES, ABOUT 48 MINUTES.',
    '',
    ['THE GOAL', H],
    'THE NUPTIAL FLIGHT ON THE FIRST DAY OF SPRING',
    'IN YEAR 2. IN AUTUMN THE QUEEN LAYS PRINCESSES',
    '- RAISE THEM.',
    ['THE YEAR GETS 1-3 STARS', H],
    ['- A PRINCESS FLIES', WIN],
    ['- 3 PRINCESSES, OR 8 OF THE 12 MILESTONES (O)', WIN],
    ['- THE RED QUEEN SLAIN, OR MORE ANTS THAN THE', WIN],
    ['  RED COLONY', WIN],
    '',
    ['LOST: THE QUEEN DIES WITH NO PRINCESS, OR', LOSE],
    ['EVERY ANT DIES.', LOSE],
  ]), todo, controls];
  if (mode === 'versus') return [page(no ? 'MOT HVERANDRE' : 'THE VERSUS MATCH', no ? [
    'SVART MOT RØD: HVER SIDE SPILLER SIN EGEN',
    'KOLONI. REDENE STARTER LIKE. ETT ÅR, CIRKA 48',
    'MINUTTER. INGEN DATAANGREP: Å ANGRIPE ER',
    'DERES JOBB.',
    '',
    ['SEIER MED EN GANG', H],
    ['DREP FIENDENS DRONNING MENS HUN IKKE HAR', WIN],
    ['NOEN PRINSESSE SOM KAN TA OVER.', WIN],
    '',
    ['ELLERS AVGJØR BRUDEFLUKTEN', H],
    'FØRSTE VÅRDAG I ÅR 2: FLEST STJERNER VINNER,',
    'SÅ FLEST PRINSESSER, SÅ FLEST MAUR. STJERNER:',
    'EN PRINSESSE FLØYET, 3 PRINSESSER ELLER 8 AV',
    '12 MÅL (O), FLERE MAUR ENN FIENDEN.',
    '',
    ['MISTER DERE DRONNINGEN UTEN ARVING, TAPER DERE.', LOSE],
  ] : [
    'BLACK AGAINST RED: EACH SIDE PLAYS ITS OWN',
    'COLONY. THE NESTS START EQUAL. ONE YEAR, ABOUT',
    '48 MINUTES. NO COMPUTER RAIDS: ATTACKING IS',
    'UP TO YOU.',
    '',
    ['WIN AT ONCE', H],
    ['KILL THE ENEMY QUEEN WHILE SHE HAS NO', WIN],
    ['PRINCESS TO TAKE OVER.', WIN],
    '',
    ['OTHERWISE THE NUPTIAL FLIGHT DECIDES', H],
    'ON THE FIRST DAY OF SPRING IN YEAR 2: MORE',
    'STARS WINS, THEN MORE PRINCESSES, THEN MORE',
    'ANTS. STARS: A PRINCESS FLOWN, 3 PRINCESSES OR',
    '8 OF 12 MILESTONES (O), MORE ANTS THAN THEM.',
    '',
    ['LOSE YOUR QUEEN WITH NO HEIR AND YOU LOSE.', LOSE],
  ]), todo, controls];
  if (mode === 'world') return [page(no ? 'EN VARIG VERDEN' : 'A PERSISTENT WORLD', no ? [
    'EN KOLONI SOM LEVER PÅ SERVEREN. KOM OG GÅ',
    'SOM DU VIL: DEN SOVER NÅR INGEN ER DER, OG',
    'DEN BLIR LAGRET.',
    '',
    ['ÅR ETTER ÅR', H],
    'HVER VÅR FRA ÅR 2 FLYR PRINSESSENE UT. ÅRET',
    'FÅR 1-3 STJERNER, SOM BLIR TIL ARV (STJERNER',
    'X 100 + PRINSESSER X 50), OG KOLONIEN GÅR',
    'VIDERE TIL ET STØRRE NESTE ÅR.',
    '',
    ['DRONNINGEN', H],
    'DØR HUN MED EN PRINSESSE, TAR PRINSESSEN OVER.',
    ['DØR HUN UTEN ARVING, BEGYNNER VERDENEN PÅ NYTT', LOSE],
    ['MED ET NYTT KART - ARVEN BEHOLDES.', LOSE],
    '',
    'O: MÅL, OPPGRADERINGER OG VERDENENS HISTORIE',
  ] : [
    'ONE COLONY THAT LIVES ON THE SERVER. COME AND',
    'GO AS YOU LIKE: IT SLEEPS WHILE NOBODY IS IN',
    'IT, AND IT IS SAVED.',
    '',
    ['YEAR AFTER YEAR', H],
    'EACH SPRING FROM YEAR 2 THE PRINCESSES FLY.',
    'THE YEAR GETS 1-3 STARS, BANKED AS LEGACY',
    '(STARS X 100 + PRINCESSES X 50), AND THE',
    'COLONY GOES ON INTO A BIGGER NEXT YEAR.',
    '',
    ['THE QUEEN', H],
    'IF SHE DIES WITH A PRINCESS, THE PRINCESS RULES.',
    ['IF SHE DIES WITH NO HEIR, THE WORLD STARTS', LOSE],
    ['OVER ON A NEW MAP - ITS LEGACY IS KEPT.', LOSE],
    '',
    'O: MILESTONES, UPGRADES AND THE WORLD HISTORY',
  ]), todo, controls];
  return [controls, todo];
}
