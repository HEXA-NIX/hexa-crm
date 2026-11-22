type TaskWithStatus = {
  status: string;
};

export function calculateTaskProgress(tasks: readonly TaskWithStatus[]) {
  const activeTasks = tasks.filter((task) => task.status !== "archived");
  const total = activeTasks.length;
  const completed = activeTasks.filter((task) => task.status === "done").length;

  return {
    total,
    completed,
    progress: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}
