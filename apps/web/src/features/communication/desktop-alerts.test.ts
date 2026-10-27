import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Meeting } from './comm-api';
import { alertMeeting, canAskForAlerts } from './desktop-alerts';

const shown: { title: string; options: NotificationOptions; onclick: (() => void) | null }[] = [];
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  onclick: (() => void) | null = null;
  constructor(title: string, options: NotificationOptions) {
    shown.push(this as unknown as (typeof shown)[number]);
    Object.assign(this, { title, options });
  }
  close() {}
}

const meeting = (kind: 'standard' | 'emergency'): Meeting =>
  ({
    id: 'm1',
    title: 'Zz case',
    kind,
    status: 'active',
    hostName: 'Dr. Zz',
  }) as Meeting;

let hidden = true;
beforeEach(() => {
  shown.length = 0;
  hidden = true;
  FakeNotification.permission = 'granted';
  vi.stubGlobal('Notification', FakeNotification);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('desktop meeting alerts', () => {
  it('shows an emergency that stays until clicked, and clicking joins', () => {
    const join = vi.fn();
    alertMeeting(meeting('emergency'), join);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe('🚨 Emergency meeting: Zz case');
    expect(shown[0]!.options.requireInteraction).toBe(true);
    shown[0]!.onclick!();
    expect(join).toHaveBeenCalledOnce();
  });

  it('stays quiet while the page is visible (the in-page alert shows) or alerts are off', () => {
    hidden = false;
    alertMeeting(meeting('emergency'), () => undefined);
    hidden = true;
    FakeNotification.permission = 'denied';
    alertMeeting(meeting('standard'), () => undefined);
    expect(shown).toHaveLength(0);
  });

  it('offers to turn alerts on only before the person has answered', () => {
    FakeNotification.permission = 'default';
    expect(canAskForAlerts()).toBe(true);
    FakeNotification.permission = 'denied';
    expect(canAskForAlerts()).toBe(false);
  });
});
