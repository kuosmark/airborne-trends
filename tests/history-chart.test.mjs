import { nearestHistoryPoint } from '../src/history-plot.ts';
import { historyTicks } from '../src/history-ticks.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHistoryDay } from '../backend/history-builder.ts';
import { historyPoints, isHistoryDay, isHistoryIndex } from '../shared/history-chart.ts';
import { plotHistory } from '../src/history-plot.ts';
const record = (time, count = 3) => ({schemaVersion:1,countingVersion:1,referenceVersion:'a'.repeat(64),
  observedAt:`2026-10-30T${time}:00.000Z`,scheduledSlot:Math.floor(Date.parse(`2026-10-30T${time}:00.000Z`)/900000),airborneCount:count,
  operators:[{id:'FIN',name:'Finnair',count}],aircraftTypes:[{id:'A320',name:'Airbus A320',count}],
  unknownOperatorCount:0,unknownTypeCount:0});
test('daily history sorts observations, omits repeated names and zero-fills absent groups only at observed times',()=>{
  const absent = {...record('00:30'),operators:[],unknownOperatorCount:3};
  const day=buildHistoryDay('2026-10-30',[absent,record('00:00')]);
  assert.deepEqual(day.operators.FIN,[3,0]);
  assert.equal(day.times.length,2);
  assert.equal(JSON.stringify(day).includes('Finnair'),false);
  const points=historyPoints([day],'operators','FIN',0,Infinity);
  assert.deepEqual(points.map(p=>p.count),[3,0]);
  assert.deepEqual(historyPoints([day],'operators','ZZZ',0,Infinity).map(p=>p.count),[0,0]);
});
test('invalid source totals, duplicate times and wrong dates prevent publication',()=>{
  assert.throws(()=>buildHistoryDay('2026-10-30',[{...record('00:00'),airborneCount:5}]));
  assert.throws(()=>buildHistoryDay('2026-10-30',[record('00:00'),record('00:00')]));
  assert.throws(()=>buildHistoryDay('2026-10-31',[record('00:00')]));
});
test('client validators reject malformed dates, counts and mismatched series',()=>{
  const day=buildHistoryDay('2026-10-30',[record('00:00')]);
  assert.equal(isHistoryDay(day),true);
  assert.equal(isHistoryDay({...day,totals:[-1]}),false);
  assert.equal(isHistoryDay({...day,operators:{FIN:[]}}),false);
  assert.equal(isHistoryDay({...day,times:['2026-10-31T00:00:00.000Z']}),false);
  assert.equal(isHistoryIndex({schemaVersion:1,generatedAt:day.times[0],days:['2026-02-30']}),false);
});
test('plot leaves missed refreshes as gaps and keeps actual observation positions',()=>{
  const points=[{time:0,count:3},{time:900000,count:4},{time:2700000,count:1}];
  const plot=plotHistory(points,0,3600000);
  assert.equal((plot.path.match(/M/g)||[]).length,2);
  assert.equal((plot.path.match(/L/g)||[]).length,1);
  assert.equal(plot.dots.length,3);
  assert.deepEqual(historyPoints([buildHistoryDay('2026-10-30',[record('00:00'),record('00:15')])],
    'total','',Date.parse('2026-10-30T00:10Z'),Date.parse('2026-10-30T00:20Z')).map(p=>p.count),[3]);
});
test('an all-zero series reports a zero peak without invalid plot coordinates',()=>{
  const plot=plotHistory([{time:0,count:0},{time:1,count:0}],0,2);
  assert.equal(plot.maximum,0);
  assert.equal(plot.path.includes('NaN'),false);
});

test('history ticks use whole local hours or midnight dates within the displayed window', () => {
  const until = new Date(2026, 10, 1, 18, 34).getTime();
  for (const days of [1, 7, 30]) {
    const since = until - days * 86400000;
    const ticks = historyTicks(since, until, days);
    assert.ok(ticks.length >= 3 && ticks.length <= 5);
    for (const tick of ticks) {
      const date = new Date(tick);
      assert.ok(tick >= since && tick <= until);
      assert.equal(date.getMinutes(), 0);
      assert.equal((days === 30 ? date.getUTCHours() : date.getHours()) % (days === 1 ? 6 : 24), 0);
    }
  }
});
test('isolated observations remain visible without drawing markers for connected points', () => {
  const plot = plotHistory([{ time: 0, count: 2 }, { time: 900000, count: 3 }, { time: 3600000, count: 4 }], 0, 3600000);
  assert.deepEqual(plot.dots.map(dot => dot.isIsolated), [false, false, true]);
});

test('pointer selection chooses an actual nearest observation, including gaps and edges', () => {
  const points = [{ time: 100, count: 1 }, { time: 200, count: 2 }, { time: 900, count: 3 }];
  assert.equal(nearestHistoryPoint([], 0), null);
  assert.equal(nearestHistoryPoint(points, 0), 0);
  assert.equal(nearestHistoryPoint(points, 190), 1);
  assert.equal(nearestHistoryPoint(points, 700), 2);
  assert.equal(nearestHistoryPoint(points, 1000), 2);
});

test('gridlines use rounded integer values and cover the observed peak', () => {
  for (const maximum of [0, 1, 3, 410, 10406]) {
    const plot = plotHistory([{ time: 0, count: maximum }], 0, 1);
    const values = plot.gridlines.map(grid => grid.value);
    assert.equal(values[0], 0);
    assert.ok(values.at(-1) >= maximum);
    assert.ok(values.length <= 5);
    assert.ok(values.every(Number.isInteger));
    assert.ok(plot.dots[0].y >= 28);
  }
  assert.deepEqual(plotHistory([{ time: 0, count: 10406 }], 0, 1).gridlines.map(grid => grid.value), [0, 3000, 6000, 9000, 12000]);
});

test('periods share the reference scale while preserving their actual peak and count positions', () => {
  const daily = plotHistory([{ time: 1, count: 300 }], 0, 2, 10406);
  const monthly = plotHistory([{ time: 1, count: 300 }, { time: 2, count: 10406 }], 0, 3, 10406);
  assert.deepEqual(daily.gridlines, monthly.gridlines);
  assert.equal(daily.dots[0].y, monthly.dots[0].y);
  assert.equal(daily.maximum, 300);
  assert.equal(monthly.maximum, 10406);
  const smallerOperator = plotHistory([{ time: 1, count: 30 }], 0, 2, 90);
  assert.ok(smallerOperator.gridlines.at(-1).value < daily.gridlines.at(-1).value);
});
