// Named Backrooms levels configuration

export const LEVELS = [
  {
    id: 0,
    name: "Level 0",
    subtitle: "The Lobby",
    mazeSize: 21,
    dreadRate: 0.015,
    eventFrequency: 8000,
    entitySpawnChance: 0.3,
    description: "Damp yellow wallpaper. Buzzing fluorescent tubes. The hum never stops. You are not alone.",
    exitHint: "A darker patch in the wallpaper. A door that was never there before.",
  },
  {
    id: 1,
    name: "Level 1",
    subtitle: "Habitable Zone",
    mazeSize: 25,
    dreadRate: 0.02,
    eventFrequency: 6000,
    entitySpawnChance: 0.45,
    description: "Concrete pillars stretch into blackness above. The carpet is wet. Something drips, but there is no ceiling.",
    exitHint: "The lights have gone out in one corridor. Follow the dark.",
  },
  {
    id: 2,
    name: "Level 2",
    subtitle: "Pipe Dreams",
    mazeSize: 29,
    dreadRate: 0.025,
    eventFrequency: 5000,
    entitySpawnChance: 0.55,
    description: "Miles of interconnected pipes. The pressure never equalizes. You hear footsteps in the walls.",
    exitHint: "Find the pipe that doesn't hum.",
  },
  {
    id: 3,
    name: "Level 3",
    subtitle: "Electrical Station",
    mazeSize: 31,
    dreadRate: 0.03,
    eventFrequency: 4000,
    entitySpawnChance: 0.65,
    description: "Exposed wiring sparks intermittently. The smell of burning hair. Something watches from the junction boxes.",
    exitHint: "The exit is behind the breaker that shouldn't exist.",
  },
  {
    id: 4,
    name: "Level 4",
    subtitle: "Abandoned Office",
    mazeSize: 33,
    dreadRate: 0.035,
    eventFrequency: 3500,
    entitySpawnChance: 0.7,
    description: "Rows of identical cubicles. Phones that ring with no sound. The coffee is still warm.",
    exitHint: "Someone has taped an arrow to a monitor. Follow it.",
  },
  {
    id: 5,
    name: "Level 5",
    subtitle: "The Terror Hotel",
    mazeSize: 35,
    dreadRate: 0.04,
    eventFrequency: 3000,
    entitySpawnChance: 0.8,
    description: "Endless corridors of Room 000. Every room has the same key on the nightstand. None of them open your door.",
    exitHint: "Room 001 does not exist on this floor. Find it anyway.",
  },
];

export const getLevel = (index) => LEVELS[index % LEVELS.length];

export const TOTAL_LEVELS = LEVELS.length;