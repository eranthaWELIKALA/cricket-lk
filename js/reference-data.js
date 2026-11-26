/* Cricket.lk — reference data: wicket labels, MVP points, built-in presets, themes.
   Classic script, loaded in order by index.html; all files share one global scope (see CLAUDE.md "Code layout"). */
/* ============================================================
   1. REFERENCE DATA
   ============================================================ */
const WICKET_LABELS = {
  bowled: "bowled", caught: "caught", lbw: "lbw",
  stumped: "stumped", hitwicket: "hit wicket", runout: "run out"
};

/* Optional player-profile details (supabase/008_player_details.sql). */
const BOWLING_TYPES = { fast: "Fast", medium: "Medium", "off-spin": "Off spin", "leg-spin": "Leg spin", orthodox: "Orthodox spin" };

/* Built-in MVP points presets (calcPlayerPoints; see CLAUDE.md "Stats &
   MVP"). Seeded into a guest's state.pointsPresets on first run; a club with
   no points presets of its own uses the first one. Milestones
   (`battingMilestones`, runs) and wicket hauls (`wicketHauls`) are lists of
   { at, pts }, "highest reached only" (a hundred isn't also a fifty); a
   preset from before the lists has fixed 30/50/100 and 3/4/5-wicket values
   instead (pointsMilestones reads both). `hatTrick` is per hat-trick, and
   each wicket in a row after it adds half of it again. A rate band is
   { from, below, pts }: from <= value < below, either end open (null), the
   first band that fits wins. "Classic" is the formula this app used before
   points could be set; "Club" weighs runs more for short club games (a
   wicket is worth about 15 runs, as CricHeroes counts 10-20 over games),
   and boundaries more still, since most club games are 4-6 overs. */
const POINTS_ZERO = {
  perRun: 0, perFour: 0, perSix: 0, battingMilestones: [], notOut: 0, duck: 0,
  perWicket: 0, bowledLbw: 0, perMaiden: 0, perDot: 0, hatTrick: 0, wicketHauls: [],
  perCatch: 0, perStumping: 0, perRunOut: 0, economy: null, strikeRate: null
};
const DEFAULT_POINTS_PRESETS = [
  Object.assign({}, POINTS_ZERO, { id: "points-club", name: "Club",
    perRun: 1, perFour: 2, perSix: 4, notOut: 2,
    battingMilestones: [{ at: 20, pts: 2 }, { at: 30, pts: 4 }, { at: 50, pts: 8 }, { at: 100, pts: 16 }],
    perWicket: 15, perMaiden: 10, hatTrick: 20, perCatch: 10, perStumping: 10, perRunOut: 16,
    economy: { minOvers: 1, bands: [{ from: null, below: 5, pts: 6 }, { from: 5, below: 10, pts: 4 }, { from: 10, below: 15, pts: 2 }] } }),
  Object.assign({}, POINTS_ZERO, { id: "points-classic", name: "Classic",
    perRun: 1, perFour: 1, perSix: 2, notOut: 4,
    battingMilestones: [{ at: 50, pts: 8 }, { at: 100, pts: 16 }],
    perWicket: 25, perMaiden: 8, perCatch: 8, perStumping: 8, perRunOut: 8 }),
  // In the style of the fantasy-cricket apps' T20 scoring.
  Object.assign({}, POINTS_ZERO, { id: "points-fantasy", name: "Fantasy T20",
    perRun: 1, perFour: 1, perSix: 2, duck: -2,
    battingMilestones: [{ at: 30, pts: 4 }, { at: 50, pts: 8 }, { at: 100, pts: 16 }],
    perWicket: 25, bowledLbw: 8, perMaiden: 12,
    wicketHauls: [{ at: 3, pts: 4 }, { at: 4, pts: 8 }, { at: 5, pts: 16 }],
    perCatch: 8, perStumping: 12, perRunOut: 12,
    economy: { minOvers: 2, bands: [
      { from: null, below: 5, pts: 6 }, { from: 5, below: 6, pts: 4 }, { from: 6, below: 7, pts: 2 },
      { from: 10, below: 11, pts: -2 }, { from: 11, below: 12, pts: -4 }, { from: 12, below: null, pts: -6 }] },
    strikeRate: { minBalls: 10, bands: [
      { from: 170, below: null, pts: 6 }, { from: 150, below: 170, pts: 4 }, { from: 130, below: 150, pts: 2 },
      { from: 60, below: 70, pts: -2 }, { from: 50, below: 60, pts: -4 }, { from: null, below: 50, pts: -6 }] } }),
  // The IPL's Most Valuable Player points: boundaries, wickets, dot balls, catches.
  Object.assign({}, POINTS_ZERO, { id: "points-ipl", name: "IPL MVP",
    perFour: 2.5, perSix: 3.5, perWicket: 3.5, perDot: 1, perCatch: 2.5, perStumping: 2.5, perRunOut: 2.5 })
];
const DEFAULT_POINTS_PRESET_ID = "points-club";
// Most rows a milestone list or a rate bonus can have in the editor.
const POINTS_ROWS_MAX = 8;

