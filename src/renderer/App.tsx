import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar, type Section } from './ui/Sidebar';
import { TopBar } from './ui/TopBar';
import { ChatPanel } from './ui/ChatPanel';
import { DashboardPage } from './pages/DashboardPage';
import { CodingLogPage } from './pages/CodingLogPage';
import { TodosPage } from './pages/TodosPage';
import { FinancePage } from './pages/FinancePage';
import { GymPage } from './pages/GymPage';
import { SettingsPage } from './pages/SettingsPage';
import { api, type Task, type TaskKind } from './api';

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<Section>('dashboard');
  const [chatOpen, setChatOpen] = useState(false);

  const refreshTasks = useCallback(async () => {
    const { tasks: fetched } = await api.getTasks();
    setTasks(fetched);
  }, []);

  useEffect(() => {
    refreshTasks().finally(() => setTasksLoading(false));
  }, [refreshTasks]);

  const handleCapture = useCallback(async (text: string, kind?: TaskKind) => {
    const { task } = await api.quickCaptureTask(text, kind);
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
      <Sidebar active={activeSection} onSelect={setActiveSection} />
      <div className="main-column">
        <TopBar chatOpen={chatOpen} onToggleChat={() => setChatOpen((v) => !v)} onCapture={handleCapture} />
        <div className="page-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.18 }}
            >
              {activeSection === 'dashboard' && (
                <DashboardPage
                  tasks={tasks}
                  tasksLoading={tasksLoading}
                  onToggleDone={handleToggleDone}
                  onDelete={handleDelete}
                  onNavigate={setActiveSection}
                />
              )}
              {activeSection === 'coding-log' && <CodingLogPage />}
              {activeSection === 'todos' && (
                <TodosPage
                  tasks={tasks}
                  loading={tasksLoading}
                  onCapture={handleCapture}
                  onToggleDone={handleToggleDone}
                  onDelete={handleDelete}
                />
              )}
              {activeSection === 'finance' && <FinancePage />}
              {activeSection === 'gym' && <GymPage />}
              {activeSection === 'settings' && <SettingsPage />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} onTaskActivity={refreshTasks} />
    </main>
  );
}
