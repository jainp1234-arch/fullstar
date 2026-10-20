import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

/** Creates a component, sets its signal inputs and renders it. */
export async function render<T>(
  type: Type<T>,
  inputs: Record<string, unknown> = {},
): Promise<ComponentFixture<T>> {
  const fixture = TestBed.createComponent(type);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  await fixture.whenStable();
  return fixture;
}

export function el(fixture: ComponentFixture<unknown>, selector: string): HTMLElement {
  const found = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);
  if (!found) {
    throw new Error(`No element matches ${selector}`);
  }
  return found;
}

export function all(fixture: ComponentFixture<unknown>, selector: string): HTMLElement[] {
  return [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(selector)];
}
