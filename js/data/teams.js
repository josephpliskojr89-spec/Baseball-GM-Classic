// Fixed default teams for the North American Baseball League (NABL).
//
// Identity fields (id, city, nickname, abbr, league, division, colors) are
// stable across saves and stable across versions — IDs especially must
// never change, because future editor support keys persistent overrides off
// id. Other team properties (owner archetype, ballpark, founded year,
// payroll) are still generated per save inside league.js so each save has
// some variety.
//
// Market size is hardcoded here (not user-spec, but downstream code needs
// it for payroll math per bible 4.2/4.4 and it shouldn't randomize between
// saves). Quotas: 8 large, 14 mid, 8 small.
window.BBGM_TEAMS = [
  // ----- Eastern League — Northeast Division -----
  { id: 'nye', city: 'New York',     nickname: 'Empire',    abbr: 'NYE', league: 'east', division: 'Northeast', primaryColor: '#0B3D91', secondaryColor: '#C8102E', market: 'large' },
  { id: 'bos', city: 'Boston',       nickname: 'Rebels',    abbr: 'BOS', league: 'east', division: 'Northeast', primaryColor: '#BD3039', secondaryColor: '#0C2340', market: 'large' },
  { id: 'phi', city: 'Philadelphia', nickname: 'Liberty',   abbr: 'PHI', league: 'east', division: 'Northeast', primaryColor: '#002D72', secondaryColor: '#E81828', market: 'large' },
  { id: 'tor', city: 'Toronto',      nickname: 'Monarchs',  abbr: 'TOR', league: 'east', division: 'Northeast', primaryColor: '#1D2D5C', secondaryColor: '#C9A227', market: 'large' },
  { id: 'was', city: 'Washington',   nickname: 'Sentinels', abbr: 'WAS', league: 'east', division: 'Northeast', primaryColor: '#1B263B', secondaryColor: '#B22234', market: 'mid'   },

  // ----- Eastern League — Central Division -----
  { id: 'cle', city: 'Cleveland',    nickname: 'Iron',      abbr: 'CLE', league: 'east', division: 'Central',   primaryColor: '#3A3A3A', secondaryColor: '#9A1E2D', market: 'small' },
  { id: 'cin', city: 'Cincinnati',   nickname: 'Rivermen',  abbr: 'CIN', league: 'east', division: 'Central',   primaryColor: '#C6011F', secondaryColor: '#000000', market: 'small' },
  { id: 'chi', city: 'Chicago',      nickname: 'Syndicate', abbr: 'CHI', league: 'east', division: 'Central',   primaryColor: '#111111', secondaryColor: '#A71930', market: 'large' },
  { id: 'pit', city: 'Pittsburgh',   nickname: 'Forge',     abbr: 'PIT', league: 'east', division: 'Central',   primaryColor: '#FFB81C', secondaryColor: '#2C2C2C', market: 'small' },
  { id: 'det', city: 'Detroit',      nickname: 'Muscle',    abbr: 'DET', league: 'east', division: 'Central',   primaryColor: '#13294B', secondaryColor: '#E03A3E', market: 'mid'   },

  // ----- Eastern League — Southeast Division -----
  { id: 'mia', city: 'Miami',        nickname: 'Sharks',    abbr: 'MIA', league: 'east', division: 'Southeast', primaryColor: '#00B5E2', secondaryColor: '#FF3EA5', market: 'mid'   },
  { id: 'atl', city: 'Atlanta',      nickname: 'Hammers',   abbr: 'ATL', league: 'east', division: 'Southeast', primaryColor: '#13274F', secondaryColor: '#C8102E', market: 'mid'   },
  { id: 'cha', city: 'Charlotte',    nickname: 'Crown',     abbr: 'CHA', league: 'east', division: 'Southeast', primaryColor: '#007A33', secondaryColor: '#C4A000', market: 'mid'   },
  { id: 'nsh', city: 'Nashville',    nickname: 'Smoke',     abbr: 'NSH', league: 'east', division: 'Southeast', primaryColor: '#041E42', secondaryColor: '#FFB81C', market: 'mid'   },
  { id: 'tbr', city: 'Tampa Bay',    nickname: 'Breakers',  abbr: 'TBR', league: 'east', division: 'Southeast', primaryColor: '#002868', secondaryColor: '#A7A9AC', market: 'small' },

  // ----- Western League — Pacific Division -----
  { id: 'lag', city: 'Los Angeles',  nickname: 'Gladiators',abbr: 'LAG', league: 'west', division: 'Pacific',   primaryColor: '#6A0F1F', secondaryColor: '#C9A227', market: 'large' },
  { id: 'sfg', city: 'San Francisco',nickname: 'Gold',      abbr: 'SFG', league: 'west', division: 'Pacific',   primaryColor: '#F5B300', secondaryColor: '#1C1C1C', market: 'mid'   },
  { id: 'sea', city: 'Seattle',      nickname: 'Grunge',    abbr: 'SEA', league: 'west', division: 'Pacific',   primaryColor: '#2E2E2E', secondaryColor: '#6B8E23', market: 'mid'   },
  { id: 'sdg', city: 'San Diego',    nickname: 'Surf',      abbr: 'SDG', league: 'west', division: 'Pacific',   primaryColor: '#00AEEF', secondaryColor: '#FFD700', market: 'mid'   },
  { id: 'van', city: 'Vancouver',    nickname: 'Peaks',     abbr: 'VAN', league: 'west', division: 'Pacific',   primaryColor: '#0B3D2E', secondaryColor: '#A7A9AC', market: 'small' },

  // ----- Western League — Midwest Division -----
  { id: 'stl', city: 'St. Louis',    nickname: 'Archers',   abbr: 'STL', league: 'west', division: 'Midwest',   primaryColor: '#C41E3A', secondaryColor: '#0A2240', market: 'mid'   },
  { id: 'mil', city: 'Milwaukee',    nickname: 'Brewmasters',abbr: 'MIL', league: 'west', division: 'Midwest',   primaryColor: '#12284B', secondaryColor: '#F2A900', market: 'mid'   },
  { id: 'lou', city: 'Louisville',   nickname: 'Legion',    abbr: 'LOU', league: 'west', division: 'Midwest',   primaryColor: '#2C2C2C', secondaryColor: '#B4975A', market: 'small' },
  { id: 'kcr', city: 'Kansas City',  nickname: 'Kings',     abbr: 'KCR', league: 'west', division: 'Midwest',   primaryColor: '#004687', secondaryColor: '#C9A227', market: 'mid'   },
  { id: 'den', city: 'Denver',       nickname: 'Yetis',     abbr: 'DEN', league: 'west', division: 'Midwest',   primaryColor: '#5DADE2', secondaryColor: '#FFFFFF', market: 'mid'   },

  // ----- Western League — South Division -----
  { id: 'dal', city: 'Dallas',       nickname: 'Outlaws',   abbr: 'DAL', league: 'west', division: 'South',     primaryColor: '#1C1C1C', secondaryColor: '#8C6B2F', market: 'large' },
  { id: 'hou', city: 'Houston',      nickname: 'Orbit',     abbr: 'HOU', league: 'west', division: 'South',     primaryColor: '#002D62', secondaryColor: '#FF6A13', market: 'large' },
  { id: 'phx', city: 'Phoenix',      nickname: 'Fire',      abbr: 'PHX', league: 'west', division: 'South',     primaryColor: '#E25822', secondaryColor: '#1C1C1C', market: 'mid'   },
  { id: 'nor', city: 'New Orleans',  nickname: 'Royale',    abbr: 'NOR', league: 'west', division: 'South',     primaryColor: '#4B0082', secondaryColor: '#D4AF37', market: 'small' },
  { id: 'okc', city: 'Oklahoma City',nickname: 'Storm',     abbr: 'OKC', league: 'west', division: 'South',     primaryColor: '#003DA5', secondaryColor: '#A5ACAF', market: 'small' },
];

// Per-league division ordering. Used by schedule generation, standings, and
// any UI that wants to render divisions in their canonical order.
window.BBGM_DIVISIONS_BY_LEAGUE = {
  east: ['Northeast', 'Central', 'Southeast'],
  west: ['Pacific', 'Midwest', 'South'],
};

// League display names. Internal values stay lowercase for stability across
// saves; UI calls these helpers when rendering.
window.BBGM_LEAGUE_DISPLAY = {
  east: 'Eastern',
  west: 'Western',
};
