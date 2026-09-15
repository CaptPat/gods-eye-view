# Offshore platforms snapshot

`offshore-platforms.json` joins four
[BSEE Data Center](https://www.data.bsee.gov/Main/Platform.aspx) downloads:

- platform locations;
- platform structures;
- platform masters;
- the company list.

They are U.S. Government works in the public domain. Attribution: Bureau of Safety and Environmental Enforcement, *BSEE Data Center*.

- **Rows:** 1,321 standing structures in U.S. federal offshore waters, as of September 2026. A structure is left out if it has a removal date or no surface location.
- **Format:** compact `{ source, license, retrievedAt, fields, rows }`.
- **Fields:**
  - id (complex and structure number) and structure name;
  - latitude and longitude (5 decimals);
  - area code and block;
  - structure type code and installation date;
  - water depth (ft) and distance to shore (nm);
  - current operator name;
  - products (oil, gas, condensate);
  - manned 24 hours and heliport flags.
- **Joins:**
  - Locations and structures match on complex id plus structure number.
  - Masters match on complex id.
  - Company numbers resolve to the name without an end date in the company history.

Rebuild with:

```sh
node scripts/build-bsee-platforms.mjs
```
