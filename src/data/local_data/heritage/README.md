# Heritage snapshots

Compact snapshots of Wikidata items, released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Each file is a
`{ source, license, retrievedAt, fields, rows }` table. The `wiki` column holds the English Wikipedia
article title; cards fall back to the Wikidata entry when it is empty.

| File | Wikidata selection | Fields |
|---|---|---|
| `world-heritage.json` | heritage designation (P1435) World Heritage Site (Q9259), with a coordinate | countries (P17, all), inception year (P571, earliest), description |
| `forts-castles.json` | classes castle, fort, fortification and star fort, one query per class | kind (the most specific class), country |
| `parks-monuments.json` | national park (Q46169) and National Monument of the United States (Q893775) | kind (park wins when both apply), country, inception year, description |

Labels fall back from English through multilingual and major European and Asian languages. Items
without any label are dropped.

Rebuild with:

```sh
node scripts/build-wikidata-layers.mjs heritage
```
