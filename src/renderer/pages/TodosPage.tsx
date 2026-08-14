import type { Task, TaskKind } from '../api';
import { TaskPanel } from '../ui/TaskPanel';

interface TodosPageProps {
  tasks: Task[];
  loading: boolean;
  onCapture: (text: string, kind?: TaskKind) => Promise<void>;
  onToggleDone: (task: Task) => void;
  onDelete: (id: string) => void;
}

export function TodosPage({ tasks, loading, onCapture, onToggleDone, onDelete }: TodosPageProps) {
  return (
    <>
      <div className="page-header">
        <p className="eyebrow">Reminders</p>
        <h2>Todos &amp; Deadlines</h2>
      </div>
      <div className="panel">
        <TaskPanel tasks={tasks} loading={loading} onCapture={onCapture} onToggleDone={onToggleDone} onDelete={onDelete} />
      </div>
    </>
  );
}
