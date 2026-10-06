import { Notification } from 'electron';
import { dueReminders } from '../shared/tasks';
import { listTasks, markTaskReminded, refreshTasks } from './taskStore';

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
 *
 * Each sweep also pulls the task list from the server, so tasks added from
 * another device (or by the server) show up without reopening the panel.
 */
export function startReminderScheduler(onReminderClicked: (taskId: string) => void): ReminderScheduler {
  let running = false;

  const announce = () => {
    for (const task of dueReminders(listTasks(), new Date())) {
      // Stamp first: if constructing or showing the notification throws, we'd
      // rather drop one reminder than re-fire it every 30 seconds forever.
      void markTaskReminded(task.id);

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

  const sweep = () => {
    if (running) return;
    running = true;
    refreshTasks()
      .then(announce)
      .finally(() => {
        running = false;
      });
  };

  sweep();
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);

  return {
    sweep,
    stop: () => clearInterval(timer),
  };
}
