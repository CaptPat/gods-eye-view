# Severe weather fixtures

Real responses recorded 2026-09-14 (about 16:05 UTC) for the Severe Weather layer tests, trimmed
to the fields the proxy reads. They are never served to the app.

- `nws-alerts-active.json`: `https://api.weather.gov/alerts/active` (GeoJSON). 7 of the 291
  live alerts, with `description`, `instruction`, `parameters`, `geocode` and `references`
  removed:
  - Flood Watch (zones AKZ843, AKZ844);
  - Dense Fog Advisory (AKZ844, which is shared with the Flood Watch);
  - Wind Advisory (AKZ830, AKZ851, AKZ852);
  - Special Weather Statement (it carries its own polygon);
  - Red Flag Warning (fire zones NEZ434–NEZ436);
  - Heat Advisory (OKZ068);
  - a `Test` Test Message (county MDC031), which the proxy must drop.
- `nws-zones.json`: map of zone key (`forecast/AKZ844`) to the unmodified
  `https://api.weather.gov/zones/<type>/<id>` Feature for the 9 zones above. Real geometry, with
  properties trimmed to `id`, `type`, `name` and `state`. 605 positions in total.
- `gdacs-events4app.json`: `https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP`.
  7 of the 100 live events:
  - TC 1001320 (NORBERT-26);
  - TC 1001321 (FIFTEEN-E-26);
  - FL 1103888;
  - DR 1023877 (`iscurrent` false, long country list);
  - DR 1018431 (Orange);
  - WF 1031964;
  - EQ 1565204, which the proxy must exclude.

  `affectedcountries`, `severitydata`, `icon` and `htmldescription` were removed.
- `gdacs-map-tc.json`: `https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=TC`.
  The features for cyclone 1001321:
  - `Point_Centroid`;
  - one `Point_Polygon_Point_0` wind circle, which is not drawn;
  - `Poly_Green`, which is not drawn;
  - the ten `Line_Line_0`–`Line_Line_9` track segments, listed out of order as GDACS sends
    them;
  - `Poly_Cones`.

  Properties are trimmed to `eventtype`, `eventid`, `episodeid`, `name`, `alertlevel`,
  `polygonlabel` and `Class`.

Sources: National Weather Service (U.S. public domain); GDACS, European Commission JRC and UN
OCHA (see https://www.gdacs.org/About/termofuse.aspx).
