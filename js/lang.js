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
  w_cramped: ['CRAMPED!', 'TRANGT!'],

  // menus & screens
  ui_start: ['START GAME', 'START SPILL'],
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
  ui_takeOver: ['ENTER: TAKE OVER', 'ENTER: TA OVER'],
  ui_gameover1: ['THE COLONY', 'KOLONIEN'],
  ui_gameover2: ['HAS PERISHED', 'HAR GÅTT UNDER'],
  ui_survived: ['SURVIVED {0} DAYS', 'OVERLEVDE {0} DAGER'],
  ui_finalScore: ['FINAL SCORE: {0}', 'SLUTTPOENG: {0}'],
  ui_foodGathered: ['FOOD GATHERED: {0}', 'MAT SANKET: {0}'],
  ui_tasksDone: ['TASKS DONE: {0}', 'OPPDRAG UTFØRT: {0}'],
  ui_antsBorn: ['ANTS BORN: {0}', 'MAUR FØDT: {0}'],
  ui_antsLost: ['ANTS LOST: {0}', 'MAUR MISTET: {0}'],
  ui_predSlain: ['PREDATORS SLAIN: {0}', 'ROVDYR FELT: {0}'],

  // in-game messages
  m_welcome: ['WELCOME BACK TO THE COLONY', 'VELKOMMEN TILBAKE TIL KOLONIEN'],
  m_gather: ['GATHER FOOD FOR THE COLONY', 'SANK MAT TIL KOLONIEN'],
  m_saved: ['GAME SAVED', 'SPILL LAGRET'],
  m_sound: ['SOUND {0}', 'LYD {0}'],
  m_pDied: ['PLAYER {0} DIED!', 'SPILLER {0} DØDE!'],
  m_youDied: ['YOU DIED!', 'DU DØDE!'],
  m_queenDead: ['THE QUEEN IS DEAD!', 'DRONNINGEN ER DØD!'],
  m_antDied: ['AN ANT HAS DIED', 'EN MAUR HAR DØDD'],
  m_larvaDied: ['A LARVA HAS PERISHED', 'EN LARVE HAR OMKOMMET'],
  m_slain: ['{0} IS SLAIN!', '{0} ER FELT!'],
  m_fed: ['FED THE LARVA', 'MATET LARVEN'],
  m_milked: ['MILKED THE APHID! +HONEYDEW', 'MELKET BLADLUSA! +HONNINGDUGG'],
  m_noEnemy: ['NO ENEMY IN SIGHT', 'INGEN FIENDE I SIKTE'],
  m_rally: ['RALLY! {0} ANTS ANSWER THE CALL', 'TIL KAMP! {0} MAUR SVARER PÅ ROPET'],
  m_rallyAlone: ['RALLY! BUT NO ONE IS NEAR', 'TIL KAMP! MEN INGEN ER I NÆRHETEN'],
  m_noFood: ['NOT ENOUGH FOOD TO HEAL', 'IKKE NOK MAT TIL Å HELBREDE'],
  m_healed: ['SOOTHING TOUCH: {0} HEALED', 'LINDRENDE PLEIE: {0} HELBREDET'],
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
  m_queenFound: ['YOU HAVE FOUND THE RED QUEEN!', 'DU HAR FUNNET DEN RØDE DRONNINGEN!'],
  m_rivalSlain: ['THE RED QUEEN IS SLAIN! +{0} +{1}\x13', 'DEN RØDE DRONNINGEN ER DREPT! +{0} +{1}\x13'],
  m_rivalDied: ['THE RED QUEEN HAS DIED', 'DEN RØDE DRONNINGEN ER DØD'],
  m_siteFell: ['A FRUIT HAS FALLEN BETWEEN THE NESTS!', 'EN FRUKT HAR FALT MELLOM TUENE!'],
  ui_siteLabel: ['CONTESTED FRUIT', 'STRIDSFRUKT'],

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
  m_noThatch: ['NO THATCH - BITE LEAVES FIRST', 'INGEN STRÅ - BIT AV BLADER FØRST'],

  // chambers
  ch_storage: ['STORAGE', 'LAGER'],
  ch_nursery: ['NURSERY', 'YNGELKAMMER'],
  ch_barracks: ['BARRACKS', 'SOLDATKAMMER'],
  ch_royal: ['ROYAL CHAMBER', 'DRONNINGKAMMER'],
  m_chamberNew: ['NEW CHAMBER: {0}', 'NYTT KAMMER: {0}'],
  m_chamberType: ['MARKED AS {0}', 'MERKET SOM {0}'],
  m_chamberGone: ['CHAMBER MARKER REMOVED', 'KAMMERMERKET ER FJERNET'],
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
  ui_lastDay: ['LAST DAY', 'SISTE DAG'],
  ui_atEnd: ['JUDGED AS THE SEASON ENDS', 'AVGJØRES NÅR ÅRSTIDEN ER OVER'],
  ui_mound: ['MOUND: {0} THATCH', 'TUE: {0} STRÅ'],
  ui_sealed: ['ENTRANCE SEALED', 'INNGANGEN STENGT'],
  ui_open: ['ENTRANCE OPEN', 'INNGANGEN ÅPEN'],
  ui_crystals: ['CRYSTALS: {0}', 'KRYSTALLER: {0}'],
  ui_yearGoal: ['RAISE PRINCESSES FOR SPRING OF YEAR {0}', 'AL OPP PRINSESSER TIL VÅREN I ÅR {0}'],
  ui_rival: ['RED COLONY: ABOUT {0} ANTS', 'RØD KOLONI: CIRKA {0} MAUR'],
  ui_rivalSlain: ['RED QUEEN SLAIN', 'RØD DRONNING DREPT'],
  ui_rivalDied: ['RED QUEEN DEAD', 'RØD DRONNING DØD'],
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
  ui_rivalWon: ['RIVAL: BIGGER THAN THE RED COLONY', 'RIVAL: STØRRE ENN DEN RØDE KOLONIEN'],
  ui_rivalLost: ['RIVAL: THE RED COLONY IS BIGGER', 'RIVAL: DEN RØDE KOLONIEN ER STØRRE'],
  ui_rivalDead: ['RIVAL: THE RED QUEEN IS DEAD', 'RIVAL: DEN RØDE DRONNINGEN ER DØD'],
  ui_continue: ['CONTINUE THE COLONY', 'FORTSETT KOLONIEN'],
  ui_toTitle: ['RETURN TO TITLE', 'TILBAKE TIL TITTEL'],
};

