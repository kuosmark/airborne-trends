import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHistoryDay } from '../backend/history-builder.ts';
import { DAY_MS, isHistoryDay } from '../shared/history-chart.ts';
import { HOUR_MS, SAMPLE_MS, summarizeHistoryDay, summaryPoints } from '../shared/history-summary.ts';
import { plotHistory } from '../src/history-plot.ts';
const start = Date.parse('2026-10-30T00:00:00Z');
function record(slot, count = 100) {
  return {schemaVersion:1,countingVersion:1,referenceVersion:'a'.repeat(64),
    observedAt:new Date(start+slot*SAMPLE_MS+20000).toISOString(),scheduledSlot:start/SAMPLE_MS+slot,
    airborneCount:count,operators:[{id:'FIN',name:'Finnair',count}],aircraftTypes:[],unknownOperatorCount:0,unknownTypeCount:count};
}
const day = slots => buildHistoryDay('2026-10-30', slots.map(s=>record(s)));
test('archived records produce hourly averages, distinguish zero from missing, and break the chart at uncovered buckets',()=>{
  const records=[record(0,10),record(1,20),record(2,30),record(4),record(8),record(9),record(10)];
  records[1].operators=[];records[1].unknownOperatorCount=20;
  const source=buildHistoryDay('2026-10-30',records);
  const hourly=summarizeHistoryDay(source,HOUR_MS,start+3*HOUR_MS);
  assert.deepEqual(hourly.map(b=>[b.samples,b.expected,b.isCovered]),[[3,4,true],[1,4,false],[3,4,true]]);
  const points=summaryPoints(hourly,'operators','FIN');
  assert.equal(points[0].count,40/3);
  assert.equal(summaryPoints(hourly,'operators','XXX')[0].count,0);
  assert.equal((plotHistory(points,start,start+3*HOUR_MS,100,HOUR_MS).path.match(/M/g)||[]).length,2);
});
test('daily averages require 90% coverage and reject a long missing run even above 90%',()=>{
  const slots=Array.from({length:96},(_,i)=>i);
  assert.equal(summarizeHistoryDay(day(slots.filter(i=>i%12!==0)),DAY_MS,start+DAY_MS)[0].isCovered,true);
  assert.equal(summarizeHistoryDay(day(slots.filter(i=>i>=5)),DAY_MS,start+DAY_MS)[0].isCovered,false);
  assert.equal(summarizeHistoryDay(day(slots.filter(i=>i%8!==0)),DAY_MS,start+DAY_MS)[0].isCovered,false);
});
test('partial UTC days use elapsed slots and remain marked partial',()=>{
  const result=summarizeHistoryDay(day([0,1,2,3]),DAY_MS,start+HOUR_MS)[0];
  assert.equal(result.expected,4);assert.equal(result.isPartial,true);assert.equal(result.isCovered,true);
  assert.equal(result.time,start);assert.equal(result.end,start+HOUR_MS);
});
test('duplicates in a scheduled slot contribute only the latest observation',()=>{
  const first=record(0,10), newer={...record(0,30),observedAt:new Date(start+30000).toISOString()};
  const result=summarizeHistoryDay(buildHistoryDay('2026-10-30',[first,newer,record(1,30),record(2,30)]),HOUR_MS,start+HOUR_MS)[0];
  assert.equal(result.samples,3);assert.equal(result.total,30);
});
test('old daily files remain usable and malformed optional summaries are rejected',()=>{
  const source=day([0,1,2,3]);delete source.slots;
  const summaries={hourly:summarizeHistoryDay(source,HOUR_MS,start+HOUR_MS),daily:summarizeHistoryDay(source,DAY_MS,start+HOUR_MS)};
  assert.equal(isHistoryDay(source),true);assert.equal(isHistoryDay({...source,summaries}),true);
  assert.equal(isHistoryDay({...source,summaries:{...summaries,daily:[{...summaries.daily[0],total:NaN}]}}),false);
});
test('a fresh observation just before UTC midnight remains in its observed day when collected after midnight',()=>{
  const source=buildHistoryDay('2026-10-30',[{...record(95),observedAt:'2026-10-30T23:59:30.000Z',scheduledSlot:start/SAMPLE_MS+96}]);
  const buckets=summarizeHistoryDay(source,HOUR_MS,start+DAY_MS);
  assert.equal(buckets.reduce((sum,b)=>sum+b.samples,0),1);
  assert.equal(buckets[23].samples,1);
});
