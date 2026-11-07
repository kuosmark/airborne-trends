import type { OnDestroy, OnInit } from '@angular/core';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { Snapshot } from '../shared/ranking';
import { isSnapshotStale } from '../shared/ranking';
import { createRankingClient } from './ranking-client';
import { startVisiblePolling } from './visible-polling';
import { formatSnapshotAge } from './snapshot-age';
import { HistoryChartComponent } from './history-chart';
import { RankingBoardComponent } from './ranking-board';

import { isDemo } from './demo-mode';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DatePipe, RankingBoardComponent, HistoryChartComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {
  readonly isDemo = isDemo;
  private readonly abort = new AbortController();
  private readonly fetchRanking = createRankingClient();
  private stopPolling?: () => void;

  readonly snapshot = signal<Snapshot | null>(null);
  private readonly now = signal(Date.now());
  readonly snapshotAge = computed(() => {
    const snapshot = this.snapshot();
    return snapshot ? formatSnapshotAge(snapshot.updatedAt, this.now()) : '';
  });
  readonly isRankingStale = computed(() => {
    const snapshot = this.snapshot();
    return snapshot && !isDemo ? isSnapshotStale(snapshot, this.now()) : false;
  });
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.stopPolling = startVisiblePolling(document, () => this.loadRanking());
  }

  private async loadRanking(): Promise<void> {
    this.now.set(Date.now());
    try {
      const snapshot = await this.fetchRanking(AbortSignal.any([this.abort.signal, AbortSignal.timeout(10_000)]));
      if (this.abort.signal.aborted) { return; }
      this.error.set(null);
      this.snapshot.set(snapshot);
    } catch {
      if (!this.abort.signal.aborted) {
        this.error.set('The ranking is temporarily unavailable. Retrying automatically.');
      }
    }
  }

  ngOnDestroy(): void {
    this.stopPolling?.();
    this.abort.abort();
  }
}
