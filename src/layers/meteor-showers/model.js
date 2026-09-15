/**
 * Pure Meteor Showers model: the IMO working list (2026 dates, via Wikipedia's
 * "List of meteor showers"), today's active showers, sub-radiant positions and
 * card text. The antihelion source is left out: its radiant is not fixed.
 */

export const METEOR_SHOWERS_META = Object.freeze({
  id: 'meteor-showers',
  name: 'Meteor Showers',
  icon: '🌠',
  source: 'IMO calendar',
  color: '#9fd3ff',
  selectedSourceId: 'meteor-showers-selected',
  loadingLabel: 'Computing radiants',
  unavailableText: 'Meteor showers unavailable',
  refreshFailedText: 'Meteor shower refresh failed',
});

const shower = (
  name,
  start,
  end,
  peak,
  raHours,
  decDeg,
  speedKms,
  zhr,
  parent,
  article,
) =>
  Object.freeze({
    name,
    start,
    end,
    peak,
    raHours,
    decDeg,
    speedKms,
    zhr,
    parent,
    article,
  });

/** name, active start/end and peak (MM-DD), radiant RA (h) and Dec (°), km/s, ZHR, parent, Wikipedia article */
export const METEOR_SHOWERS = Object.freeze([
  shower(
    'Quadrantids',
    '12-28',
    '01-12',
    '01-03',
    15.3,
    49,
    41,
    80,
    '(196256) 2003 EH1?',
    'Quadrantids',
  ),
  shower(
    'Gamma Ursae Minorids',
    '01-10',
    '01-22',
    '01-18',
    15.2,
    67,
    31,
    3,
    null,
    null,
  ),
  shower(
    'Alpha Centaurids',
    '01-31',
    '02-20',
    '02-08',
    14.1,
    -58,
    58,
    6,
    null,
    'Alpha_Centaurids',
  ),
  shower(
    'Lyrids',
    '04-14',
    '04-30',
    '04-22',
    18.1,
    34,
    49,
    18,
    'C/1861 G1 (Thatcher)',
    'Lyrids',
  ),
  shower(
    'Pi Puppids',
    '04-15',
    '04-28',
    '04-24',
    7.3,
    -45,
    18,
    null,
    '26P/Grigg–Skjellerup',
    'Pi_Puppids',
  ),
  shower(
    'Eta Aquariids',
    '04-19',
    '05-28',
    '05-06',
    22.5,
    -1,
    66,
    50,
    '1P/Halley',
    'Eta_Aquariids',
  ),
  shower(
    'Eta Lyrids',
    '05-03',
    '05-14',
    '05-11',
    19.4,
    43,
    43,
    3,
    'C/1983 H1 (IRAS–Araki–Alcock)',
    null,
  ),
  shower(
    'Daytime Arietids',
    '05-14',
    '06-24',
    '06-07',
    2.9,
    24,
    38,
    30,
    '1566 Icarus?',
    'Daytime_Arietids',
  ),
  shower(
    'June Bootids',
    '06-22',
    '07-02',
    '06-22',
    14.7,
    48,
    18,
    null,
    '7P/Pons–Winnecke',
    'June_Bootids',
  ),
  shower(
    'July Pegasids',
    '07-01',
    '07-20',
    '07-10',
    23.1,
    11,
    63,
    3,
    'C/1979 Y1 (Bradfield)',
    null,
  ),
  shower(
    'July Gamma Draconids',
    '07-25',
    '07-31',
    '07-28',
    18.7,
    51,
    27,
    5,
    null,
    null,
  ),
  shower(
    'Southern Delta Aquariids',
    '07-12',
    '08-23',
    '07-31',
    22.7,
    -16,
    41,
    25,
    'P/2008 Y12 (SOHO)',
    'Southern_Delta_Aquariids',
  ),
  shower(
    'Alpha Capricornids',
    '07-03',
    '08-15',
    '07-31',
    20.5,
    -10,
    23,
    5,
    '169P/NEAT',
    'Alpha_Capricornids',
  ),
  shower(
    'Eta Eridanids',
    '07-31',
    '08-19',
    '08-07',
    2.7,
    -11,
    64,
    3,
    'C/1852 K1 (Chacornac)',
    null,
  ),
  shower(
    'Perseids',
    '07-17',
    '08-24',
    '08-13',
    3.2,
    58,
    59,
    100,
    '109P/Swift-Tuttle',
    'Perseids',
  ),
  shower(
    'Kappa Cygnids',
    '08-03',
    '08-28',
    '08-17',
    19.1,
    59,
    23,
    3,
    null,
    'Kappa_Cygnids',
  ),
  shower(
    'Aurigids',
    '08-28',
    '09-05',
    '09-01',
    6.1,
    39,
    66,
    6,
    'C/1911 N1 (Kiess)',
    'Aurigids',
  ),
  shower(
    'September Epsilon Perseids',
    '09-05',
    '09-21',
    '09-09',
    3.2,
    40,
    64,
    8,
    null,
    null,
  ),
  shower(
    'September Lyncids',
    '09-10',
    '10-08',
    '09-13',
    7.5,
    56,
    60,
    3,
    null,
    null,
  ),
  shower(
    'Daytime Sextantids',
    '09-20',
    '10-06',
    '10-01',
    10.4,
    -2,
    32,
    5,
    '(155140) 2005 UD',
    null,
  ),
  shower(
    'October Camelopardalids',
    '10-05',
    '10-06',
    '10-06',
    10.9,
    79,
    47,
    5,
    null,
    null,
  ),
  shower(
    'October Draconids',
    '10-06',
    '10-10',
    '10-09',
    17.5,
    54,
    20,
    5,
    '21P/Giacobini–Zinner',
    'Draconids',
  ),
  shower(
    'Epsilon Geminids',
    '10-14',
    '10-27',
    '10-18',
    6.8,
    27,
    70,
    3,
    'C/1964 N1 (Ikeya)',
    null,
  ),
  shower(
    'Orionids',
    '10-02',
    '11-07',
    '10-21',
    6.3,
    16,
    66,
    20,
    '1P/Halley',
    'Orionids',
  ),
  shower(
    'Leonis Minorids',
    '10-19',
    '10-27',
    '10-24',
    10.8,
    37,
    62,
    2,
    'C/1739 K1',
    'Leonis_Minorids',
  ),
  shower(
    'Southern Taurids',
    '09-20',
    '11-20',
    '11-05',
    3.5,
    15,
    27,
    7,
    '2P/Encke',
    'Taurids',
  ),
  shower(
    'Northern Taurids',
    '10-20',
    '12-10',
    '11-12',
    3.9,
    22,
    29,
    5,
    '2004 TG10',
    'Taurids',
  ),
  shower(
    'Leonids',
    '11-06',
    '11-30',
    '11-17',
    10.1,
    22,
    71,
    15,
    '55P/Tempel–Tuttle',
    'Leonids',
  ),
  shower(
    'Alpha Monocerotids',
    '11-15',
    '11-25',
    '11-22',
    7.8,
    1,
    65,
    null,
    null,
    'Alpha_Monocerotids',
  ),
  shower(
    'November Orionids',
    '11-13',
    '12-06',
    '11-28',
    6.1,
    16,
    44,
    3,
    null,
    null,
  ),
  shower(
    'Phoenicids',
    '12-01',
    '12-05',
    '12-02',
    0.5,
    -27,
    15,
    null,
    '289P/Blanpain',
    'Phoenicids',
  ),
  shower('Puppid-Velids', '12-01', '12-15', null, 8.2, -45, 44, 10, null, null),
  shower(
    'Monocerotids',
    '12-01',
    '12-19',
    '12-09',
    6.7,
    8,
    41,
    3,
    'C/1917 F1 (Mellish)',
    'Monocerotids',
  ),
  shower(
    'Sigma Hydrids',
    '12-03',
    '12-20',
    '12-09',
    8.3,
    2,
    58,
    7,
    'C/2023 P1 (Nishimura)',
    'Sigma_Hydrids',
  ),
  shower(
    'Geminids',
    '12-04',
    '12-20',
    '12-14',
    7.5,
    33,
    35,
    150,
    '3200 Phaethon',
    'Geminids',
  ),
  shower(
    'Comae Berenicids',
    '12-04',
    '01-30',
    '12-23',
    10.9,
    29,
    65,
    3,
    null,
    'Comae_Berenicids',
  ),
  shower(
    'Ursids',
    '12-17',
    '12-26',
    '12-22',
    14.5,
    76,
    33,
    10,
    '8P/Tuttle',
    'Ursids',
  ),
]);

