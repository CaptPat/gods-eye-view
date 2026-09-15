# Night sky catalogue

Compact JSON trimmed from [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn. It
is released under the BSD-3-Clause licence; the full text is in `LICENSE-d3-celestial.txt` in this
folder. The underlying star positions come from the Hipparcos catalogue (ESA). The constellation
figures and boundaries follow the IAU.

| File | Rows | Contents |
|---|---|---|
| `stars.json` | 921 | `[raDeg, decDeg, magnitude, B−V]`, stars to magnitude 4.5, brightest first |
| `star-names.json` | 91 | `[raDeg, decDeg, magnitude, name]`, proper names to magnitude 2.5 |
| `constellations.json` | 150 figures, 89 labels | `{ lines: [[[ra, dec], …]], labels: [[latinName, ra, dec]] }`; Serpens has two labels |
| `messier.json` | 110 | `[id, commonName, type, magnitude, raDeg, decDeg]` |

d3-celestial stores right ascension as a longitude from −180 to 180, with 12h–24h negative. These
files convert it back to 0–360°.

Rebuild with:

```sh
node scripts/build-night-sky.mjs
```
