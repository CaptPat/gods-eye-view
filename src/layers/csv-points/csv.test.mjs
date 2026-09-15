import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from './csv.js';

test('a header row names each field; quoted commas, doubled quotes and CRLF endings survive', () => {
  assert.deepEqual(
    parseCsv(
      'id,name,note\r\n1,"Smith, Jones & Co","He said ""hi"""\r\n2,Plain,\n',
    ),
    [
      { id: '1', name: 'Smith, Jones & Co', note: 'He said "hi"' },
      { id: '2', name: 'Plain', note: '' },
    ],
  );
});

test('a quoted field may span lines, and blank lines are skipped', () => {
  assert.deepEqual(parseCsv('a,b\n"line one\nline two",x\n\n3,4'), [
    { a: 'line one\nline two', b: 'x' },
    { a: '3', b: '4' },
  ]);
});

test('short rows fill missing fields with empty strings; empty input has no rows', () => {
  assert.deepEqual(parseCsv('a,b,c\n1'), [{ a: '1', b: '', c: '' }]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('a,b\n'), []);
});
