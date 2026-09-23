import { Notification } from 'electron';
import { dueReminders } from '../shared/tasks';
import { listTasks, markTaskReminded } from './taskStore';

const SWEEP_INTERVAL_MS = 30_000;

export interface ReminderScheduler {
  /** Runs a sweep immediately, e.g. right after a task's time is edited. */
  sweep: () => void;
  stop: () => void;
}

/**
 * Fires OS notifications for reminders that have come due.
 *
 * This sweeps on an interval rather than arming one timer per reminder. A
 * long-lived setTimeout is unreliable across system sleep — a laptop shut at
 * 4pm with a 5pm reminder can wake well past the deadline — and a periodic
 * sweep also picks up reminders that came due while Alfred wasn't running,
 * since dueReminders() treats anything past its time as still owed. Thirty
 * seconds of granularity is invisible on human-scale reminders.
 */
export function startReminderScheduler(onReminderClicked: (taskId: string) => void): ReminderScheduler {
  const sweep = () => {
    const due = dueReminders(listTasks(), new Date());

    for (const task of due) {
      // Stamp first: if constructing or showing the notification throws, we'd
      // rather drop one reminder than re-fire it every 30 seconds forever.
      markTaskReminded(task.id);

      if (!Notification.isSupported()) continue;

      const notification = new Notification({
        title: task.title,
        body: task.notes ?? 'Reminder from Alfred',
        silent: false,
      });
      notification.on('click', () => onReminderClicked(task.id));
      notification.show();
    }
  };

  sweep();
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);

  return {
    sweep,
    stop: () => clearInterval(timer),
  };
}
