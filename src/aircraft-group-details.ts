import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { AircraftBreakdownComponent } from './aircraft-breakdown';
import type { AircraftGroup } from '../shared/ranking';
import { HistoryChartComponent } from './history-chart';
import { AircraftMapComponent } from './aircraft-map';

@Component({
  selector: 'app-aircraft-group-details',
  standalone: true,
  imports: [AircraftBreakdownComponent, AircraftMapComponent, HistoryChartComponent],
  templateUrl: './aircraft-group-details.html',
  styleUrl: './aircraft-group-details.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AircraftGroupDetailsComponent {
  readonly aircraft = input.required<Pick<AircraftGroup, 'count' | 'positions'>>();
  readonly breakdown = input.required<{ name: string; count: number }[]>();
  readonly breakdownLabel = input('types');
  readonly heading = computed(() => this.breakdownLabel() === 'operators' ? 'Operators' : 'Aircraft types');
  readonly groupId = input.required<string>();
  readonly groupName = input.required<string>();
  readonly isShowingAllTypes = input.required<boolean>();
  readonly typesToggled = output();
  readonly descriptions = input<{ name: string; count: number }[] | undefined>();
  readonly isShowingAllDescriptions = signal(false);
}
