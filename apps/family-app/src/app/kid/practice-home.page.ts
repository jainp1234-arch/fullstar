import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { KidApi, PracticeHome } from '@fullstar/core';
import { Button, CardState, EN, IllustrationKey, Skeleton, Tile, ToastService } from '@fullstar/ui';

interface PracticeTile {
  readonly key: string;
  readonly label: string;
  readonly illustration: IllustrationKey;
  readonly url: string;
  /** Locked: nothing to practise yet (tapping says so). */
  readonly state: CardState;
}

/**
 * K8 Practice home (App Flow §5; Schema §11 GET /family/kid/practice; Plan 7.1): English grammar,
 * Hindi grammar, Maths tables, EVS quiz and Fix my mistakes. A subject with no published
 * questions for the class shows locked and says why.
 */
@Component({
  selector: 'app-practice-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Skeleton, Tile],
  template: `
    @if (tiles(); as list) {
      <div class="tiles">
        @for (tile of list; track tile.key) {
          <app-tile
            [illustration]="tile.illustration"
            [label]="tile.label"
            [state]="tile.state"
            [attr.data-screen-link]="tile.state === 'normal' ? linkTo(tile.url) : null"
            (pressed)="open(tile)"
          />
        }
      </div>
    } @else if (failed()) {
      <div class="failed" role="alert">
        <p>{{ kid.somethingFailed }}</p>
        <app-button [label]="kid.tryAgain" (pressed)="load()" />
      </div>
    } @else {
      <app-skeleton shape="tile" [count]="5" />
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-3);
    }
    @media (min-width: 600px) {
      .tiles {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    .failed {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
      font: var(--type-body);
      color: var(--color-text-on-sky);
    }
  `,
})
export class PracticeHomePage {
  protected readonly text = EN.kid.practice;
  protected readonly kid = EN.kid;
  protected readonly home = signal<PracticeHome | null>(null);
  protected readonly failed = signal(false);

  protected readonly tiles = computed<readonly PracticeTile[] | null>(() => {
    const home = this.home();
    if (!home) {
      return null;
    }
    const has = (code: string) => (home.subjects.find((s) => s.code === code)?.questions ?? 0) > 0;
    const set = (code: string) => `/kid/practice/set/${code}`;
    return [
      {
        key: 'english',
        label: this.text.englishGrammar,
        illustration: 'subject-english',
        url: set('english'),
        state: has('english') ? 'normal' : 'locked',
      },
      {
        key: 'hindi',
        label: this.text.hindiGrammar,
        illustration: 'subject-hindi',
        url: set('hindi'),
        state: has('hindi') ? 'normal' : 'locked',
      },
      {
        key: 'tables',
        label: this.text.tables,
        illustration: 'act-tables',
        url: '/kid/practice/tables',
        state: 'normal',
      },
      {
        key: 'evs',
        label: this.text.evsQuiz,
        illustration: 'subject-evs',
        url: set('evs'),
        state: has('evs') ? 'normal' : 'locked',
      },
      {
        key: 'mistakes',
        label: home.mistakes
          ? `${this.text.mistakes} · ${this.text.mistakesCount(home.mistakes)}`
          : this.text.mistakes,
        illustration: 'act-mistakes',
        url: '/kid/practice/mistakes',
        state: 'normal',
      },
    ];
  });

  private readonly api = inject(KidApi);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.failed.set(false);
    this.api
      .practice()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (home) => this.home.set(home),
        error: () => this.failed.set(true),
      });
  }

  protected linkTo(url: string): string {
    return this.location.prepareExternalUrl(url);
  }

  protected open(tile: PracticeTile): void {
    if (tile.state !== 'normal') {
      this.toasts.show(this.text.nothingYet);
      return;
    }
    void this.router.navigateByUrl(tile.url);
  }
}
