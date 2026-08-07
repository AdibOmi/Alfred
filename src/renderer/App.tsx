import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TaskPanel } from './ui/TaskPanel';
import { SearchPanel } from './ui/SearchPanel';
import { ChatPanel } from './ui/ChatPanel';
import { ProgressPanel } from './ui/ProgressPanel';
import { Header } from './ui/Header';
import { api, type Task } from './api';

const panelMotion = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4 },
};

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  useEffect(() => {
    api
      .getTasks()
      .then(({ tasks: fetched }) => setTasks(fetched))
      .finally(() => setTasksLoading(false));
  }, []);

  const handleCapture = useCallback(async (text: string) => {
    const { task } = await api.quickCaptureTask(text);
    setTasks((prev) => [...prev, task]);
  }, []);

  const handleToggleDone = useCallback(async (task: Task) => {
    const { task: updated } = await api.updateTask(task.id, { status: 'done' });
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await api.deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <main className="app-shell">
      <div className="scan-line" aria-hidden="true" />
      <Header />
      <div className="grid-shell">
        <motion.div className="panel" {...panelMotion}>
          <TaskPanel tasks={tasks} loading={tasksLoading} onCapture={handleCapture} onToggleDone={handleToggleDone} onDelete={handleDelete} />
        </motion.div>
        <motion.div className="panel" {...panelMotion} transition={{ ...panelMotion.transition, delay: 0.08 }}>
          <SearchPanel />
        </motion.div>
        <motion.div className="panel panel-large" {...panelMotion} transition={{ ...panelMotion.transition, delay: 0.16 }}>
          <ChatPanel />
        </motion.div>
        <motion.div className="panel panel-large" {...panelMotion} transition={{ ...panelMotion.transition, delay: 0.24 }}>
          <ProgressPanel />
        </motion.div>
      </div>
    </main>
  );
}
