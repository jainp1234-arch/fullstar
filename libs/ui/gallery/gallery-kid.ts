import { ChangeDetectionStrategy, Component, signal, viewChild, viewChildren } from '@angular/core';
import { AnswerButton, AnswerLetter } from '../components/answer-button';
import { Avatar, AvatarSize } from '../components/avatar';
import { Button } from '../components/button';
import { Celebration } from '../components/celebration';
import { FlagItem } from '../components/flag-item';
import { OwlLoader } from '../components/owl-loader';
import { ChildProfile, ProfilePicker } from '../components/profile-picker';
import { QuestionCard } from '../components/question-card';
import { ReadAloud } from '../components/read-aloud';
import { SectionHeader } from '../components/section-header';
import { SpeechBubble } from '../components/speech-bubble';
import { TimeIndicator } from '../components/time-indicator';
import { AVATAR_KEYS } from '../illustrations/illustrations';
import { EN } from '../strings/en';

const t = EN.dev.gallery;

interface Answer {
  readonly letter: AnswerLetter;
  readonly text: string;
}

/** Gallery section for Plan 2.2c: kid mode, the celebration and the Studio flag row. */
@Component({
  selector: 'app-gallery-kid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AnswerButton,
    Avatar,
    Button,
    Celebration,
    FlagItem,
    OwlLoader,
    ProfilePicker,
    QuestionCard,
    ReadAloud,
    SectionHeader,
    SpeechBubble,
    TimeIndicator,
  ],
  template: `
    <section class="sky" data-section="kid">
      <app-section-header [title]="t.sections.owl" surface="sky" />
      <div class="ui-stack">
        <app-speech-bubble [text]="t.owlGreeting" />
        <app-speech-bubble [text]="bubble()" />
        <app-owl-loader />
      </div>

      <app-section-header [title]="t.sections.readAloud" surface="sky" />
      <div class="row">
        <app-read-aloud
          surface="sky"
          [speaking]="speaking()"
          (pressed)="speaking.set(!speaking())"
        />
        <app-read-aloud surface="sky" [speaking]="true" />
      </div>
      <div class="times">
        <app-time-indicator [used]="15" [limit]="30" />
        <app-time-indicator [used]="25" [limit]="30" />
        <app-time-indicator [used]="34" [limit]="30" />
      </div>

      <app-section-header [title]="t.sections.picker" surface="sky" />
      <app-profile-picker [profiles]="profiles" (picked)="pickedName($event)" />
      @if (picked(); as text) {
        <p class="note" role="status">{{ text }}</p>
      }

      <app-section-header [title]="t.sections.celebration" surface="sky" />
      <app-celebration [stars]="3">
        <app-button [label]="t.nextActivity" [fullWidth]="true" />
        <app-button
          [label]="t.replay"
          variant="secondary"
          [fullWidth]="true"
          (pressed)="celebration().play()"
        />
      </app-celebration>
    </section>

    <section class="sheet" data-section="quiz">
      <app-section-header [title]="t.sections.quiz" />
      <div class="ui-stack">
        <app-read-aloud [speaking]="false" />
        <app-question-card [question]="t.question" [position]="3" [total]="10">
          @for (answer of answers; track answer.letter) {
            <app-answer-button
              [letter]="answer.letter"
              [text]="answer.text"
              [correct]="solved() && answer.letter === 'A'"
              [disabled]="solved()"
              (pressed)="choose($event)"
            />
          }
        </app-question-card>
        <app-question-card [question]="t.questionHindi" lang="hi" [position]="1" [total]="4">
          <app-answer-button letter="A" [text]="t.answerMeow" lang="hi" />
          <app-answer-button
            letter="B"
            [text]="t.answerMoo"
            lang="hi"
            [correct]="true"
            [disabled]="true"
          />
        </app-question-card>
      </div>

      <app-section-header [title]="t.sections.avatars" />
      <div class="row">
        @for (size of sizes; track size) {
          <app-avatar animal="panda" [size]="size" />
        }
        <app-avatar animal="tiger" [size]="96" [selected]="true" />
      </div>
      <div class="row avatars">
        @for (animal of animals; track animal) {
          <app-avatar [animal]="animal" [size]="64" />
        }
      </div>

      <app-section-header [title]="t.sections.flags" [count]="2" />
      <div class="ui-stack">
        <app-flag-item
          severity="critical"
          [category]="t.flagCategoryAge"
          [location]="t.flagLocationScene"
          [reason]="t.flagReasonAge"
        />
        <app-flag-item
          severity="warning"
          [category]="t.flagCategorySpelling"
          [location]="t.flagLocationQuestion"
          [reason]="t.flagReasonSpelling"
        />
      </div>
    </section>
  `,
  styles: `
    .sky {
      padding: var(--space-6) var(--space-4);
      background: var(--gradient-sky);
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
    .avatars {
      margin-top: var(--space-4);
    }
    .times {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-top: var(--space-4);
    }
    .note {
      margin: var(--space-2) 0 0;
      font: var(--type-small);
      color: var(--color-text-on-sky);
      text-align: center;
    }
  `,
})
export class GalleryKid {
  protected readonly t = t;
  protected readonly speaking = signal(false);
  protected readonly solved = signal(false);
  protected readonly bubble = signal<string>(t.owlTryAgain);
  protected readonly picked = signal<string | null>(null);
  protected readonly sizes: readonly AvatarSize[] = [40, 64, 96, 128];
  protected readonly animals = AVATAR_KEYS;
  protected readonly answers: readonly Answer[] = [
    { letter: 'A', text: t.answerCow },
    { letter: 'B', text: t.answerCat },
    { letter: 'C', text: t.answerDog },
    { letter: 'D', text: t.answerDuck },
  ];
  protected readonly profiles: readonly ChildProfile[] = [
    { id: 'c1', name: t.childAsha, avatar: 'rabbit' },
    { id: 'c2', name: t.childRavi, avatar: 'lion' },
  ];

  protected readonly celebration = viewChild.required(Celebration);
  private readonly answerButtons = viewChildren(AnswerButton);

  protected choose(letter: AnswerLetter): void {
    if (letter === 'A') {
      this.solved.set(true);
      this.bubble.set(EN.kid.correct);
      return;
    }
    this.bubble.set(EN.kid.notCorrect);
    this.answerButtons()
      .find((button) => button.letter() === letter)
      ?.shake();
  }

  protected pickedName(id: string): void {
    const child = this.profiles.find((profile) => profile.id === id);
    this.picked.set(child ? t.picked(child.name) : null);
  }
}
