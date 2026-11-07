import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

import { isDemo } from './demo-mode';

@Component({
  selector: 'app-ranking-toolbar',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './ranking-toolbar.html',
  styleUrl: './ranking-toolbar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RankingToolbarComponent {
  readonly isDemo = isDemo;
  readonly isFiltersOpen = signal(false);
  readonly activeFilterCount = input(0);
  readonly filterSummary = input('All aircraft · Any engine count');
  readonly isTypeView = input(false);
  readonly isClassFiltered = input(false);
  readonly searchQuery = input.required<string>();
  readonly matchingCount = input.required<number>();
  readonly airborneCount = input<number>();
  readonly totalCount = input.required<number>();
  readonly snapshotAge = input.required<string>();
  readonly filtersReset = output();
  readonly searchChanged = output<string>();
}
