import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { AircraftPosition } from '../shared/ranking';
import { worldOutline } from './world-outline';
import { projectAircraft } from './aircraft-map-projection';

@Component({
  selector: 'app-aircraft-map',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './aircraft-map.html',
  styleUrls: ['./drawer-section.css', './chart-surface.css', './aircraft-map.css'],
})
export class AircraftMapComponent {
  readonly worldOutline = worldOutline;
  readonly isOpen = signal(true);
  readonly positions = input.required<AircraftPosition[]>();
  readonly count = input.required<number>();
  readonly selectedId = signal<string | null>(null);
  readonly hoveredId = signal<string | null>(null);
  readonly focusedId = signal<string | null>(null);
  readonly points = computed(() => {
    const points = this.positions().flatMap(aircraft => {
      const position = projectAircraft(aircraft.latitude, aircraft.longitude);
      return position ? [{ aircraft, x: position[0], y: position[1] }] : [];
    });
    return points.sort((a, b) => {
      const callsignOrder = a.aircraft.callsign.localeCompare(b.aircraft.callsign, 'en');
      return callsignOrder || a.aircraft.id.localeCompare(b.aircraft.id, 'en');
    });
  });
  readonly focusedAircraftId = computed(() => {
    const points = this.points();
    const focusedId = this.focusedId();
    return points.find(point => point.aircraft.id === focusedId)?.aircraft.id ?? points[0]?.aircraft.id;
  });
  readonly selectedAircraft = computed(() =>
    this.points().find(point => point.aircraft.id === this.selectedId())?.aircraft);
  readonly hoveredAircraft = computed(() =>
    this.points().find(point => point.aircraft.id === this.hoveredId())?.aircraft);

  selectAircraft(id: string | null): void {
    if (id === null) { return; }
    this.selectedId.set(id);
    this.focusedId.set(id);
  }

  navigateAircraft(event: KeyboardEvent, index: number): void {
    const isPrevious = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const isNext = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    if (!isPrevious && !isNext) { return; }
    event.preventDefault();
    const direction = isPrevious ? -1 : 1;
    const aircraftCount = this.points().length;
    const nextIndex = (index + direction + aircraftCount) % aircraftCount;
    const marker = event.currentTarget as SVGElement;
    marker.ownerSVGElement?.querySelectorAll<SVGElement>('.aircraft-dot')[nextIndex]?.focus();
  }

  nearestAircraftId(event: MouseEvent): string | null {
    const matrix = (event.currentTarget as SVGSVGElement).getScreenCTM();
    if (!matrix) { return null; }
    let nearestId: string | null = null;
    const hitRadiusPx = 12;
    let shortestDistance = hitRadiusPx;
    for (const point of this.points()) {
      const screenX = matrix.a * point.x + matrix.c * point.y + matrix.e;
      const screenY = matrix.b * point.x + matrix.d * point.y + matrix.f;
      const distance = Math.hypot(screenX - event.clientX, screenY - event.clientY);
      if (distance < shortestDistance) {
        nearestId = point.aircraft.id;
        shortestDistance = distance;
      }
    }
    return nearestId;
  }
}
