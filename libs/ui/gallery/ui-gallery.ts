import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActionCard } from '../components/action-card';
import { BannerCard } from '../components/banner-card';
import { Button } from '../components/button';
import { CornerTab } from '../components/corner-tab';
import { IconButton } from '../components/icon-button';
import { ListCard } from '../components/list-card';
import { NoticeCard } from '../components/notice-card';
import { ProgressBar } from '../components/progress-bar';
import { ProgressCard } from '../components/progress-card';
import { SectionHeader } from '../components/section-header';
import { StarPill } from '../components/star-pill';
import { Tile } from '../components/tile';
import { DisplayMode, DisplayModeService } from '../mode/display-mode';
import { EN } from '../strings/en';

/**
 * Dev-only UI gallery (Guidelines §18, /dev/ui): every component in every state, on the sky and
 * on white, in kid and parent sizes. Reviewed by eye and scanned by axe in the end-to-end tests.
 */
@Component({
  selector: 'app-ui-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActionCard,
    BannerCard,
    Button,
    CornerTab,
    IconButton,
    ListCard,
    NoticeCard,
    ProgressBar,
    ProgressCard,
    SectionHeader,
    StarPill,
    Tile,
  ],
  template: `
    <main class="gallery">
      <header class="sky">
        <h1 class="sky__title">{{ t.title }}</h1>
        <p class="sky__intro">{{ t.intro }}</p>
        <div class="row">
          @for (m of modes; track m) {
            <app-button
              [label]="m"
              [variant]="mode() === m ? 'primary' : 'secondary'"
              (pressed)="setMode(m)"
            />
          }
        </div>
      </header>

      <section class="sky" data-section="sky">
        <app-section-header [title]="t.sections.iconButtons" surface="sky" [count]="3" />
        <div class="row">
          <app-icon-button icon="arrow_back" [label]="EN.nav.back" surface="sky" />
          <app-icon-button icon="lock" [label]="EN.nav.parentButton" surface="sky" />
          <app-icon-button
            icon="volume_up"
            [label]="EN.a11y.readAloud"
            surface="sky"
            [filled]="true"
          />
          <app-icon-button icon="add" [label]="EN.nav.parentButton" surface="add" />
        </div>
        <app-section-header [title]="t.sections.stars" surface="sky" [linkText]="t.seeAll" />
        <div class="row">
          <app-star-pill [count]="stars()" />
          <app-button [label]="t.startLesson" (pressed)="addStars()" />
        </div>
        <app-section-header [title]="t.mySubjects" surface="sky" />
        <div class="ui-stack">
          <app-list-card
            illustration="subject-english"
            [title]="t.chapterCard"
            [subtitle]="t.chapterCardBody"
            [cornerTab]="{ text: t.chapterTab, tone: 'gold' }"
          />
          <app-list-card
            illustration="subject-maths"
            [title]="t.practiceCard"
            [subtitle]="t.practiceCardBody"
            [cornerTab]="{ text: t.classTab, tone: 'blue' }"
          />
          <app-list-card illustration="subject-evs" [title]="EN.subjects.evs" state="locked" />
          <app-list-card illustration="subject-hindi" [title]="EN.subjects.hindi" state="offline" />
        </div>
        <app-section-header [title]="t.sections.tiles" surface="sky" />
        <div class="ui-tile-grid">
          <app-tile illustration="act-lesson" [label]="EN.illustrations['act-lesson']" />
          <app-tile illustration="act-worksheet" [label]="EN.illustrations['act-worksheet']" />
          <app-tile illustration="act-readalong" [label]="t.readAlong" />
          <app-tile
            illustration="act-tables"
            [label]="EN.illustrations['act-tables']"
            state="locked"
          />
          <app-tile
            illustration="act-quiz"
            [label]="EN.illustrations['act-quiz']"
            state="offline"
          />
        </div>
      </section>

      <section class="sheet" data-section="white">
        <app-section-header [title]="t.sections.buttons" />
        <div class="ui-stack">
          <app-button [label]="t.startLesson" icon="play_arrow" />
          <app-button [label]="t.readAlong" variant="secondary" icon="volume_up" />
          <app-button [label]="t.printWorksheet" variant="ghost" icon="download" />
          <app-button [label]="t.eraseProgress" variant="danger" />
          <app-button [label]="t.startLesson" [disabled]="true" />
          <app-button [label]="t.startLesson" [loading]="true" />
          <app-button [label]="t.startLesson" [fullWidth]="true" />
        </div>
        <app-section-header [title]="t.sections.tabs" />
        <div class="row">
          <div class="tab-demo"><app-corner-tab [text]="EN.common.new" tone="gold" /></div>
          <div class="tab-demo"><app-corner-tab [text]="t.classTab" tone="blue" /></div>
          <div class="tab-demo"><app-corner-tab [text]="EN.common.done" tone="green" /></div>
        </div>
        <app-section-header [title]="t.sections.cards" [linkText]="t.seeAll" />
        <app-list-card
          illustration="act-worksheet"
          [title]="t.progressTitle"
          [subtitle]="t.progressBody"
          [chevron]="true"
        />
        <app-section-header [title]="t.sections.banner" />
        <app-banner-card
          [eyebrow]="t.bannerEyebrow"
          [body]="t.bannerBody"
          illustration="act-lesson"
        >
          <app-button [label]="t.startLesson" variant="secondary" />
        </app-banner-card>
        <app-section-header [title]="t.sections.progress" />
        <div class="ui-stack">
          <app-progress-card
            illustration="act-worksheet"
            [title]="t.progressTitle"
            [subtitle]="t.progressBody"
            [value]="3"
            [max]="10"
          />
          <app-progress-bar [value]="6" [max]="20" [label]="t.progressTitle" />
          <app-progress-bar [value]="2" [max]="4" [milestones]="4" [label]="t.progressTitle" />
          <app-progress-bar [value]="20" [max]="20" [label]="t.progressTitle" />
        </div>
        <app-section-header [title]="t.sections.notice" />
        <app-notice-card illustration="empty-books" [title]="t.noticeTitle" [body]="t.noticeBody" />
        <app-section-header [title]="t.sections.actions" />
        <div class="ui-action-grid">
          <app-action-card icon="settings" [label]="t.actionChildren" />
          <app-action-card icon="hourglass_top" [label]="t.actionTimeLimit" />
          <app-action-card icon="flag" [label]="t.actionHelp" />
          <app-action-card icon="lock" [label]="t.actionPrivacy" />
        </div>
      </section>
    </main>
  `,
  styles: `
    .gallery {
      max-width: var(--content-max-family);
      margin: 0 auto;
    }
    .sky {
      padding: var(--space-6) var(--space-4);
      background: var(--gradient-sky);
    }
    .sky__title {
      margin: 0;
      font: var(--type-display);
      color: var(--color-text-on-sky);
    }
    .sky__intro {
      margin: var(--space-2) 0 var(--space-4);
      font: var(--type-body);
      color: var(--color-text-on-sky-2);
    }
    .sheet {
      padding: var(--space-6) var(--space-4) var(--space-10);
      background: var(--color-page);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
    }
    .tab-demo {
      position: relative;
      width: 180px;
      height: var(--space-8);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      box-shadow: var(--shadow-soft);
    }
  `,
})
export class UiGallery {
  protected readonly EN = EN;
  protected readonly t = EN.dev.gallery;
  protected readonly modes: readonly DisplayMode[] = ['kid', 'parent', 'studio'];
  protected readonly stars = signal(128);

  private readonly displayMode = inject(DisplayModeService);
  protected readonly mode = this.displayMode.mode;

  protected setMode(mode: DisplayMode): void {
    this.displayMode.set(mode);
  }

  protected addStars(): void {
    this.stars.update((count) => count + 3);
  }
}