function L(key) {
  const e = STR[key];
  let s = e ? e[LANG] : key;
  for (let i = 1; i < arguments.length; i++) s = s.replace('{' + (i - 1) + '}', arguments[i]);
  return s;
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
    if (a.caste) return casteName(a.caste);
    if (a.bug) return bugNameDef(a.bug);
    if (a.brood) return broodNameDef(a.brood);
    if (a.key) return L(a.key, ...(a.args || []));
  }
  return a;
}
function msgText(m) { return L(m.key, ...(m.args || []).map(msgArg)); }

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
    '',
    'GRAV. SANK. MAT YNGELEN.',
    'FORSVAR TUA.',
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
    '',
    'DIG. FORAGE. FEED THE BROOD.',
    'DEFEND THE NEST.',
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
    ['  Q ............. EVNE', '#c8b890'],
    ['  TAB ........... BYTT MAUR', '#c8b890'],
    ['  F (HOLD INNE) . BYGG', '#c8b890'],
    ['  R ............. JORD / STRÅ / MAURPORT', '#c8b890'],
    ['  X ............. MERK KAMMER / BLADLUSLY', '#c8b890'],
    ['  O ............. MÅL / OPPGRADERINGER', '#c8b890'],
    ['M: KART  ESC: PAUSE  HOLD OPP FOR Å KLATRE', '#a09070'],
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
    ['  Q ............. ABILITY', '#c8b890'],
    ['  TAB ........... SWITCH ANT', '#c8b890'],
    ['  F (HOLD) ...... BUILD', '#c8b890'],
    ['  R ............. EARTH / THATCH / ANT GATE', '#c8b890'],
    ['  X ............. MARK CHAMBER / APHID SHELTER', '#c8b890'],
    ['  O ............. OBJECTIVES / UPGRADES', '#c8b890'],
    ['M: MAP   ESC: PAUSE   HOLD UP AT WALLS TO CLIMB', '#a09070'],
    ['BRING FOOD TO STORAGE. MARK CHAMBERS TO GROW.', '#a8e8a0'],
    ['RAISE PRINCESSES IN AUTUMN: THE NEXT', '#a8e8a0'],
    ['SPRING THEY FLY. KEEP THE QUEEN ALIVE!', '#a8e8a0'],
    ['WINTER FREEZES: THATCH A MOUND, STOCK FOOD.', '#a8e8a0'],
    ['BONUS: SLAY THE RED QUEEN IN HER EASTERN NEST.', '#ff9080'],
  ];
}
