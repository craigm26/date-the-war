// Theaters: the handful of places the day-to-day record keeps returning to.
// An event belongs to the theater whose words match its actors and place most
// often. Pure. Imported by the page, the briefing and the tests.

// [id, label, centre [lon, lat], strong words, weak words]. Weak words (the
// big capitals that appear in everyone's diplomacy) only decide a tie.
export const THEATERS = [
  ['gulf', 'Iran and the Gulf', [52, 28], ['iran', 'tehran', 'hormuz', 'gulf of oman', 'persian gulf', 'kharg', 'iraq', 'baghdad', 'saudi', 'riyadh', 'qatar', 'doha', 'kuwait', 'bahrain', 'oman', 'united arab emirates', 'uae', 'abu dhabi', 'dubai'], []],
  ['redsea', 'Yemen and the Red Sea', [44, 15], ['yemen', 'houthi', 'red sea', 'aden', 'sanaa', 'hodeidah', 'taiz', 'marib', 'bab el-mandeb', 'bab al-mandab', 'shabwa', 'djibouti'], []],
  ['levant', 'Israel, Gaza and Lebanon', [35, 32], ['israel', 'gaza', 'west bank', 'palestin', 'lebanon', 'beirut', 'hezbollah', 'hamas', 'syria', 'damascus', 'jordan', 'jerusalem'], []],
  ['europe', 'Russia, Ukraine and Europe', [32, 50], ['ukrain', 'kyiv', 'russia', 'moscow', 'kremlin', 'belarus', 'moldova', 'chisinau', 'poland', 'baltic', 'estonia', 'latvia', 'lithuania', 'finland', 'svalbard', 'black sea', 'crimea', 'donbas', 'kharkiv', 'odesa', 'zaporizh', 'serbia', 'kosovo', 'georgia', 'armenia', 'azerbaijan', 'nato'], ['germany', 'france', 'united kingdom', 'london', 'paris', 'berlin', 'brussels', 'european union', 'norway', 'sweden', 'denmark']],
  ['horn', 'Sudan and the Horn of Africa', [32, 12], ['sudan', 'khartoum', 'darfur', 'el fasher', 'kordofan', 'ethiopia', 'tigray', 'amhara', 'somalia', 'mogadishu', 'eritrea', 'chad', 'central african', 'kenya', 'uganda'], []],
  ['africa', 'Sahel and Central Africa', [10, 8], ['mali', 'burkina', 'niger', 'nigeria', 'sahel', 'congo', 'drc', 'goma', 'rwanda', 'burundi', 'cameroon', 'mozambique', 'libya', 'benin', 'togo'], []],
  ['asia', 'China, Taiwan and the Pacific', [125, 30], ['china', 'beijing', 'taiwan', 'taipei', 'japan', 'tokyo', 'philippine', 'south china sea', 'east china sea', 'korea', 'pyongyang', 'seoul', 'vietnam', 'thailand', 'cambodia', 'australia', 'guam', 'okinawa'], []],
  ['southasia', 'South Asia and Myanmar', [75, 27], ['india', 'pakistan', 'kashmir', 'afghanistan', 'kabul', 'bangladesh', 'myanmar', 'nepal', 'sri lanka', 'indus'], []],
  ['americas', 'The Americas', [-80, 15], ['venezuela', 'caracas', 'haiti', 'mexico', 'colombia', 'cuba', 'caribbean', 'panama', 'brazil', 'ecuador', 'peru', 'argentina', 'nicaragua'], ['united states', 'washington', 'canada', 'ottawa', 'u.s.']],
].map(([id, label, centre, strong, weak]) => ({ id, label, centre, strong: strong.map(word), weak: weak.map(word) }));

// Words match from their start ("ukrain" finds Ukrainian) but never inside
// another word ("oman" must not find Romania).
function word(w) { return new RegExp(`(^|[^a-z])${w.replace(/[.]/g, '\\.')}`); }

export const OTHER = { id: 'other', label: 'Worldwide and elsewhere', centre: [0, 20] };
const BY_ID = Object.fromEntries([...THEATERS, OTHER].map((t) => [t.id, t]));
export function theater(id) { return BY_ID[id] || null; }

const memo = new WeakMap();
export function theaterOf(ev) {
  if (memo.has(ev)) return memo.get(ev);
  const text = ` ${[...(ev.countries || []), ev.place || ''].join(' | ').toLowerCase()} `;
  let best = OTHER.id;
  let bestScore = 0;
  for (const t of THEATERS) {
    let s = 0;
    for (const w of t.strong) if (w.test(text)) s += 1;
    for (const w of t.weak) if (w.test(text)) s += 0.25;
    if (s > bestScore) { bestScore = s; best = t.id; }
  }
  memo.set(ev, best);
  return best;
}
