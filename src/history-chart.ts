import { ChangeDetectionStrategy, Component, computed, input, type OnDestroy, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HOUR_MS, SAMPLE_MS, summarizeHistoryDay, summaryPoints, type HistoryYear, type SummaryPoint } from '../shared/history-summary';
import { DAY_MS, historyPoints, type HistoryDay } from '../shared/history-chart';
import { loadHistory, loadHistoryYear } from './history-client';
import { formatSnapshotAge } from './snapshot-age';
import { historyTicks } from './history-ticks';
import { nearestHistoryPoint, plotHistory } from './history-plot';

import { isDemo } from './demo-mode';

@Component({
  selector: 'app-history-chart', standalone: true, imports: [DatePipe, DecimalPipe],
  templateUrl: './history-chart.html', styleUrls: ['./chart-surface.css', './history-chart.css', './drawer-section.css'], changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryChartComponent implements OnDestroy {
  readonly isDemo = isDemo;
  readonly dimension = input<'total' | 'operators' | 'aircraftTypes'>('total');
  readonly groupId = input('');
  readonly name = input('All aircraft');
  readonly isInDrawer = input(false);
  readonly isOpen = signal(false);
  readonly period = signal(1);
  readonly timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly isLoading = signal(false);
  readonly isError = signal(false);
  readonly days = signal<HistoryDay[]>([]);
  readonly generatedAt = signal('');
  readonly year = signal<HistoryYear | null>(null);
  readonly isYearError = signal(false);
  readonly isYearLoading = signal(false);
  readonly isActiveLoading = computed(() => !this.activeGeneratedAt() && (this.period() === 365 ? this.isYearLoading() : this.isLoading()));
  readonly isRefreshError = computed(() => this.period() === 365 ? this.isYearError() : this.isError());
  readonly isActiveError = computed(() => !this.activeGeneratedAt() && this.isRefreshError());
  private readonly recentUntil = signal(Date.now());
  private readonly yearUntil = signal(Date.now());
  readonly until = computed(() => this.period() === 365 ? this.yearUntil() : this.recentUntil());
  private readonly now = signal(Date.now());
  private clock?: ReturnType<typeof setInterval>;
  readonly since = computed(() => this.period() >= 30
    ? Math.floor(this.until() / DAY_MS) * DAY_MS - (this.period() - 1) * DAY_MS
    : this.period() === 7 ? Math.floor(this.until() / HOUR_MS) * HOUR_MS - 167 * HOUR_MS
    : this.until() - DAY_MS);
  readonly interval = computed(() => this.period() === 1 ? SAMPLE_MS : this.period() === 7 ? HOUR_MS : DAY_MS);
  readonly resolution = computed(() => this.period() === 1 ? 'Recorded every 15 minutes' : this.period() === 7 ? 'Hourly averages' : 'Daily averages · UTC');
  readonly dateTimezone = computed(() => this.period() >= 30 ? 'UTC' : undefined);
  readonly rawPoints = computed(() => historyPoints(this.days(), this.dimension(), this.groupId(), this.since(), this.until()));
  readonly summaries = computed(() => this.period() === 1 ? [] : this.period() === 365 && this.year() ? (this.year()?.daily ?? []).filter(bucket => bucket.time >= this.since()) : this.days().flatMap(day => {
    const cached = this.period() === 7 ? day.summaries?.hourly : day.summaries?.daily;
    return cached ?? summarizeHistoryDay(day, this.interval(), Math.min(this.until(), Date.parse(this.generatedAt()) || this.until()));
  }).filter(bucket => bucket.time >= this.since() && bucket.time < this.until()));
  readonly hasCoverageNotice = computed(() => this.summaries().some(bucket => !bucket.isCovered || bucket.samples < bucket.expected || bucket.isPartial));
  readonly ticks = computed(() => historyTicks(this.since(), this.until(), this.period()));
  readonly activeGeneratedAt = computed(() => this.period() === 365 ? (this.year()?.generatedAt ?? '') : this.generatedAt());
  readonly updatedAge = computed(() => formatSnapshotAge(this.activeGeneratedAt(), this.now()));
  readonly availableSince = computed(() => {
    const first = this.days().flatMap(day => day.times).sort()[0];
    const time = this.period() === 365 && this.year()?.daily.length ? this.year()?.daily[0].time : first ? Date.parse(first) : null;
    return time && time > this.since() ? time : null;
  });
  readonly points = computed<SummaryPoint[]>(() => this.period() === 1 ? this.rawPoints()
    : summaryPoints(this.summaries(), this.dimension(), this.groupId()));
  readonly referenceMaximum = computed(() => {
    const points = historyPoints(this.days(), this.dimension(), this.groupId(), this.until() - 30 * DAY_MS, this.until());
    const daily = summaryPoints(this.year()?.daily ?? [], this.dimension(), this.groupId());
    return Math.max(0, ...points.map(point => point.count), ...daily.map(point => point.count));
  });
  readonly plot = computed(() => plotHistory(this.points(), this.since(), this.until(), this.referenceMaximum(), this.interval()));
  readonly isDelayed = computed(() => !isDemo && !!this.activeGeneratedAt() && this.now() - Date.parse(this.activeGeneratedAt()) > 2 * 60 * 60_000);
  readonly hoveredIndex = signal<number | null>(null);
  readonly hoveredPoint = computed(() => {
    const index = this.hoveredIndex();
    if (index === null || index >= this.points().length) { return null; }
    const point = this.points()[index];
    const dot = this.plot().dots[index];
    return { ...point, left: dot.x / 704 * 100, top: Math.max(0, dot.y / 210 * 180 - 64) };
  });
  readonly mobileTicks = computed(() => {
    const ticks = this.ticks();
    return [ticks[0], ticks[Math.floor((ticks.length - 1) / 2)], ticks[ticks.length - 1]];
  });
  selectObservation(event: MouseEvent): void {
    const canvas = event.currentTarget as SVGSVGElement;
    const bounds = canvas.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const time = this.since() + fraction * (this.until() - this.since());
    this.hoveredIndex.set(nearestHistoryPoint(this.points(), time));
  }
  selectWithKeyboard(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) { return; }
    event.preventDefault();
    const last = this.points().length - 1;
    if (last < 0 || event.key === 'Escape') { this.hoveredIndex.set(null); return; }
    const current = this.hoveredIndex() ?? (event.key === 'ArrowLeft' ? last + 1 : -1);
    this.hoveredIndex.set(event.key === 'Home' ? 0 : event.key === 'End' ? last
      : Math.max(0, Math.min(last, current + (event.key === 'ArrowLeft' ? -1 : 1))));
  }
  private abort?: AbortController;
  private lastLoadStartedAt = 0;
  toggle(): void {
    this.isOpen.update(value => !value);
    clearInterval(this.clock);
    if (this.isOpen()) {
      this.clock = setInterval(() => { this.now.set(Date.now()); }, 60_000);
      this.now.set(Date.now());
      if (!this.isLoading() && !this.isYearLoading() &&
          (!this.activeGeneratedAt() || this.isRefreshError() || this.now() - this.lastLoadStartedAt >= HOUR_MS)) {
        void this.load();
      }
    }
  }
  selectPeriod(days: number): void {
    if (this.period() === days) { return; }
    this.period.set(days);
    if (days === 365 && !this.year() && !this.isLoading() && !this.isYearLoading()) { void this.load(); }
    this.hoveredIndex.set(null);
  }
  async load(): Promise<void> {
    this.hoveredIndex.set(null);
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.isLoading.set(true);
    this.isError.set(false);
    this.isYearLoading.set(true);
    this.isYearError.set(false);
    this.now.set(Date.now());
    this.lastLoadStartedAt = this.now();
    const requestUntil = this.now();
    try {
      const requestSignal = AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]);
      void loadHistoryYear(requestSignal).catch(() => null).then(year => {
        if (abort.signal.aborted) { return; }
        if (year) {
          this.year.set(year);
          this.yearUntil.set(isDemo ? Date.parse(year.generatedAt) : requestUntil);
        }
        this.isYearError.set(year === null);
        this.isYearLoading.set(false);
      });
      const result = await loadHistory(30, requestSignal, isDemo ? null : requestUntil);
      if (!abort.signal.aborted) {
        this.recentUntil.set(isDemo ? Date.parse(result.index.generatedAt) : requestUntil);
        this.days.set(result.days);
        this.generatedAt.set(result.index.generatedAt);
      }
    } catch {
      if (!abort.signal.aborted) { this.isError.set(true); }
    } finally {
      if (!abort.signal.aborted) { this.isLoading.set(false); }
    }
  }
  ngOnDestroy(): void {
    clearInterval(this.clock);
    this.abort?.abort();
  }
}
