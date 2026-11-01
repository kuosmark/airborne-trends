import { ChangeDetectionStrategy, Component, computed, input, type OnDestroy, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { DAY_MS, historyPoints, type HistoryDay } from '../shared/history-chart';
import { loadHistory } from './history-client';
import { formatSnapshotAge } from './snapshot-age';
import { historyTicks } from './history-ticks';
import { nearestHistoryPoint, plotHistory } from './history-plot';

@Component({
  selector: 'app-history-chart', standalone: true, imports: [DatePipe, DecimalPipe],
  templateUrl: './history-chart.html', styleUrls: ['./chart-surface.css', './history-chart.css', './drawer-section.css'], changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryChartComponent implements OnDestroy {
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
  readonly until = signal(Date.now());
  private readonly now = signal(Date.now());
  private clock?: ReturnType<typeof setInterval>;
  readonly since = computed(() => this.until() - this.period() * DAY_MS);
  readonly ticks = computed(() => historyTicks(this.since(), this.until(), this.period()));
  readonly updatedAge = computed(() => formatSnapshotAge(this.generatedAt(), this.now()));
  readonly availableSince = computed(() => {
    const first = this.points()[0]?.time;
    return first && first - this.since() > 22.5 * 60_000 ? first : null;
  });
  readonly points = computed(() => historyPoints(this.days(), this.dimension(), this.groupId(), this.since(), this.until()));
  readonly referenceMaximum = computed(() => {
    const points = historyPoints(this.days(), this.dimension(), this.groupId(), this.until() - 30 * DAY_MS, this.until());
    return Math.max(0, ...points.map(point => point.count));
  });
  readonly plot = computed(() => plotHistory(this.points(), this.since(), this.until(), this.referenceMaximum()));
  readonly isDelayed = computed(() => !!this.generatedAt() && this.now() - Date.parse(this.generatedAt()) > 2 * 60 * 60_000);
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
  private abort?: AbortController;
  toggle(): void {
    this.isOpen.update(value => !value);
    clearInterval(this.clock);
    if (this.isOpen()) {
      this.clock = setInterval(() => { this.now.set(Date.now()); }, 60_000);
      void this.load();
    }
  }
  selectPeriod(days: number): void {
    if (this.period() === days) { return; }
    this.period.set(days);
    this.hoveredIndex.set(null);
  }
  async load(): Promise<void> {
    this.hoveredIndex.set(null);
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.isLoading.set(true);
    this.isError.set(false);
    this.now.set(Date.now());
    this.until.set(this.now());
    try {
      const result = await loadHistory(30, AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]), this.until());
      if (!abort.signal.aborted) { this.days.set(result.days); this.generatedAt.set(result.index.generatedAt); }
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
