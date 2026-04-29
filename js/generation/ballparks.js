// Ballpark generation with park factors per bible 4.5.
window.BBGM_BALLPARKS = (function () {
  const { rint, rfloat, pick } = window.BBGM_RNG;

  function generate(rng, city, type) {
    const prefixes = window.BBGM_PARK_NAMES.prefixes;
    const suffixes = window.BBGM_PARK_NAMES.suffixes;
    const styles = [
      () => `${pick(rng, prefixes)} ${pick(rng, suffixes)}`,
      () => `${city} ${pick(rng, suffixes)}`,
      () => `${pick(rng, prefixes)} ${pick(rng, suffixes)} at ${city}`,
    ];
    const name = pick(rng, styles)();
    const capacity = rint(rng, 30000, 55000);
    const yearBuilt = rint(rng, 1990, 2024);

    let factors;
    if (type === 'hitter') {
      factors = {
        run: rint(rng, 108, 115),
        hr: rint(rng, 110, 125),
        hits: rint(rng, 100, 108),
        xbh: rint(rng, 100, 115),
      };
    } else if (type === 'pitcher') {
      factors = {
        run: rint(rng, 88, 95),
        hr: rint(rng, 80, 92),
        hits: rint(rng, 95, 100),
        xbh: rint(rng, 90, 100),
      };
    } else if (type === 'quirk') {
      factors = {
        run: rint(rng, 95, 110),
        hr: rint(rng, 85, 120),
        hits: rint(rng, 95, 108),
        xbh: rint(rng, 90, 120),
      };
    } else {
      factors = {
        run: rint(rng, 95, 105),
        hr: rint(rng, 92, 108),
        hits: rint(rng, 96, 104),
        xbh: rint(rng, 95, 105),
      };
    }
    const foulTerritory = pick(rng, ['small', 'medium', 'large']);

    return { name, capacity, yearBuilt, factors, foulTerritory };
  }

  return { generate };
})();
