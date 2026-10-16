import {describe,it,expect} from 'vitest';
import {cellOffset} from '../src/live/table-interactions';
import {parseTable} from '../src/live/tables';

describe('root table selection inverse raw mapping',()=>{
 const text='| A |\n| - |\n| 😀a\\|右 |';
 const cell=parseTable(text,{from:0,to:text.length})!.rows[1].cells[0];
 it('maps complete astral and escaped-pipe source ranges without splitting characters',()=>{
  expect([cellOffset(cell,14,-1),cellOffset(cell,16,1)]).toEqual([0,2]);
  expect([cellOffset(cell,17,-1),cellOffset(cell,19,1)]).toEqual([3,4]);
 });
 it('widens partial raw escapes and surrogate halves only in the visible projection',()=>{
  expect([cellOffset(cell,18,-1),cellOffset(cell,19,1)]).toEqual([3,4]);
  expect([cellOffset(cell,15,-1),cellOffset(cell,15,1)]).toEqual([0,2]);
  expect([cellOffset(cell,0,-1),cellOffset(cell,999,1)]).toEqual([0,5]);
 });
});
