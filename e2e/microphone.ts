import { Page } from '@playwright/test';

/** A microphone and MediaRecorder that record a few bytes, or a refused microphone. */
export async function fakeMicrophone(page: Page, refused = false): Promise<void> {
  await page.addInitScript((deny: boolean) => {
    navigator.mediaDevices.getUserMedia = async () => {
      if (deny) {
        throw new DOMException('Permission denied', 'NotAllowedError');
      }
      return new MediaStream();
    };
    class FakeRecorder {
      static isTypeSupported(type: string): boolean {
        return type.startsWith('audio/webm');
      }
      readonly mimeType = 'audio/webm;codecs=opus';
      state: 'inactive' | 'recording' = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start(): void {
        this.state = 'recording';
      }
      stop(): void {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([new Uint8Array([26, 69, 223, 163])]) });
        this.onstop?.();
      }
    }
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  }, refused);
}
