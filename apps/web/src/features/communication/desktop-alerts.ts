/**
 * System (desktop) notifications for meeting invitations, so a doctor whose HospitalOS tab
 * is in the background or minimised still sees an emergency call. Only the meeting title and
 * who called it are shown, never patient details. Everything here silently does nothing
 * where the browser has no notifications or the person said no.
 */
import type { Meeting } from './comm-api';

const supported = () => typeof window !== 'undefined' && 'Notification' in window;

/** True while the browser could still be asked (the person hasn't answered yet). */
export function canAskForAlerts(): boolean {
  return supported() && Notification.permission === 'default';
}

/** Asks once; must be called from a click. Resolves to whether alerts are allowed. */
export async function askForAlerts(): Promise<boolean> {
  if (!supported()) return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Shows a system notification for a meeting invitation when the page isn't visible.
 * Emergencies stay on screen until clicked or closed. Clicking brings the tab forward
 * and joins.
 */
export function alertMeeting(m: Meeting, onJoin: () => void): void {
  if (!supported() || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const emergency = m.kind === 'emergency';
    const n = new Notification(emergency ? `🚨 Emergency meeting: ${m.title}` : `📹 ${m.title}`, {
      body:
        m.status === 'scheduled'
          ? `${m.hostName}'s meeting is starting. Click to join.`
          : `${m.hostName} is calling you. Click to join.`,
      tag: `meeting-${m.id}`,
      requireInteraction: emergency,
    });
    n.onclick = () => {
      window.focus();
      n.close();
      onJoin();
    };
  } catch {
    // Some browsers only allow notifications from a service worker; the in-page alert remains.
  }
}
