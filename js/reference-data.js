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

/* Fixed MVP/MOTM point formula — not user-tunable in v1 (see README). */
const MVP_POINTS = {
  perRun: 1, perFour: 1, perSix: 2, fifty: 8, century: 16, notOut: 4,
  perWicket: 25, perMaiden: 8, perCatch: 8, perRunOut: 8
};

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
   -- see applyTheme(). "midnight" matches the
   original hardcoded :root defaults exactly, so existing installs see
   no visual change until someone picks a different theme. */
const THEME_PRESETS = [
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
