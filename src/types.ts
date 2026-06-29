export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  timezone: string;
  workingHoursStart: string; // HH:MM
  workingHoursEnd: string; // HH:MM
  createdAt: string;
}

export type TaskStatus = "todo" | "in_progress" | "done" | "missed";
export type TaskSource = "manual" | "voice" | "photo" | "email" | "google_tasks";

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string;
  deadline: string; // ISO DateTime
  estimatedMinutes: number;
  priorityScore: number; // 1-100 or higher
  status: TaskStatus;
  parentTaskId?: string | null;
  source: TaskSource;
  externalId?: string;
  createdAt: string; // ISO DateTime
}

export interface PlanLog {
  id: string;
  userId: string;
  action: string;
  reason: string;
  createdAt: string; // ISO DateTime
}

export interface AgentActivity {
  id: string;
  action: string;
  reason: string;
  createdAt: string;
}
