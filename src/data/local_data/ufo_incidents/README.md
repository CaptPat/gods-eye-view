# UFO incidents snapshot

`ufo-incidents.json` is a snapshot of notable UFO incidents from
[Wikidata](https://www.wikidata.org/), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

The snapshot covers items classed as UFO sighting, unidentified flying object,
close encounter, alien abduction, UFO crash or UFO incident. Each item needs an
English label and a location. That location is either the item's own
coordinates, or the coordinates of its location or its administrative area. The
second kind is marked `approximate`, and its card says so. Cards link to the
English Wikipedia article when there is one, and to Wikidata otherwise.

Rebuild it with:

```sh
node scripts/build-ufo-incidents.mjs
```

The National UFO Reporting Center (NUFORC) database is deliberately not used.
Its terms of service forbid scraping and redistributing its reports.
