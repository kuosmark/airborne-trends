import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';

@Component({
  selector: 'app-aircraft-breakdown',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './aircraft-breakdown.html',
  styleUrls: ['./drawer-section.css', './aircraft-breakdown.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AircraftBreakdownComponent {
  readonly count = input.required<number>();
  readonly heading = input.required<string>();
  readonly breakdown = input.required<{ name: string; count: number }[]>();
  readonly breakdownLabel = input.required<string>();
  readonly groupId = input.required<string>();
  readonly groupName = input.required<string>();
  readonly isShowingAllTypes = input.required<boolean>();
  readonly typesToggled = output();
  readonly collapsedTypeLimit = 5;
}
