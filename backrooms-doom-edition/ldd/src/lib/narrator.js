// ============================================================================
//  Local narrator — self-contained, offline atmospheric text generator.
//  Hand-written, level-specific fragment pools that get combined at runtime so
//  the Backrooms keeps talking to you without any network / backend.
// ============================================================================

const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const pickSome = (arr, n) => {
  const a = [...arr];
  const out = [];
  for (let i = 0; i < n && a.length; i++) out.push(a.splice((Math.random() * a.length) | 0, 1)[0]);
  return out;
};

// ---------------------------------------------------------------------------
//  Per-level prose used on the ENTERING transition (2–3 sentences, combined).
// ---------------------------------------------------------------------------
const ENTER = [
  { // 0
    open: [
      "The wallpaper is the colour of old teeth and it goes on forever.",
      "Damp yellow wallpaper. Buzzing tubes overhead. The hum has no source and no end.",
      "You are in a room you have been in a thousand times before, and never once.",
    ],
    mid: [
      "The carpet is soft and slightly wet beneath your shoes.",
      "Somewhere a fluorescent tube ticks against its housing.",
      "Every doorway opens onto another identical room.",
    ],
    close: [
      "You are not alone in here. You never were.",
      "Keep moving. The rooms remember stillness.",
      "Do not try to map it. The map will try to map you.",
    ],
  },
  { // 1
    open: [
      "Concrete pillars rise into a blackness that has no ceiling.",
      "The carpet here is soaked through. Each step sounds like a held breath.",
      "The fluorescents end a few feet up. Above that, only dark and dripping.",
    ],
    mid: [
      "Water falls from nowhere and lands without a floor to catch it.",
      "The pillars are spaced too evenly to be an accident.",
      "Your footsteps echo back a half-second too late.",
    ],
    close: [
      "Something large is breathing between the columns.",
      "The dark above is not empty. It is patient.",
      "Follow the dead corridor. The light is a trap.",
    ],
  },
  { // 2
    open: [
      "Miles of pipe wind through the walls, hissing at a pressure that never settles.",
      "Everything here is warm and wet and smells of iron.",
      "The pipes carry something that is not water. You can hear it thinking.",
    ],
    mid: [
      "Steam vents in short, breathing bursts.",
      "There are footsteps inside the walls, keeping pace with yours.",
      "A valve turns somewhere, slowly, on its own.",
    ],
    close: [
      "Find the pipe that does not hum. It is the only way out.",
      "Do not touch the metal. It will know your shape.",
      "The pressure is rising. So is whatever shares it with you.",
    ],
  },
  { // 3
    open: [
      "Exposed wiring sparks in the dark, and the air tastes of burning hair.",
      "Transformers the size of cars groan behind chain-link.",
      "The junction boxes click open and shut, watching with no eyes.",
    ],
    mid: [
      "A breaker throws itself with a sound like a snapped spine.",
      "Ozone and scorched insulation hang in the still air.",
      "Every light surges, then dies, then surges again.",
    ],
    close: [
      "The exit hides behind a breaker that should not exist.",
      "Something is grounding itself through the floor you stand on.",
      "Do not let it learn that you conduct.",
    ],
  },
  { // 4
    open: [
      "Rows of identical cubicles stretch past the edge of the light.",
      "Phones ring on every desk and make no sound at all.",
      "The coffee in the cup is still warm. It has been for years.",
    ],
    mid: [
      "A printer wakes, feeds one blank page, and sleeps.",
      "Someone's chair is still spinning, slowly, three aisles over.",
      "The clocks all read a time that hasn't happened yet.",
    ],
    close: [
      "Someone taped an arrow to a monitor. Follow it. Trust nothing else.",
      "The work was never finished. Neither were the workers.",
      "Do not sit down. The desks are hungry for occupants.",
    ],
  },
  { // 5
    open: [
      "Endless corridors of Room 000, every door the same brass number.",
      "Every nightstand holds the same key, and none of them fit your door.",
      "The hallway carpet repeats its pattern until the pattern repeats you.",
    ],
    mid: [
      "A television murmurs behind a door that has no handle.",
      "Ice machines rattle on floors that have no ice and no floors below.",
      "Somewhere a guest is checking out, forever, at the far end of the hall.",
    ],
    close: [
      "Room 001 is not on this floor. Find it anyway.",
      "Do not knock. Something always answers, eventually.",
      "The hotel keeps its guests. Try not to become a fixture.",
    ],
  },
];

// ---------------------------------------------------------------------------
//  Short event lines (<= ~12 words). GameEngine upper-cases these.
// ---------------------------------------------------------------------------
const AMBIENT = [
  ["wet footsteps stop somewhere behind you", "a ceiling tile shifts its weight", "the hum drops a half-step lower",
   "the wallpaper pattern changes when you blink", "a door clicks shut in a room you already left",
   "the lights dim, then remember to be lights"],
  ["water drips up from the floor", "the dark above exhales", "a pillar was not there a moment ago",
   "your reflection lags in the wet carpet", "something heavy settles in the next aisle of columns"],
  ["a valve turns itself in the wall", "steam hisses your name almost", "the pipes knock back when you stop",
   "pressure builds behind your eyes", "footsteps in the walls quicken to match yours"],
  ["a breaker trips in the distance", "the smell of burning hair returns", "wires spit sparks at your shadow",
   "a transformer groans and goes quiet", "the lights surge bright enough to hurt"],
  ["a phone rings with no sound", "a chair is still spinning, three desks over", "the coffee maker gurgles to life",
   "a printer feeds one blank page", "fluorescent grids flicker in sequence toward you"],
  ["an ice machine rattles down the hall", "a tv murmurs behind a handleless door", "a key turns in a lock that isn't yours",
   "room numbers repeat where they shouldn't", "the corridor is longer on the way back"],
];

