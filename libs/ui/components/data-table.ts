import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { Button } from './button';

export interface DataColumn<T> {
  /** Unique within the table. */
  readonly key: string;
  readonly header: string;
  readonly cell: (row: T) => string;
  readonly align?: 'start' | 'end';
}

/** One button per row, e.g. "Change" (Studio S13). */
export interface DataRowAction<T> {
  /** Column header for screen readers. */
  readonly header: string;
  /** Button label for the row; include the row name so each button is distinct. */
  readonly label: (row: T) => string;
}

/** app-data-table (Guidelines §11): parent and Studio only. Angular Material table, restyled. */
@Component({
  selector: 'app-data-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, MatTableModule],
  template: `
    <table mat-table class="table" [dataSource]="rows()" [trackBy]="trackRow">
      <caption class="ui-visually-hidden">
        {{
          caption()
        }}
      </caption>
      @for (column of columns(); track column.key) {
        <ng-container [matColumnDef]="column.key">
          <th mat-header-cell *matHeaderCellDef scope="col" [class.end]="column.align === 'end'">
            {{ column.header }}
          </th>
          <td mat-cell *matCellDef="let row" [class.end]="column.align === 'end'">
            {{ column.cell(row) }}
          </td>
        </ng-container>
      }
      @if (action(); as act) {
        <ng-container matColumnDef="__action">
          <th mat-header-cell *matHeaderCellDef scope="col">
            <span class="ui-visually-hidden">{{ act.header }}</span>
          </th>
          <td mat-cell *matCellDef="let row" class="end">
            <app-button variant="ghost" [label]="act.label(row)" (pressed)="rowAction.emit(row)" />
          </td>
        </ng-container>
      }
      <tr mat-header-row *matHeaderRowDef="columnKeys()"></tr>
      <tr mat-row *matRowDef="let row; columns: columnKeys()"></tr>
    </table>
  `,
  styles: `
    :host {
      display: block;
      overflow-x: auto;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      background: transparent;
    }
    .mat-mdc-header-row,
    .mat-mdc-row {
      height: 52px;
    }
    .mat-mdc-header-cell {
      font: var(--type-small);
      color: var(--color-text-muted);
      text-transform: none;
    }
    .mat-mdc-cell {
      font: var(--type-body);
      color: var(--color-text);
    }
    .mat-mdc-header-cell,
    .mat-mdc-cell {
      padding: 0 var(--space-4);
      border-bottom: 1px solid var(--color-border);
      text-align: left;
    }
    .mat-mdc-row:last-child .mat-mdc-cell {
      border-bottom: 0;
    }
    .mat-mdc-header-cell.end,
    .mat-mdc-cell.end {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    @media (hover: hover) {
      .mat-mdc-row:hover {
        background: var(--color-primary-100);
      }
    }
  `,
})
export class DataTable<T> {
  readonly columns = input.required<readonly DataColumn<T>[]>();
  readonly rows = input.required<readonly T[]>();
  /** Read by screen readers; not shown. */
  readonly caption = input.required<string>();
  readonly rowKey = input<(row: T) => unknown>((row) => row);
  readonly action = input<DataRowAction<T> | null>(null);
  readonly rowAction = output<T>();

  protected readonly columnKeys = computed(() => {
    const keys = this.columns().map((column) => column.key);
    return this.action() ? [...keys, '__action'] : keys;
  });
  protected readonly trackRow = (_: number, row: T): unknown => this.rowKey()(row);
}