const LIST_URL = 'https://en.wikipedia.org/wiki/List_of_meteor_showers';
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const monthDay = (date) =>
  `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

const formatMonthDay = (text) => {
  const [month, day] = text.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
};

const latitudeText = (lat) => `${Math.abs(lat)}°${lat < 0 ? 'S' : 'N'}`;

/** Greenwich mean sidereal time in degrees [0, 360). */
export function gmstDegrees(date) {
  const julianDate = date.getTime() / 86_400_000 + 2_440_587.5;
  const degrees = 280.46061837 + 360.98564736629 * (julianDate - 2_451_545.0);
  return ((degrees % 360) + 360) % 360;
}

/** Showers whose activity window (which may wrap past New Year) includes `date` (UTC). */
export function activeShowers(date) {
  const today = monthDay(date);
  return METEOR_SHOWERS.filter(({ start, end }) =>
    start <= end
      ? today >= start && today <= end
      : today >= start || today <= end,
  );
}

/** The point on Earth directly below a shower's radiant at `date`. */
export function radiantSubpoint(entry, date) {
  let lon = entry.raHours * 15 - gmstDegrees(date);
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: entry.decDeg, lon };
}

/** 6 px for a trickle, two more per tenfold hourly rate, capped at 12; variable showers 8. */
export function showerPixelSize(zhr) {
  if (!Number.isFinite(zhr)) return 8;
  const size = Math.round((6 + 2 * Math.log10(Math.max(zhr, 1))) * 100) / 100;
  return Math.min(12, Math.max(6, size));
}

export function buildShowerCard(entry) {
  const peak = entry.peak
    ? `Peak ${formatMonthDay(entry.peak)}`
    : 'Peak varies';
  const rate = Number.isFinite(entry.zhr) ? `ZHR ${entry.zhr}` : 'ZHR variable';
  const low = Math.max(-90, entry.decDeg - 60);
  const high = Math.min(90, entry.decDeg + 60);
  return {
    title: entry.name,
    details: [
      `${peak} · ${rate} · ${entry.speedKms} km/s`,
      `Active ${formatMonthDay(entry.start)} – ${formatMonthDay(entry.end)}`,
      entry.parent ? `Parent ${entry.parent}` : 'Parent body unknown',
      `Radiant 30°+ high from ${latitudeText(low)} to ${latitudeText(high)}`,
    ],
    url: entry.article
      ? `https://en.wikipedia.org/wiki/${entry.article}`
      : LIST_URL,
    accessibilityLabel: entry.article
      ? `Open the Wikipedia article on the ${entry.name}`
      : 'Open the Wikipedia list of meteor showers',
  };
}

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Catalog records for the showers active at `date`, placed under their radiants. */
export function showerRecords(date) {
  return {
    records: activeShowers(date).map((entry) => ({
      ...entry,
      id: slug(entry.name),
      ...radiantSubpoint(entry, date),
      pixelSize: showerPixelSize(entry.zhr),
    })),
    stale: false,
  };
}
