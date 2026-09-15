# Nuclear snapshots

These are snapshots of Wikidata items, released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Each card links to the English
Wikipedia article when there is one, and to Wikidata otherwise.

| File | Wikidata classes | Fields |
|---|---|---|
| `nuclear-power-plants.json` | nuclear power plant, with a coordinate | states of use (P5817), installed capacity (P2109, maximum), operator (P137), country (P17), service entry or inception year (P729/P571, earliest), retirement year (P730/P576, latest) |
| `nuclear-waste-sites.json` | radioactive waste repository, deep geological repository | operator, country |
| `nuclear-accidents.json` | nuclear accident, nuclear disaster, nuclear and radiation accident, radiation accident | date (P585/P580), International Nuclear Event Scale level (P2127), deaths (P1120, maximum), country |

Waste sites and accidents without their own coordinate fall back to their location (P276) or
administrative area (P131). Those records are marked `approximate`.

Rebuild with:

```sh
node scripts/build-wikidata-layers.mjs
```
