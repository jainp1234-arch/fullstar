import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { FamilyApi } from '@fullstar/core';
import { Button, Celebration, EN } from '@fullstar/ui';

/**
 * K7 Well done (App Flow §5, Guidelines §10 shell D; Plan 6.2): the stars just earned, then Next (back to
 * the chapter or topic, ?back=) or Back to subject (K2). The stars shown are the device's count; the
 * server's total follows on the next sync. Celebrations follow the parent's setting (P14).
 */
@Component({
  selector: 'app-well-done-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Celebration],
  template: `
    <app-celebration [stars]="stars()" [animate]="animate()">
      @if (back(); as url) {
        <app-button [label]="text.next" [fullWidth]="true" (pressed)="go(url)" />
      }
      <app-button
        variant="secondary"
        [label]="text.backToSubject"
        [fullWidth]="true"
        (pressed)="go(subject())"
      />
    </app-celebration>
  `,
})
export class WellDonePage {
  protected readonly text = EN.kid.player;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly family = inject(FamilyApi);
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly stars = computed(() => {
    const stars = Number(this.query().get('stars'));
    return Number.isInteger(stars) && stars >= 0 && stars <= 3 ? stars : 1;
  });
  protected readonly back = computed(() => {
    const back = this.query().get('back');
    return back && back.startsWith('/kid/') && !back.startsWith('//') ? back : null;
  });
  /** K2 of the same subject: /kid/learn/<subject> from the K3 address. */
  protected readonly subject = computed(() => {
    const back = this.back();
    return back ? back.split('?')[0].split('/').slice(0, 4).join('/') : '/kid/learn';
  });
  protected readonly animate = computed(
    () => this.family.me()?.family.celebrations_enabled ?? true,
  );

  protected go(url: string): void {
    void this.router.navigateByUrl(url);
  }
}