const DEFAULT_MATCH_PRESETS = [
  { id: "preset-t20", name: "T20 (6-ball overs)", ballsPerOver: 6, oversLimit: 20, playersPerSide: 11,
    wide: { enabled: true, runs: 1 }, noBall: { enabled: true, runs: 1 }, freeHitOnNoBall: true,
    requireFielderOnCatch: false, requireFielderOnRunout: false },
  { id: "preset-t10", name: "T10 (6-ball overs)", ballsPerOver: 6, oversLimit: 10, playersPerSide: 11,
    wide: { enabled: true, runs: 1 }, noBall: { enabled: true, runs: 1 }, freeHitOnNoBall: true,
    requireFielderOnCatch: false, requireFielderOnRunout: false },
  { id: "preset-tape5", name: "Tape-ball (5-ball overs)", ballsPerOver: 5, oversLimit: 8, playersPerSide: 7,
    wide: { enabled: true, runs: 1 }, noBall: { enabled: true, runs: 1 }, freeHitOnNoBall: true,
    requireFielderOnCatch: false, requireFielderOnRunout: false }
];

const DEFAULT_TOURNAMENT_PRESETS = [
  { id: "tpreset-standard", name: "Standard league (2/1/0, NRR)", matchPresetId: "preset-t20",
    pointsForWin: 2, pointsForTie: 1, pointsForLoss: 0, useNRR: true }
];

/* Curated background themes for the Settings screen's theme gallery.
   Each bundles the full :root palette (bg/panel/text/status colors) plus
   a default accent pair; applyTheme() (UI section) sets `vars` directly
   and runs `accent`/`accent2` through the existing applyAccentVars()
   derivation (rgb/dim/light/ink), same as a custom branding color does.
   A pre-existing custom branding accent (legacy state.branding data —
   no longer editable in the UI) always wins over a theme's own accent
   -- see applyTheme(). The first one is the default (defaultState's
   themeId, and the fallback for an unknown id), and css/app.css's :root
   holds its colours, so the page paints in it before applyTheme() runs.
   A save from before it became the default keeps "midnight". */
const THEME_PRESETS = [
  // The national side's colours: royal-blue kit and lion gold.
  { id: "srilanka", name: "Sri Lanka", accent: "#FFC20E", accent2: "#4A9BFF", vars: {
    "--bg": "#030B22", "--bg-2": "#0A1B4A",
    "--panel": "rgba(255,255,255,.05)", "--panel-2": "rgba(255,255,255,.07)", "--panel-solid": "#10235C",
    "--line": "rgba(255,255,255,.10)", "--line-strong": "rgba(255,255,255,.20)",
    "--text": "#F2F5FF", "--muted": "#97A6D0",
    "--danger": "#FF5D70", "--wicket": "#FF4D63", "--info": "#6CCBFF"
  } },
  { id: "midnight", name: "Midnight", accent: "#FFC247", accent2: "#33E29B", vars: {
    "--bg": "#050B0A", "--bg-2": "#0A1613",
    "--panel": "rgba(255,255,255,.05)", "--panel-2": "rgba(255,255,255,.07)", "--panel-solid": "#101E1B",
    "--line": "rgba(255,255,255,.10)", "--line-strong": "rgba(255,255,255,.20)",
    "--text": "#F4F8F6", "--muted": "#8FA9A0",
    "--danger": "#FF5D70", "--wicket": "#FF4D63", "--info": "#5FC7FF"
  } },
  { id: "slate", name: "Slate", accent: "#5FA8FF", accent2: "#B98CFF", vars: {
    "--bg": "#05070C", "--bg-2": "#0B1220",
    "--panel": "rgba(255,255,255,.05)", "--panel-2": "rgba(255,255,255,.07)", "--panel-solid": "#121A2A",
    "--line": "rgba(255,255,255,.10)", "--line-strong": "rgba(255,255,255,.20)",
    "--text": "#EEF2FA", "--muted": "#8C9AB8",
    "--danger": "#FF5D70", "--wicket": "#FF4D63", "--info": "#5FC7FF"
  } },
  { id: "daylight", name: "Daylight", accent: "#D98A2B", accent2: "#1E9E6C", vars: {
    "--bg": "#FBF8F2", "--bg-2": "#F1ECE0",
    "--panel": "rgba(10,20,20,.035)", "--panel-2": "rgba(10,20,20,.06)", "--panel-solid": "#FFFFFF",
    "--line": "rgba(10,20,20,.10)", "--line-strong": "rgba(10,20,20,.18)",
    "--text": "#1B2420", "--muted": "#5C6B63",
    "--danger": "#D6304A", "--wicket": "#D6304A", "--info": "#1178C4"
  } },
  { id: "sunset", name: "Sunset", accent: "#FF8A5B", accent2: "#FF4FA0", vars: {
    "--bg": "#12070D", "--bg-2": "#1B0E17",
    "--panel": "rgba(255,255,255,.05)", "--panel-2": "rgba(255,255,255,.07)", "--panel-solid": "#26121D",
    "--line": "rgba(255,255,255,.10)", "--line-strong": "rgba(255,255,255,.20)",
    "--text": "#FBF1F5", "--muted": "#B98CA0",
    "--danger": "#FF5D70", "--wicket": "#FF4D63", "--info": "#5FC7FF"
  } }
];
