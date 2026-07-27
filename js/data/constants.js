// Game-wide constants
window.BBGM_CONSTANTS = {
  // Single source of truth for the app/save version. main.js stamps this
  // into new saves; index.html's ?v= cache-busters and the service-worker
  // cache name must be bumped in lockstep (they can't read JS constants).
  VERSION: '1.1.1',
  START_YEAR: 2026,
  TEAMS_PER_LEAGUE: 15,
  // Two leagues, three divisions each. Internal values are lowercase for
  // save stability; display names live in BBGM_LEAGUE_DISPLAY (teams.js).
  // Per-league division names live in BBGM_DIVISIONS_BY_LEAGUE.
  LEAGUES: ['east', 'west'],
  // Legacy union of all division names — kept for any code that wants to
  // iterate every division. Per-league correct order is in
  // BBGM_DIVISIONS_BY_LEAGUE.
  DIVISIONS_ALL: ['Northeast', 'Central', 'Southeast', 'Pacific', 'Midwest', 'South'],
  GAMES_PER_TEAM: 162,
  ROSTER_ACTIVE: 26,
  ROSTER_40: 40,
  MINOR_LEVELS: ['AAA', 'AA', 'A', 'Rookie'],

  // Roster composition targets
  ROSTER_PITCHERS: 13,
  ROSTER_CATCHERS: 2,
  ROSTER_INFIELDERS: 6,
  ROSTER_OUTFIELDERS: 5,

  // (The old TARGET_* league-calibration constants died with the
  // re-founding — the league line is an OUTPUT of the grade dictionary
  // now, watched by the observatory, never targeted. See bible §22.)

  // Owner archetypes (per 4.3)
  OWNER_ARCHETYPES: [
    { key: 'win_now', name: 'Win-Now Spender', payrollMul: 1.20 },
    { key: 'patient', name: 'Patient Builder', payrollMul: 0.97 },
    { key: 'cheap', name: 'Cheap Owner', payrollMul: 0.70 },
    { key: 'analytics', name: 'Analytics-Driven', payrollMul: 1.02 },
    { key: 'old_school', name: 'Old-School', payrollMul: 1.07 },
    { key: 'aggressive', name: 'Aggressive Trader', payrollMul: 1.02 },
  ],

  MARKET_SIZES: [
    { key: 'large', name: 'Large', base: 200, count: 8 },
    { key: 'mid', name: 'Mid', base: 140, count: 14 },
    { key: 'small', name: 'Small', base: 90, count: 8 },
  ],

  // Hitter archetypes (per 5.6). 'bust' (0.38.0): the prospect who
  // simply never develops — riseRate ~0 means the scouted ceiling never
  // arrives. Scouting NEVER reads the archetype, so a bust's potential
  // band looks as seductive as anyone's; the only tell is watching the
  // attribute history not move, season after season.
  HITTER_ARCHETYPES: [
    { key: 'traditional', weight: 0.21, peakAge: [27, 29], riseRate: 0.25, declineRate: 0.15, plateauWidth: 3, volatility: 0.10 },
    // The pro's bat (0.59.0): the hitter mirror of the pitcher
    // crafty_vet — a late peak, a wide plateau, and a slow fade. With
    // skill-specific aging he literally ages INTO his discipline
    // profile: the legs go, the walk rate doesn't, and he's still a
    // useful bat at 38.
    { key: 'crafty_vet', weight: 0.06, peakAge: [29, 31], riseRate: 0.20, declineRate: 0.08, plateauWidth: 4, volatility: 0.08 },
    // The overachiever (0.58.0): the inverse of the bust. Born with a
    // genuinely modest ceiling (the low-30s card the scouts show is
    // TRUE at signing), but the ceiling itself climbs year after year
    // until he's a solid regular. growth.drop = how far below his
    // destiny he starts; growth.doneAge = when the climb finishes.
    { key: 'overachiever', weight: 0.07, peakAge: [27, 29], riseRate: 0.30, declineRate: 0.12, plateauWidth: 3, volatility: 0.10, growth: { drop: [14, 20], doneAge: 26 } },
    { key: 'late_bloomer', weight: 0.10, peakAge: [30, 33], riseRate: 0.10, declineRate: 0.20, plateauWidth: 2, volatility: 0.15, breakoutAge: [26, 28] },
    { key: 'early_peak', weight: 0.12, peakAge: [23, 25], riseRate: 0.40, declineRate: 0.18, plateauWidth: 2, volatility: 0.15 },
    { key: 'one_year_wonder', weight: 0.05, peakAge: [24, 26], riseRate: 0.30, declineRate: 0.25, plateauWidth: 1, volatility: 0.30, reversionLikelihood: 0.85 },
    { key: 'steady_decliner', weight: 0.08, peakAge: [22, 24], riseRate: 0.45, declineRate: 0.10, plateauWidth: 4, volatility: 0.08 },
    { key: 'quad_a', weight: 0.08, peakAge: [25, 27], riseRate: 0.30, declineRate: 0.20, plateauWidth: 2, volatility: 0.15, ceilingCap: 50 },
    { key: 'slow_burn', weight: 0.10, peakAge: [30, 32], riseRate: 0.15, declineRate: 0.10, plateauWidth: 3, volatility: 0.08 },
    { key: 'volatile', weight: 0.05, peakAge: [27, 29], riseRate: 0.25, declineRate: 0.15, plateauWidth: 2, volatility: 0.40 },
    { key: 'bust', weight: 0.08, peakAge: [24, 26], riseRate: 0.02, declineRate: 0.18, plateauWidth: 2, volatility: 0.12 },
  ],

  PITCHER_ARCHETYPES: [
    { key: 'traditional', weight: 0.20, peakAge: [27, 30], riseRate: 0.25, declineRate: 0.18, plateauWidth: 3, volatility: 0.12 },
    { key: 'overachiever', weight: 0.07, peakAge: [27, 30], riseRate: 0.30, declineRate: 0.14, plateauWidth: 3, volatility: 0.12, growth: { drop: [14, 20], doneAge: 26 } },
    { key: 'workhorse', weight: 0.10, peakAge: [28, 31], riseRate: 0.18, declineRate: 0.10, plateauWidth: 5, volatility: 0.08 },
    { key: 'late_reinvent', weight: 0.10, peakAge: [32, 35], riseRate: 0.15, declineRate: 0.12, plateauWidth: 3, volatility: 0.15 },
    { key: 'flameout', weight: 0.10, peakAge: [25, 27], riseRate: 0.40, declineRate: 0.30, plateauWidth: 1, volatility: 0.20 },
    { key: 'crafty_vet', weight: 0.10, peakAge: [29, 31], riseRate: 0.20, declineRate: 0.10, plateauWidth: 4, volatility: 0.10 },
    { key: 'reliever_conv', weight: 0.10, peakAge: [27, 30], riseRate: 0.25, declineRate: 0.20, plateauWidth: 2, volatility: 0.18 },
    { key: 'quad_a', weight: 0.08, peakAge: [25, 27], riseRate: 0.30, declineRate: 0.25, plateauWidth: 2, volatility: 0.18, ceilingCap: 50 },
    { key: 'volatile', weight: 0.07, peakAge: [27, 30], riseRate: 0.25, declineRate: 0.18, plateauWidth: 2, volatility: 0.40 },
    { key: 'bust', weight: 0.08, peakAge: [24, 26], riseRate: 0.02, declineRate: 0.18, plateauWidth: 2, volatility: 0.12 },
  ],

  POSITIONS: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP', 'CP'],
  POSITION_PLAYERS: ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'],
  PITCHER_ROLES: ['SP', 'RP', 'CP'],

  POSITION_FAMILY: {
    C: 'catcher',
    '1B': 'infield', '2B': 'infield', '3B': 'infield', 'SS': 'infield',
    LF: 'outfield', CF: 'outfield', RF: 'outfield',
    DH: 'dh',
    SP: 'pitcher', RP: 'pitcher', CP: 'pitcher',
  },

  MONTHS: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],

  // Color palette for generated team colors
  COLOR_PALETTE: [
    { primary: '#1d3557', secondary: '#e63946' },
    { primary: '#2a9d8f', secondary: '#264653' },
    { primary: '#003049', secondary: '#d62828' },
    { primary: '#4a4e69', secondary: '#9a8c98' },
    { primary: '#0f4c81', secondary: '#f4a261' },
    { primary: '#1b4332', secondary: '#95d5b2' },
    { primary: '#d6336c', secondary: '#212529' },
    { primary: '#5a189a', secondary: '#ffd60a' },
    { primary: '#bb3e03', secondary: '#001219' },
    { primary: '#005f73', secondary: '#ee9b00' },
    { primary: '#6a4c93', secondary: '#f8961e' },
    { primary: '#0353a4', secondary: '#ffba08' },
    { primary: '#7a0c2e', secondary: '#f6d6ad' },
    { primary: '#386641', secondary: '#a7c957' },
    { primary: '#b5179e', secondary: '#480ca8' },
    { primary: '#d00000', secondary: '#ffba08' },
    { primary: '#003566', secondary: '#ffc300' },
    { primary: '#3a0ca3', secondary: '#4cc9f0' },
    { primary: '#7f5539', secondary: '#ddb892' },
    { primary: '#1a936f', secondary: '#114b5f' },
    { primary: '#370617', secondary: '#9d0208' },
    { primary: '#22577a', secondary: '#80ed99' },
    { primary: '#582f0e', secondary: '#a68a64' },
    { primary: '#212529', secondary: '#fca311' },
    { primary: '#240046', secondary: '#ff006e' },
    { primary: '#2f3e46', secondary: '#cad2c5' },
    { primary: '#03071e', secondary: '#dc2f02' },
    { primary: '#264653', secondary: '#e9c46a' },
    { primary: '#0a9396', secondary: '#94d2bd' },
    { primary: '#451f55', secondary: '#f15bb5' },
  ],
};
