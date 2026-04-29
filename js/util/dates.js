// Lightweight in-game date utilities. We use real JS Date for math but treat
// dates as in-game calendar dates.
window.BBGM_DATES = (function () {
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function fromYMD(y, m, d) {
    return { year: y, month: m, day: d };
  }

  function toJS(ymd) {
    return new Date(ymd.year, ymd.month - 1, ymd.day);
  }

  function fromJS(d) {
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }

  function addDays(ymd, n) {
    const d = toJS(ymd);
    d.setDate(d.getDate() + n);
    return fromJS(d);
  }

  function diffDays(a, b) {
    const da = toJS(a);
    const db = toJS(b);
    return Math.round((db - da) / (24 * 60 * 60 * 1000));
  }

  function compare(a, b) {
    if (a.year !== b.year) return a.year - b.year;
    if (a.month !== b.month) return a.month - b.month;
    return a.day - b.day;
  }

  function eq(a, b) {
    return compare(a, b) === 0;
  }

  function format(ymd, mode = 'short') {
    if (mode === 'iso') return `${ymd.year}-${String(ymd.month).padStart(2,'0')}-${String(ymd.day).padStart(2,'0')}`;
    if (mode === 'long') return `${MONTHS_LONG[ymd.month-1]} ${ymd.day}, ${ymd.year}`;
    if (mode === 'date') return `${MONTHS_SHORT[ymd.month-1]} ${ymd.day}`;
    return `${MONTHS_SHORT[ymd.month-1]} ${ymd.day}, ${ymd.year}`;
  }

  function dayName(ymd) {
    return DAYS[toJS(ymd).getDay()];
  }

  return { fromYMD, addDays, diffDays, compare, eq, format, dayName, toJS, fromJS, MONTHS_LONG, MONTHS_SHORT, DAYS };
})();
