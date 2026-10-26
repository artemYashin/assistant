import test from 'node:test';
import assert from 'node:assert/strict';
import { groupHelpSources } from './help-source-groups.mjs';

test('split source keeps original declaration order and actual line references', () => {
  const sources = new Map([
    ['src/app/root.tsx', 'import X from "x";\nfunction Last() { return <button>Last</button>; }'],
    ['src/pages/first.tsx', '\n\nexport function First() {\n return <button>First</button>;\n}'],
    ['src/other.ts', 'export const value = 1;'],
  ]);
  const result = groupHelpSources(sources, [{path:'src/app/root.tsx', declarations:[{path:'src/pages/first.tsx',name:'First'},{path:'src/app/root.tsx',name:'Last'}]}]);
  assert.equal(result.length, 2);
  const grouped = result.find(x => x.path === 'src/app/root.tsx');
  assert.ok(grouped.source.indexOf('First') < grouped.source.indexOf('Last'));
  assert.deepEqual(grouped.locations.slice(0,4), ['src/pages/first.tsx:3','src/pages/first.tsx:4','src/pages/first.tsx:5','src/app/root.tsx:2']);
  assert.equal(result.find(x => x.path === 'src/other.ts').source, sources.get('src/other.ts'));
});

test('new declarations remain visible even before adding them to the migration manifest', () => {
  const source = 'export const old = 1;\nexport const added = "Ошибка нового действия";';
  const [result] = groupHelpSources(new Map([['src/a.ts',source]]), [{path:'src/a.ts',declarations:[{path:'src/a.ts',name:'old'}]}]);
  assert.match(result.source, /Ошибка нового действия/);
  assert.equal(result.locations[1], 'src/a.ts:2');
});

test('missing and duplicate declarations fail rather than silently hiding help', () => {
  const sources = new Map([['src/a.ts','const value = 1;']]);
  const group = declarations => [{path:'src/a.ts',declarations}];
  assert.throws(() => groupHelpSources(sources, group([{path:'src/missing.ts',name:'value'}])), /Missing help source/);
  assert.throws(() => groupHelpSources(sources, group([{path:'src/a.ts',name:'missing'}])), /Missing help declaration/);
  const item = {path:'src/a.ts',name:'value'};
  assert.throws(() => groupHelpSources(sources, group([item,item])), /Duplicate help declaration/);
});
