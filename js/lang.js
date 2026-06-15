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
  ui_slotKeys: ['ENTER: 1 PLAYER    T: 2 PLAYERS', 'ENTER: 1 SPILLER    T: 2 SPILLERE'],
  ui_slotKeys2: ['X: ERASE    ESC: BACK', 'X: SLETT    ESC: TILBAKE'],
  ui_pressSpace: ['PRESS SPACE', 'TRYKK MELLOMROM'],
  ui_pressEnter: ['PRESS ENTER', 'TRYKK ENTER'],
  ui_howto: ['HOW TO ANT', 'SLIK MAURER DU'],
  ui_escBack: ['ESC: BACK', 'ESC: TILBAKE'],
  ui_paused: ['PAUSED', 'PAUSE'],
  ui_resume: ['RESUME', 'FORTSETT'],
  ui_saveGame: ['SAVE GAME', 'LAGRE SPILL'],
  ui_split: ['SPLIT: {0}', 'DELING: {0}'],
  ui_horiz: ['HORIZONTAL', 'VANNRETT'],
  ui_vert: ['VERTICAL', 'LODDRETT'],
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
  m_raid: ['RIVAL ANTS ARE RAIDING THE COLONY!', 'RIVALISERENDE MAUR ANGRIPER KOLONIEN!'],

  // tasks
  t_gather: ['GATHER FOOD', 'SANK MAT'],
  t_feed: ['FEED THE LARVAE', 'MAT LARVENE'],
  t_hunt: ['DRIVE OFF {0}', 'JAG BORT {0}'],
  t_dig: ['EXPAND THE NEST', 'UTVID TUA'],
  t_crystal: ['FIND A CRYSTAL BELOW', 'FINN EN KRYSTALL I DYPET'],

  // underground riches
  m_crystalFound: ['YOU DUG OUT A CRYSTAL!', 'DU GRAVDE FREM EN KRYSTALL!'],
  m_crystal: ['THE CRYSTAL GLEAMS IN THE HOARD! +{0}', 'KRYSTALLEN GLITRER I SKATTEN! +{0}'],
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
};
function casteName(c) { return (CASTE_NAME[c] || [c, c])[LANG]; }

const BUG_NAME_DEF = {
  spider: ['THE SPIDER', 'EDDERKOPPEN'],
  centipede: ['THE CENTIPEDE', 'TUSENBEINET'],
  wasp: ['THE WASP', 'VEPSEN'],
  beetle: ['THE BEETLE', 'BILLEN'],
  redant: ['THE RED ANT', 'RØDMAUREN'],
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
    ['SPILLER 1', '#ffe080'],
    ['  W A S D ....... GÅ / KLATRE', '#c8b890'],
    ['  MELLOMROM ..... BIT / GRAV', '#c8b890'],
    ['  E ............. PLUKK OPP / BRUK', '#c8b890'],
    ['  Q ............. EVNE    TAB: BYTT MAUR', '#c8b890'],
    ['SPILLER 2', '#80d0ff'],
    ['  PILER ......... GÅ / KLATRE', '#c8b890'],
    ['  . , K L ....... BIT, BRUK, EVNE, BYTT', '#c8b890'],
    ['', ''],
    ['M: KART  ESC: PAUSE  HOLD OPP FOR Å KLATRE', '#a09070'],
    ['SOLDATER KALLER KOLONIEN TIL KAMP. PLEIERE', '#a8e8a0'],
    ['HELBREDER OG BÆRER YNGELEN I SIKKERHET.', '#a8e8a0'],
    ['BÆR MAT TIL LAGERKAMMERET.', '#a8e8a0'],
  ] : [
    ['PLAYER 1', '#ffe080'],
    ['  W A S D ....... MOVE / CLIMB', '#c8b890'],
    ['  SPACE ......... BITE / DIG', '#c8b890'],
    ['  E ............. PICK UP / USE', '#c8b890'],
    ['  Q ............. ABILITY    TAB: SWITCH ANT', '#c8b890'],
    ['PLAYER 2', '#80d0ff'],
    ['  ARROWS ........ MOVE / CLIMB', '#c8b890'],
    ['  . , K L ....... BITE, USE, ABILITY, SWITCH', '#c8b890'],
    ['', ''],
    ['M: MAP   ESC: PAUSE   HOLD UP AT WALLS TO CLIMB', '#a09070'],
    ['SOLDIERS RALLY THE COLONY TO WAR. NURSES', '#a8e8a0'],
    ['HEAL AND CARRY THE BROOD TO SAFETY.', '#a8e8a0'],
    ['BRING FOOD TO THE STORAGE CHAMBER.', '#a8e8a0'],
  ];
}
