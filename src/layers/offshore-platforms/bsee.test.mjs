import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATFORM_LOCATION_LAYOUT,
  PLATFORM_MASTER_LAYOUT,
  PLATFORM_STRUCTURE_LAYOUT,
  joinPlatforms,
  parseBseeDate,
  parseCompanies,
  parseFixedWidth,
} from './bsee.js';

// Verbatim records from the BSEE Data Center fixed-width files (September 2026).
const LOCATION_LINE =
  '  4     183  1AC    25     A (Hoover)  5694S  2590E          1090370          9778974  -94.68872137  26.93905139';
const STRUCTURE_LINE =
  'MI  565    10321 3W01-JAN-198821-JUL-1994NN02-AUG-1991     1  1  011               1CAIS   7290  6072  0OCS LEASE       G04138  TERMIN              ';
const MASTER_LINE =
  '   20001YNYN  50NYYN00231NY  0068529-APR-2004NNYNN   90NN  N 1NNY YNN   BM002  1  NN   GI    37N';

test('dates in BSEE DD-MON-YYYY form become ISO dates', () => {
  assert.equal(parseBseeDate('01-JAN-1988'), '1988-01-01');
  assert.equal(parseBseeDate('29-APR-2004'), '2004-04-29');
  assert.equal(parseBseeDate(''), null);
  assert.equal(parseBseeDate('31-FOO-2000'), null);
  assert.equal(parseBseeDate(undefined), null);
});

test('fixed-width records split by 1-based column layouts and trim each field', () => {
  const [location] = parseFixedWidth(
    `${LOCATION_LINE}\r\n\r\n`,
    PLATFORM_LOCATION_LAYOUT,
  );
  assert.deepEqual(
    [
      location.complexId,
      location.structureNumber,
      location.areaCode,
      location.blockNumber,
      location.structureName,
      location.longitude,
      location.latitude,
    ],
    ['183', '1', 'AC', '25', 'A (Hoover)', '-94.68872137', '26.93905139'],
  );

  const [structure] = parseFixedWidth(
    STRUCTURE_LINE,
    PLATFORM_STRUCTURE_LAYOUT,
  );
  assert.deepEqual(
    [
      structure.areaCode,
      structure.blockNumber,
      structure.complexId,
      structure.installDate,
      structure.removalDate,
      structure.structureName,
      structure.structureNumber,
      structure.structureType,
    ],
    ['MI', '565', '10321', '01-JAN-1988', '02-AUG-1991', '11', '1', 'CAIS'],
  );

  const [master] = parseFixedWidth(MASTER_LINE, PLATFORM_MASTER_LAYOUT);
  assert.deepEqual(
    [
      master.complexId,
      master.distanceToShore,
      master.gasProdFlag,
      master.companyNumber,
      master.manned24HrFlag,
      master.waterDepth,
      master.heliportFlag,
      master.oilProdFlag,
      master.condnProdFlag,
      master.areaCode,
      master.blockNumber,
    ],
    ['20001', '50', 'Y', '00231', 'N', '90', 'Y', 'N', 'N', 'GI', '37'],
  );
});

test('company history resolves each number to its current name', () => {
  const text = [
    '"00078","19610328","California Oil Company","CALIFORNIA OIL COMPANY","19650722","","G"',
    '"00078","19770421","Chevron U.S.A. Inc.","CHEVRON USA INC","","P","G"',
    '"00078","19650722","Chevron Oil Company","CHEVRON OIL COMPANY","19770421","","G"',
    '"00087","19621009","10th OCS Oil and Gas Lease Sale","10TH OCS O & G LEASE SALE","19621009","","G"',
    '"03267","20121107","145 OG HOLDINGS, LLC","145 OG HOLDINGS LLC","","P","G"',
    '',
  ].join('\r\n');
  assert.deepEqual(
    [...parseCompanies(text)],
    [
      ['00078', 'Chevron U.S.A. Inc.'],
      ['00087', '10th OCS Oil and Gas Lease Sale'],
      ['03267', '145 OG HOLDINGS, LLC'],
    ],
  );
});

test('standing structures join location, structure and complex details; removed or unplaced ones are dropped', () => {
  const locations = [
    {
      complexId: '183',
      structureNumber: '1',
      areaCode: 'AC',
      blockNumber: '25',
      structureName: 'A (Hoover)',
      longitude: '-94.68872137',
      latitude: '26.93905139',
    },
    {
      complexId: '10321',
      structureNumber: '1',
      areaCode: 'MI',
      blockNumber: '565',
      structureName: '11',
      longitude: '-94.1',
      latitude: '28.1',
    },
    {
      complexId: '500',
      structureNumber: '2',
      areaCode: 'EI',
      blockNumber: '10',
      structureName: 'B',
      longitude: '',
      latitude: '',
    },
    {
      complexId: '600',
      structureNumber: '1',
      areaCode: 'SS',
      blockNumber: '7',
      structureName: 'C',
      longitude: '-91.2',
      latitude: '28.7',
    },
  ];
  const structures = [
    {
      complexId: '183',
      structureNumber: '1',
      structureType: 'SPAR',
      installDate: '01-JAN-2000',
      removalDate: '',
    },
    {
      complexId: '10321',
      structureNumber: '1',
      structureType: 'CAIS',
      installDate: '01-JAN-1988',
      removalDate: '02-AUG-1991',
    },
    {
      complexId: '500',
      structureNumber: '2',
      structureType: 'FIXED',
      installDate: '',
      removalDate: '',
    },
    {
      complexId: '600',
      structureNumber: '1',
      structureType: 'WP',
      installDate: '15-MAR-1975',
      removalDate: '',
    },
  ];
  const masters = [
    {
      complexId: '183',
      waterDepth: '4825',
      distanceToShore: '160',
      companyNumber: '00078',
      oilProdFlag: 'Y',
      gasProdFlag: 'Y',
      condnProdFlag: 'N',
      manned24HrFlag: 'Y',
      heliportFlag: 'Y',
    },
  ];
  const companies = new Map([['00078', 'ExxonMobil Corporation']]);

  assert.deepEqual(
    joinPlatforms({ locations, structures, masters, companies }),
    [
      {
        id: '183-1',
        name: 'A (Hoover)',
        lat: 26.93905,
        lon: -94.68872,
        area: 'AC',
        block: '25',
        type: 'SPAR',
        installed: '2000-01-01',
        waterDepthFt: 4825,
        distanceToShoreNm: 160,
        operator: 'ExxonMobil Corporation',
        products: ['oil', 'gas'],
        manned: true,
        heliport: true,
      },
      {
        id: '600-1',
        name: 'C',
        lat: 28.7,
        lon: -91.2,
        area: 'SS',
        block: '7',
        type: 'WP',
        installed: '1975-03-15',
        waterDepthFt: null,
        distanceToShoreNm: null,
        operator: null,
        products: [],
        manned: false,
        heliport: false,
      },
    ],
  );
});