const ENTITY = [
  ["a silhouette ducks around the corner", "eyes in the vent — gone now", "something tall unfolds at the hallway's end",
   "a shape peels itself off the wallpaper", "it was standing there. it is closer now"],
  ["a long arm withdraws behind a pillar", "something pale watches from the dark above", "it stepped out of the water and is dry",
   "a face hangs between two columns", "it does not blink and it does not leave"],
  ["a wet shape squeezes between the pipes", "it climbs out of the steam toward you", "fingers curl around a valve up ahead",
   "it wears the sound of your footsteps", "something jointless drags itself closer"],
  ["a figure flickers in the dying light", "it crawls along the live wires", "sparks outline a thing that shouldn't stand",
   "it grounds itself an arm's length away", "the dark between the boxes has teeth now"],
  ["someone is standing in cubicle 4B", "a head rises slowly over the partitions", "it sits at a desk and turns to face you",
   "a coworker you never had waves once", "it is filing toward you, aisle by aisle"],
  ["a guest stands motionless in 000", "the do-not-disturb sign is breathing", "it waits at the ice machine, smiling",
   "a long shape fills the doorway of 000", "it has your room key and it is coming"],
];

const INTRUSIVE = [
  ["you don't remember how you got here", "the wallpaper has been here longer than you",
   "you have always been walking these rooms", "no one is looking for you", "the hum is inside your teeth now"],
  ["the dark above knows your name", "you stopped casting a shadow a while ago",
   "the water is rising and you don't mind", "you forgot what outside smelled like", "the pillars are counting you"],
  ["you can hear your own pressure rising", "the pipes have been breathing for you",
   "you forgot which footsteps are yours", "the iron taste is your own blood", "you are part of the plumbing now"],
  ["you can feel the current looking for you", "your hair is standing up for a reason",
   "the burning smell might be you", "you've been holding this breaker for hours", "the sparks spell something familiar"],
  ["you never actually had this job", "your desk is the one still warm",
   "the meeting was about you", "you've answered that phone a thousand times", "your name is on the absentee list"],
  ["you checked in a very long time ago", "your room was 000 all along",
   "the key in your hand has always been yours", "you stopped looking for 001 years back", "you are a permanent guest now"],
];

const DEATH = [
  [ "Your mind unspooled like a strip of old wallpaper, and the hum gently absorbed what was left of the sound you used to make.",
    "You sat down in a room the colour of teeth and simply stopped being a separate thing from it.",
    "The fluorescent buzz finally matched the frequency of your thoughts, and there was no longer any difference between you and the light." ],
  [ "You waded into the rising water until the dark above leaned down and took the last warm part of you.",
    "Between two identical pillars you forgot which one you were, and the dripping filled the space your name had left.",
    "The breathing in the columns slowed to your pulse, then past it, and the wet carpet closed over the shape of you." ],
  [ "The pressure equalized at last — through you — and you became one more sound the pipes make at night.",
    "You pressed your ear to the warm metal to listen, and the metal listened back until there was nothing of you to hear.",
    "The footsteps in the walls finally let you in, and now you keep pace with someone else's fear." ],
  [ "You grounded the current so the lights could stay on, and the lights have never once thanked you.",
    "The last breaker you held threw itself, and you went out with it in a smell of scorched hair.",
    "You conducted one final surge and scattered into the wiring, a flicker that techs will blame on old transformers." ],
  [ "You took the warm coffee, sat in the spinning chair, and finished the work that was never yours to finish.",
    "A phone rang that only you could hear, and when you answered, the cubicles quietly filed you away.",
    "Your name slid from the roster to the absentee list to the partition itself, and the office went on humming." ],
  [ "You finally opened a door, and Room 000 kept the part of you that walked through it.",
    "The key fit at last, and the hotel welcomed you the way it welcomes everything — permanently.",
    "You stopped searching for 001, lay down on a bed that was always made, and became another number in the hall." ],
];

// ---------------------------------------------------------------------------
//  Public API (async to preserve the original "scanning…" transition beat)
// ---------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function narrateLevel(levelIndex) {
  const L = ENTER[levelIndex % ENTER.length];
  await wait(450 + Math.random() * 650); // brief beat so the transition can "scan"
  return `${pick(L.open)} ${pick(L.mid)} ${pick(L.close)}`;
}

export async function narrateEvent(levelIndex, type) {
  const idx = levelIndex % AMBIENT.length;
  const table = type === 'entity' ? ENTITY : type === 'intrusive' ? INTRUSIVE : AMBIENT;
  await wait(80 + Math.random() * 160);
  return pick(table[idx]);
}

export async function narrateDeath(levelIndex) {
  await wait(500 + Math.random() * 500);
  return pick(DEATH[levelIndex % DEATH.length]);
}

// (exported for anyone who wants a varied multi-line readout)
export function deathLines(levelIndex) {
  return pickSome(DEATH[levelIndex % DEATH.length], 1);
}
