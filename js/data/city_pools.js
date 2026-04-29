// City pool with market sizes and league assignments.
// Each city has a market size and provides candidate nicknames.
window.BBGM_CITIES = [
  // Large markets (8)
  { city: 'Brooklyn', market: 'large', region: 'NY', nicknames: ['Crowns', 'Bridge', 'Aces'] },
  { city: 'Manhattan', market: 'large', region: 'NY', nicknames: ['Empire', 'Liberty', 'Skyline'] },
  { city: 'Bay Area', market: 'large', region: 'CA', nicknames: ['Fog', 'Tides', 'Gold'] },
  { city: 'Los Angeles', market: 'large', region: 'CA', nicknames: ['Stars', 'Phantoms', 'Wave'] },
  { city: 'Chicago', market: 'large', region: 'IL', nicknames: ['Sentinels', 'Ironworks', 'Stockyards'] },
  { city: 'Houston', market: 'large', region: 'TX', nicknames: ['Astros', 'Rockets', 'Drillers'] },
  { city: 'Toronto', market: 'large', region: 'ON', nicknames: ['Maples', 'Eagles', 'Blue Crests'] },
  { city: 'Philadelphia', market: 'large', region: 'PA', nicknames: ['Liberty', 'Forge', 'Bells'] },

  // Mid markets (14)
  { city: 'Boston', market: 'mid', region: 'MA', nicknames: ['Beacons', 'Harbor', 'Riveters'] },
  { city: 'Seattle', market: 'mid', region: 'WA', nicknames: ['Kraken', 'Mariners', 'Pioneers'] },
  { city: 'Denver', market: 'mid', region: 'CO', nicknames: ['Peaks', 'Highlanders', 'Rapids'] },
  { city: 'Atlanta', market: 'mid', region: 'GA', nicknames: ['Pioneers', 'Crusaders', 'Spirits'] },
  { city: 'Detroit', market: 'mid', region: 'MI', nicknames: ['Pistons', 'Workers', 'Foundry'] },
  { city: 'Minneapolis', market: 'mid', region: 'MN', nicknames: ['Loons', 'Lakers', 'Northern'] },
  { city: 'Phoenix', market: 'mid', region: 'AZ', nicknames: ['Sunfire', 'Rattlers', 'Cactus'] },
  { city: 'Portland', market: 'mid', region: 'OR', nicknames: ['Lumberjacks', 'Roses', 'Rain'] },
  { city: 'St. Louis', market: 'mid', region: 'MO', nicknames: ['Arches', 'Riverboats', 'Patriots'] },
  { city: 'Tampa', market: 'mid', region: 'FL', nicknames: ['Storm', 'Reefs', 'Gulls'] },
  { city: 'Charlotte', market: 'mid', region: 'NC', nicknames: ['Hornets', 'Knights', 'Vipers'] },
  { city: 'Miami', market: 'mid', region: 'FL', nicknames: ['Tropics', 'Heatwave', 'Manatees'] },
  { city: 'Cleveland', market: 'mid', region: 'OH', nicknames: ['Anchors', 'Smokestacks', 'Mariners'] },
  { city: 'Pittsburgh', market: 'mid', region: 'PA', nicknames: ['Steel', 'Bridges', 'Furnace'] },

  // Small markets (8)
  { city: 'Buffalo', market: 'small', region: 'NY', nicknames: ['Bisons', 'Steelheads', 'Frost'] },
  { city: 'Memphis', market: 'small', region: 'TN', nicknames: ['Riverkings', 'Soul', 'Magnolias'] },
  { city: 'Cincinnati', market: 'small', region: 'OH', nicknames: ['Riverdogs', 'Rivals', 'Sentinels'] },
  { city: 'Sacramento', market: 'small', region: 'CA', nicknames: ['Quail', 'Goldminers', 'Capitals'] },
  { city: 'Salt Lake', market: 'small', region: 'UT', nicknames: ['Saltbacks', 'Range', 'Falcons'] },
  { city: 'Indianapolis', market: 'small', region: 'IN', nicknames: ['Racers', 'Lancers', 'Speedway'] },
  { city: 'Kansas City', market: 'small', region: 'MO', nicknames: ['Stars', 'Stockmen', 'Harvesters'] },
  { city: 'Hartford', market: 'small', region: 'CT', nicknames: ['Whalers', 'Insurers', 'Capitals'] },
];

// General nickname pool for variety / fallback.
window.BBGM_NICKNAMES = [
  'Aces','Alligators','Anchors','Archers','Arrows','Avengers','Badgers','Bandits','Barons','Bears','Beavers','Bees','Bisons','Blacksmiths','Blasters','Blazers','Boars','Bobcats','Boilers','Bombers','Bridges','Broncos','Bucks','Bulldogs','Bulls','Cadets','Captains','Cardinals','Cavaliers','Centurions','Chargers','Chiefs','Chimes','Chinooks','Cobras','Comets','Commanders','Condors','Cougars','Cowboys','Coyotes','Crusaders','Cubs','Defenders','Dragons','Drillers','Dukes','Dynamos','Eagles','Empires','Express','Falcons','Federals','Fighters','Firebirds','Flames','Foresters','Foundry','Foxes','Frost','Furies','Generals','Giants','Goblins','Goldfish','Grizzlies','Guardians','Gulls','Hammers','Harvesters','Hawks','Heralds','Heroes','Hornets','Howlers','Hurricanes','Imperials','Invaders','Jackals','Jaguars','Jets','Jokers','Kings','Knights','Kodiaks','Lancers','Legions','Leopards','Liberators','Lions','Lumberjacks','Lynx','Mages','Magnolias','Mammoths','Mariners','Marshals','Mastiffs','Merchants','Meteors','Minutemen','Mockingbirds','Monarchs','Mountaineers','Mounties','Mustangs','Navigators','Nighthawks','Nomads','Northstars','Oaks','Olympians','Orcas','Orioles','Outlaws','Owls','Panthers','Patriots','Phantoms','Pheasants','Pilots','Pioneers','Prairie','Predators','Pride','Pumas','Quails','Racers','Raiders','Rams','Rangers','Rapids','Ravens','Rebels','Redcoats','Renegades','Riders','Riveters','Rockets','Rovers','Royals','Saints','Scorpions','Sentinels','Sharks','Sky','Slingshots','Smelters','Sounders','Spartans','Spirits','Squires','Stallions','Stampede','Stars','Steel','Stingers','Stompers','Stormers','Strikers','Suns','Swans','Talons','Templars','Thunder','Tigers','Timberwolves','Titans','Tornadoes','Tridents','Trojans','Tundra','Tycoons','Vagabonds','Vanguards','Vikings','Vipers','Voyagers','Warblers','Warriors','Whitetails','Wildcats','Witches','Wizards','Wolverines','Wolves','Yetis','Zephyrs'
];

// Sponsor / generic park name parts
window.BBGM_PARK_NAMES = {
  prefixes: ['Liberty', 'Heritage', 'Capital', 'United', 'Metropolitan', 'Founders', 'Patriot', 'Coastal', 'Pacific', 'Atlantic', 'National', 'Champions', 'Citizens', 'Crescent', 'Riverside', 'Lakeside', 'Continental'],
  suffixes: ['Park', 'Stadium', 'Field', 'Yards', 'Coliseum', 'Grounds'],
};
