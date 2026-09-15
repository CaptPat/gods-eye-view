# Heritage layers: World Heritage Sites, Forts & Castles, National Parks & Monuments — design

Status: in progress (2026-09-15)
Fork: CaptPat/gods-eye-view (Cyclops View). Fork-only work; nothing is proposed upstream.

This is wave 3 of the infrastructure and heritage work (see `2026-09-15-nuclear-layers-design.md`).

## Layers

| Layer id | Name | Token | Records (measured 2026-09-15) |
|---|---|---|---|
| `world-heritage` | World Heritage Sites | `H` | 3,339 located items with heritage designation (P1435) World Heritage Site (Q9259) |
| `forts-castles` | Forts & Castles | `K` | 31,720 located items of class castle (22,695), fortification (4,714), fort (4,425) or star fort (27) |
| `parks-monuments` | National Parks & Monuments | `P` | 2,579 located national parks (Q46169) and National Monuments of the United States (Q893775) |

All three join a new "Heritage" group in the Layers panel. Uppercase tokens are allowed since the capacity
change; digits are used up.

## Sources

Every record comes from Wikidata (CC0). Labels fall back through English, then multilingual labels,
then the major European and Asian languages, so non-English items keep a name.

The combined forts query timed out mid-response at 5.6 MB. So the build runs one query per class and
merges the bindings before normalising. The castle class alone takes about 27 s.

Because of their size, the snapshots are compact `{ source, license, retrievedAt, fields, rows }`
tables. Each row stores only the Wikipedia article title; the Wikidata URL is derived from the id.
Estimated sizes: forts about 2.4 MB, World Heritage about 0.3 MB, parks about 0.2 MB.

## Presentation

Every layer uses `src/layers/catalog-points` and loads its snapshot only when it is enabled.

**World Heritage.** Gold points. The card gives the inscription or inception year when Wikidata has one,
all countries (transnational sites list several), and the description.

**Forts & Castles.** Colour by kind: castle stone red, fort olive, fortification sand, star fort orange.
Points are 4 px because there are so many. The card gives kind and country.

**Parks & Monuments.** National parks green, US National Monuments teal. The card gives kind, country,
area (km²) and established year.

Cards link to English Wikipedia, or to Wikidata when there is no article.
