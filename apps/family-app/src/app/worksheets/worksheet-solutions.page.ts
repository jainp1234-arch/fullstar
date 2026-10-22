import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiError, WorksheetApi, WorksheetDetail, WorksheetQuestion } from '@fullstar/core';
import {
  Button,
  EN,
  QuestionContent,
  SectionHeader,
  Skeleton,
  ToastService,
  contentValue,
  errorMessage,
} from '@fullstar/ui';
import { choicesOf, pairsOf } from '../kid/question-choices';

/**
 * P13 Solutions and weak spots (App Flow §6; Schema §11; Plan 7.2): every question with its answer
 * and explanation, so the parent can check the child's paper; then an optional checklist of the
 * worksheet's topics the child found hard. Ticks feed Areas to work on (P1). No marks entry.
 */
@Component({
  selector: 'app-worksheet-solutions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, SectionHeader, Skeleton],
  template: `
    @if (detail(); as d) {
      <ol class="questions" [attr.lang]="d.worksheet.subject === 'hindi' ? 'hi' : null">
        @for (q of d.questions; track q.position) {
          <li class="question">
            <span class="prompt">{{ promptOf(q) }}</span>
            <span class="answer"
              ><strong>{{ text.answer }}:</strong> {{ answerOf(q) }}</span
            >
            @if (explanationOf(q); as why) {
              <span class="why">{{ why }}</span>
            }
            <app-button
              variant="ghost"
              icon="flag"
              [label]="reportLabel"
              [ariaLabel]="reportLabel + ': ' + promptOf(q)"
              (pressed)="report(q)"
            />
          </li>
        }
      </ol>
      @if (topics().length) {
        <app-section-header [title]="text.weakSpots" />
        <p class="note">{{ text.weakHint }}</p>
        <div class="ticks">
          @for (topic of topics(); track topic.id) {
            <label class="tick">
              <input
                type="checkbox"
                [checked]="ticked().has(topic.id)"
                (change)="toggle(topic.id)"
              />
              <span>{{ topic.name }}</span>
            </label>
          }
        </div>
        <app-button [label]="text.saveTicks" [loading]="busy()" (pressed)="save(d)" />
      }
    } @else if (failure(); as message) {
      <p class="warning" role="alert">{{ message }}</p>
    } @else {
      <app-skeleton shape="list-card" [count]="3" />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .questions {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding-left: var(--space-5);
    }
    .question {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      font: var(--type-body);
      color: var(--color-text);
    }
    .why,
    .note {
      margin: 0;
      font: var(--type-small);
      color: var(--color-text-2);
    }
    .warning {
      margin: 0;
      font: var(--type-small);
      color: var(--color-error-700);
    }
    .ticks {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .tick {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-height: 44px;
      font: var(--type-body);
      color: var(--color-text);
    }
    .tick input {
      width: 22px;
      height: 22px;
    }
  `,
})
export class WorksheetSolutionsPage {
  protected readonly text = EN.worksheets;
  protected readonly detail = signal<WorksheetDetail | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly ticked = signal<ReadonlySet<string>>(new Set());
  protected readonly topics = computed(() => {
    const seen = new Map<string, string>();
    for (const q of this.detail()?.questions ?? []) {
      if (q.topic_id && q.topic_name) {
        seen.set(q.topic_id, q.topic_name);
      }
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  });

  private readonly api = inject(WorksheetApi);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('worksheetId') ?? '';

  constructor() {
    this.api
      .solutions(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.ticked.set(new Set(detail.weak_spots));
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  protected readonly reportLabel = EN.lessonPreview.report;

  /** P18 for this question, coming back here. */
  protected report(q: WorksheetQuestion): void {
    void this.router.navigate(['/parent/report'], {
      queryParams: { item: q.id, back: this.router.url },
    });
  }

  protected promptOf(q: WorksheetQuestion): string {
    return String((q.body as { prompt?: unknown }).prompt ?? '');
  }

  protected answerOf(q: WorksheetQuestion): string {
    const content = this.content(q);
    if (content.type === 'match') {
      return pairsOf(content)
        .map((pair) => `${pair.left} → ${pair.right}`)
        .join(', ');
    }
    return choicesOf(content).find((choice) => choice.correct)?.text ?? '';
  }

  protected explanationOf(q: WorksheetQuestion): string | null {
    return (q.solution as { explanation?: string } | null)?.explanation ?? null;
  }

  protected toggle(topicId: string): void {
    this.ticked.update((set) => {
      const next = new Set(set);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  }

  protected save(d: WorksheetDetail): void {
    this.busy.set(true);
    this.api
      .weakSpots(d.worksheet.id, [...this.ticked()])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.busy.set(false);
          this.detail.set(saved);
          this.toasts.show(this.text.ticksSaved);
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  private content(q: WorksheetQuestion): QuestionContent {
    return contentValue('question', q.question_type, q.body, q.solution) as QuestionContent;
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.failure.set(
      errorMessage(error instanceof ApiError ? error.code : 'INTERNAL_ERROR', 'parent'),
    );
  }
}
