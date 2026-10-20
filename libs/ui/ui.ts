import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  selector: 'app-ui',
  styles: ``,
  template: ` <p>ui works!</p> `,
})
export class Ui {}
