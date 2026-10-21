import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiError, StaffMember, StudioApi } from '@fullstar/core';
import {
  Button,
  DataColumn,
  DataRowAction,
  DataTable,
  DialogService,
  EN,
  EmptyState,
  Skeleton,
  ToastService,
  errorMessage,
} from '@fullstar/ui';
import { StaffDialog, StaffDialogData } from './staff-dialog';

const ADDED = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * S13 Staff (App Flow §7, Schema §11 /studio/staff, super admin only): everyone with Studio
 * access, their role and whether they can sign in; add a staff member or change one.
 */
@Component({
  selector: 'app-staff-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, DataTable, EmptyState, Skeleton],
  template: `
    <p class="intro">{{ text.intro }}</p>
    <div class="toolbar">
      <app-button icon="add" [label]="text.add" (pressed)="add()" />
    </div>
    @if (staff(); as rows) {
      @if (rows.length) {
        <app-data-table
          [caption]="title"
          [columns]="columns()"
          [rows]="rows"
          [rowKey]="rowKey"
          [action]="action"
          (rowAction)="change($event)"
        />
      } @else {
        <app-empty-state [title]="text.empty" />
      }
    } @else if (failure(); as message) {
      <div class="error" role="alert">
        <span>{{ message }}</span>
        <app-button variant="ghost" [label]="tryAgain" (pressed)="load()" />
      </div>
    } @else {
      <app-skeleton shape="text" [count]="4" />
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .intro {
      margin: 0 0 var(--space-4);
      font: var(--type-body);
      color: var(--color-text-2);
    }
    .toolbar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: var(--space-4);
    }
    .error {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--color-error-100);
      color: var(--color-error-700);
      font: var(--type-body);
    }
  `,
})
export class StaffPage {
  protected readonly text = EN.studio.staff;
  protected readonly title = EN.screens.S13;
  protected readonly tryAgain = EN.studio.dashboard.tryAgain;
  protected readonly staff = signal<readonly StaffMember[] | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly rowKey = (row: StaffMember): string => row.id;
  protected readonly action: DataRowAction<StaffMember> = {
    header: this.text.columns.change,
    label: (row) => this.text.editTitle(row.display_name),
  };

  private readonly studio = inject(StudioApi);
  private readonly dialogs = inject(DialogService);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly columns = computed<readonly DataColumn<StaffMember>[]>(() => {
    const meId = this.studio.me()?.id;
    const columns = this.text.columns;
    return [
      {
        key: 'name',
        header: columns.name,
        cell: (row) =>
          row.id === meId ? `${row.display_name} (${this.text.you})` : row.display_name,
      },
      { key: 'role', header: columns.role, cell: (row) => EN.auth.roles[row.role] },
      {
        key: 'status',
        header: columns.status,
        cell: (row) => (row.active ? this.text.statusOn : this.text.off),
      },
      {
        key: 'since',
        header: columns.since,
        cell: (row) => ADDED.format(new Date(row.created_at)),
      },
    ];
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.failure.set(null);
    this.studio
      .staff()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.staff.set(rows),
        error: (error: unknown) =>
          this.failure.set(
            `${this.text.loadFailed} ${errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'studio')}`,
          ),
      });
  }

  protected add(): void {
    this.openDialog({ meId: this.studio.me()?.id ?? '' }, (saved) =>
      this.toasts.show(this.text.added(saved.display_name)),
    );
  }

  protected change(member: StaffMember): void {
    this.openDialog({ member, meId: this.studio.me()?.id ?? '' }, () =>
      this.toasts.show(this.text.saved),
    );
  }

  private openDialog(data: StaffDialogData, done: (saved: StaffMember) => void): void {
    this.dialogs
      .open<StaffDialog, StaffDialogData, StaffMember>(StaffDialog, data)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((saved) => {
        if (!saved) {
          return;
        }
        const rows = this.staff() ?? [];
        const known = rows.some((row) => row.id === saved.id);
        this.staff.set(
          known ? rows.map((row) => (row.id === saved.id ? saved : row)) : [...rows, saved],
        );
        done(saved);
      });
  }
}
