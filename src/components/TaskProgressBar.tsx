import React from 'react';
import { Task } from '../types';

interface TaskProgressBarProps {
  task: Task;
  allTasks: Task[];
}

export default function TaskProgressBar({ task, allTasks }: TaskProgressBarProps) {
  const subtasks = allTasks.filter((t) => t.parentTaskId === task.id);
  if (subtasks.length === 0) return null;

  const completed = subtasks.filter((t) => t.status === "done").length;
  const percent = Math.round((completed / subtasks.length) * 100);

  return (
    <div className="mt-2.5 max-w-[200px] w-full">
      <div className="flex justify-between text-[10px] text-stone-500 mb-1 font-sans">
        <span>Sub-tasks progress ({completed}/{subtasks.length})</span>
        <span className="font-mono">{percent}%</span>
      </div>
      <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
