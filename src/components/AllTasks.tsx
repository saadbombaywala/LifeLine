import React, { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc, addDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { Task } from "../types";
import { Plus, Check, Trash2, Calendar, AlertTriangle, ShieldCheck, Flame, HelpCircle, Edit } from "lucide-react";
import TaskProgressBar from "./TaskProgressBar";

interface AllTasksProps {
  user: any;
}

export default function AllTasks({ user }: AllTasksProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // New task inline modal form
  const [showAddInline, setShowAddInline] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  const [newScore, setNewScore] = useState(50);
  const [newEst, setNewEst] = useState(30);

  // Edit task inline state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editScore, setEditScore] = useState(50);
  const [editEst, setEditEst] = useState(30);

  useEffect(() => {
    if (!user) return;
    const tasksPath = `users/${user.uid}/tasks`;
    const q = query(collection(db, tasksPath), orderBy("createdAt", "desc"));
    
    const unsubscribe = onSnapshot(collection(db, tasksPath), (snapshot) => {
      const taskList: Task[] = [];
      snapshot.forEach((docSnap) => {
        taskList.push(docSnap.data() as Task);
      });
      setTasks(taskList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, tasksPath);
    });

    return () => unsubscribe();
  }, [user]);

  const changeStatus = async (taskId: string, targetStatus: any) => {
    try {
      const taskRef = doc(db, "users", user.uid, "tasks", taskId);
      await updateDoc(taskRef, { status: targetStatus });
    } catch (err) {
      console.error(err);
    }
  };

  const removeTask = async (taskId: string) => {
    if (!window.confirm("Verify: Are you sure you want to delete this task?")) return;
    try {
      const taskRef = doc(db, "users", user.uid, "tasks", taskId);
      await deleteDoc(taskRef);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateInline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDeadline) return;

    try {
      const taskId = "task_" + Date.now();
      const taskRef = doc(db, "users", user.uid, "tasks", taskId);
      await updateDoc(taskRef, {
        id: taskId,
        userId: user.uid,
        title: newTitle,
        description: newDesc,
        deadline: newDeadline,
        estimatedMinutes: Number(newEst) || 30,
        priorityScore: Number(newScore) || 50,
        status: "todo",
        source: "manual",
        createdAt: new Date().toISOString(),
      });

      // Clear
      setNewTitle("");
      setNewDesc("");
      setNewDeadline("");
      setNewScore(50);
      setNewEst(30);
      setShowAddInline(false);
    } catch (err) {
      console.error("Failed to add task manually:", err);
    }
  };

  const startEditing = (task: Task) => {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditDesc(task.description || "");
    // ensure deadline is datetime-local format if possible
    let formattedDeadline = task.deadline;
    if (formattedDeadline && formattedDeadline.includes("Z")) {
      formattedDeadline = formattedDeadline.slice(0, 16);
    }
    setEditDeadline(formattedDeadline || "");
    setEditScore(task.priorityScore);
    setEditEst(task.estimatedMinutes || 30);
  };

  const saveEdit = async (taskId: string) => {
    if (!editTitle.trim() || !editDeadline) return;
    try {
      const taskRef = doc(db, "users", user.uid, "tasks", taskId);
      await updateDoc(taskRef, {
        title: editTitle,
        description: editDesc,
        deadline: editDeadline,
        estimatedMinutes: Number(editEst) || 30,
        priorityScore: Number(editScore) || 50,
      });
      setEditingTaskId(null);
    } catch (err) {
      console.error("Failed to save edit:", err);
    }
  };

  // Classify tasks into Eisenhower quadrants:
  // Is urgent? If deadline is within next 48 hours (or missed, or today)
  // Is important? If priorityScore >= 70
  const isUrgent = (task: Task) => {
    if (task.status === "missed") return true;
    if (!task.deadline) return false;
    const now = new Date().getTime();
    const deadlineTime = new Date(task.deadline).getTime();
    const diffHours = (deadlineTime - now) / (1000 * 60 * 60);
    return diffHours <= 48; // Less than 48 hours is considered urgent here
  };

  const isImportant = (task: Task) => {
    return task.priorityScore >= 70;
  };

  const q1_UrgentImportant = tasks.filter(t => t.status !== "done" && isUrgent(t) && isImportant(t));
  const q2_ImportantNotUrgent = tasks.filter(t => t.status !== "done" && !isUrgent(t) && isImportant(t));
  const q3_UrgentNotImportant = tasks.filter(t => t.status !== "done" && isUrgent(t) && !isImportant(t));
  const q4_NotUrgentNotImportant = tasks.filter(t => t.status !== "done" && !isUrgent(t) && !isImportant(t));

  const filteredTasks = tasks.filter(t => {
    if (filterStatus === "all") return true;
    return t.status === filterStatus;
  });

  return (
    <div id="alltasks_screen" className="max-w-7xl mx-auto px-6 py-8 font-sans">
      
      {/* Title block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#2D2D2D]">Priority Matrix</h1>
          <p className="text-gray-500 text-sm mt-1">
            Tasks classified by Eisenhower's Urgency × Importance matrix to help you build focus strategies.
          </p>
        </div>
        <button
          onClick={() => setShowAddInline(!showAddInline)}
          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-3 px-5 rounded-xl shadow-sm transition-all active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" /> Add Priority Task
        </button>
      </div>

      {/* Add Inline Modal Form */}
      {showAddInline && (
        <div className="bg-[#FAF9F8] border border-[#E6E6E4] rounded-2xl p-6 mb-8 shadow-inner">
          <h3 className="text-sm font-semibold text-[#2D2D2D] mb-4">Initialize Custom Objective</h3>
          <form onSubmit={handleCreateInline} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1.5">Task Title *</label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Finish final chemistry labs"
                className="w-full bg-white border border-[#E6E6E4] rounded-xl p-3 text-xs outline-none focus:border-stone-400 transition-colors"
              />
            </div>
            
            <div>
              <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1.5 font-sans">Deadline *</label>
              <input
                type="datetime-local"
                required
                value={newDeadline}
                onChange={(e) => setNewDeadline(e.target.value)}
                className="w-full bg-white border border-[#E6E6E4] rounded-xl p-3 text-xs outline-none focus:border-stone-400 transition-colors"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1.5">Estimated duration (minutes)</label>
              <input
                type="number"
                min="5"
                value={newEst}
                onChange={(e) => setNewEst(Number(e.target.value))}
                className="w-full bg-white border border-[#E6E6E4] rounded-xl p-3 text-xs outline-none focus:border-stone-400 transition-colors"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1.5">Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Details, reference material or deliverables..."
                className="w-full bg-white border border-[#E6E6E4] rounded-xl p-3 text-xs outline-none focus:border-stone-400 transition-colors"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-1.5">Priority Importance (1-100): {newScore}</label>
              <input
                type="range"
                min="1"
                max="100"
                value={newScore}
                onChange={(e) => setNewScore(Number(e.target.value))}
                className="w-full h-1.5 bg-stone-200 rounded-lg cursor-pointer accent-indigo-600"
              />
            </div>

            <div className="md:col-span-3 flex justify-end gap-3 mt-2 border-t border-[#E6E6E4] pt-4">
              <button
                type="button"
                onClick={() => setShowAddInline(false)}
                className="px-4 py-2 text-stone-500 hover:text-stone-800 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm"
              >
                Create Task
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MATRIX Bento-grid Representation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
        
        {/* QUADRANT 1: URGENT & IMPORTANT */}
        <div className="bg-white rounded-2xl border border-[#E6E6E4] p-6 shadow-sm border-l-4 border-l-red-500">
          <div className="flex items-center justify-between mb-4 border-b border-rose-100/60 pb-2">
            <h3 className="text-sm font-semibold text-red-900 flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-red-500 animate-pulse" /> Q1: Urgent & Important
            </h3>
            <span className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded font-mono font-bold border border-red-100/70">
              {q1_UrgentImportant.length} Tasks
            </span>
          </div>
          <div className="flex flex-col gap-3 min-h-[160px]">
            {q1_UrgentImportant.length === 0 ? (
              <p className="text-stone-400 text-xs italic my-auto text-center font-sans">No immediate fire drills defined here.</p>
            ) : (
              q1_UrgentImportant.map(task => (
                <div key={task.id} className="bg-[#FAF9F8] rounded-xl p-3 border border-stone-100 flex justify-between items-start gap-4">
                  <div>
                    <h4 className="text-xs font-semibold text-[#2D2D2D]">{task.title}</h4>
                    <p className="text-[10px] text-gray-400 mt-0.5">EST: {task.estimatedMinutes}m • Priority: {task.priorityScore}</p>
                    {task.deadline && (
                      <span className="text-[9px] text-red-650 bg-red-50 px-1.5 py-0.5 rounded mt-2 inline-block font-medium border border-red-100/50">
                        Due: {new Date(task.deadline).toLocaleDateString()}
                      </span>
                    )}
                    <TaskProgressBar task={task} allTasks={tasks} />
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => changeStatus(task.id, "done")} className="p-1 rounded-lg bg-white hover:bg-emerald-50 text-emerald-700 border border-[#E6E6E4] transition" title="Mark Done">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeTask(task.id)} className="p-1 rounded-lg hover:bg-red-50 text-[#2D2D2D] hover:text-red-600 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* QUADRANT 2: IMPORTANT & NOT URGENT */}
        <div className="bg-white rounded-2xl border border-[#E6E6E4] p-6 shadow-sm border-l-4 border-l-indigo-600">
          <div className="flex items-center justify-between mb-4 border-b border-emerald-100/60 pb-2">
            <h3 className="text-sm font-semibold text-indigo-950 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-indigo-600" /> Q2: Important • Not Urgent
            </h3>
            <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-mono font-bold border border-indigo-100/50">
              {q2_ImportantNotUrgent.length} Tasks
            </span>
          </div>
          <div className="flex flex-col gap-3 min-h-[160px]">
            {q2_ImportantNotUrgent.length === 0 ? (
              <p className="text-stone-400 text-xs italic my-auto text-center font-sans">No medium term investments here.</p>
            ) : (
              q2_ImportantNotUrgent.map(task => (
                <div key={task.id} className="bg-[#FAF9F8] rounded-xl p-3 border border-stone-100 flex justify-between items-start gap-4">
                  <div>
                    <h4 className="text-xs font-semibold text-[#2D2D2D]">{task.title}</h4>
                    <p className="text-[10px] text-gray-400 mt-0.5">EST: {task.estimatedMinutes}m • Priority: {task.priorityScore}</p>
                    {task.deadline && (
                      <span className="text-[9px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded mt-2 inline-block font-medium border border-indigo-100/50">
                        Due: {new Date(task.deadline).toLocaleDateString()}
                      </span>
                    )}
                    <TaskProgressBar task={task} allTasks={tasks} />
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => changeStatus(task.id, "done")} className="p-1 rounded-lg bg-white hover:bg-emerald-50 text-emerald-700 border border-[#E6E6E4] transition" title="Mark Done">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeTask(task.id)} className="p-1 rounded-lg hover:bg-red-50 text-[#2D2D2D] hover:text-red-600 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* QUADRANT 3: URGENT & NOT IMPORTANT */}
        <div className="bg-white rounded-2xl border border-[#E6E6E4] p-6 shadow-sm border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between mb-4 border-b border-amber-100/60 pb-2">
            <h3 className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> Q3: Urgent • Not Important
            </h3>
            <span className="text-[10px] bg-amber-50 text-amber-800 px-2 py-0.5 rounded font-mono font-bold border border-amber-100/50">
              {q3_UrgentNotImportant.length} Tasks
            </span>
          </div>
          <div className="flex flex-col gap-3 min-h-[160px]">
            {q3_UrgentNotImportant.length === 0 ? (
              <p className="text-stone-400 text-xs italic my-auto text-center font-sans">No chores or delegation items here.</p>
            ) : (
              q3_UrgentNotImportant.map(task => (
                <div key={task.id} className="bg-[#FAF9F8] rounded-xl p-3 border border-stone-100 flex justify-between items-start gap-4">
                  <div>
                    <h4 className="text-xs font-semibold text-[#2D2D2D]">{task.title}</h4>
                    <p className="text-[10px] text-gray-400 mt-0.5">EST: {task.estimatedMinutes}m • Priority: {task.priorityScore}</p>
                    {task.deadline && (
                      <span className="text-[9px] text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded mt-2 inline-block font-medium border border-amber-105">
                        Due: {new Date(task.deadline).toLocaleDateString()}
                      </span>
                    )}
                    <TaskProgressBar task={task} allTasks={tasks} />
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => changeStatus(task.id, "done")} className="p-1 rounded-lg bg-white hover:bg-emerald-50 text-emerald-700 border border-[#E6E6E4] transition" title="Mark Done">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeTask(task.id)} className="p-1 rounded-lg hover:bg-red-50 text-[#2D2D2D] hover:text-red-600 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* QUADRANT 4: NOT URGENT & NOT IMPORTANT */}
        <div className="bg-white rounded-2xl border border-[#E6E6E4] p-6 shadow-sm border-l-4 border-l-gray-400">
          <div className="flex items-center justify-between mb-4 border-b border-stone-200/50 pb-2">
            <h3 className="text-sm font-semibold text-stone-700 flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-stone-550" /> Q4: Not Urgent & Not Important
            </h3>
            <span className="text-[10px] bg-stone-100 text-stone-700 px-2 py-0.5 rounded font-mono font-bold border border-stone-200/50">
              {q4_NotUrgentNotImportant.length} Tasks
            </span>
          </div>
          <div className="flex flex-col gap-3 min-h-[160px]">
            {q4_NotUrgentNotImportant.length === 0 ? (
              <p className="text-stone-400 text-xs italic my-auto text-center font-sans">Clear of eliminate tasks. Good job!</p>
            ) : (
              q4_NotUrgentNotImportant.map(task => (
                <div key={task.id} className="bg-[#FAF9F8] rounded-xl p-3 border border-stone-100 flex justify-between items-start gap-4">
                  <div>
                    <h4 className="text-xs font-semibold text-[#2D2D2D]">{task.title}</h4>
                    <p className="text-[10px] text-gray-400 mt-0.5">EST: {task.estimatedMinutes}m • Priority: {task.priorityScore}</p>
                    {task.deadline && (
                      <span className="text-[9px] text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded mt-2 inline-block font-medium">
                        Due: {new Date(task.deadline).toLocaleDateString()}
                      </span>
                    )}
                    <TaskProgressBar task={task} allTasks={tasks} />
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => changeStatus(task.id, "done")} className="p-1 rounded-lg bg-white hover:bg-emerald-50 text-emerald-700 border border-[#E6E6E4] transition" title="Mark Done">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeTask(task.id)} className="p-1 rounded-lg hover:bg-red-50 text-[#2D2D2D] hover:text-red-600 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* DETAILED FLAT TABLE WITH FILTERING STYLES */}
      <div className="bg-white rounded-2xl border border-[#E6E6E4] p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h2 className="text-lg font-semibold text-[#2D2D2D] font-sans">Exhaustive Directory</h2>
          
          <div className="flex flex-wrap items-center gap-1.5">
            {["all", "todo", "in_progress", "done", "missed"].map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`text-[11px] font-sans font-medium px-3 py-1.5 rounded-lg border transition-all ${
                  filterStatus === status
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-[#FAFAFA] border-[#E6E6E4] text-[#2D2D2D] hover:bg-stone-55"
                }`}
              >
                {status.toUpperCase().replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        {filteredTasks.length === 0 ? (
          <p className="text-stone-400 text-xs py-8 text-center font-sans">No tasks matching the selected filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-stone-100 text-[10px] text-stone-400 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-2">Task</th>
                  <th className="py-3 px-2">Deadline</th>
                  <th className="py-3 px-2">Est Duration</th>
                  <th className="py-3 px-2">Importance</th>
                  <th className="py-3 px-2">Status</th>
                  <th className="py-3 px-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 font-sans text-stone-700">
                {filteredTasks.map((t) => (
                  editingTaskId === t.id ? (
                    <tr key={t.id} className="bg-stone-50">
                      <td className="py-3 px-2" colSpan={6}>
                        <div className="flex flex-col gap-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              placeholder="Title"
                              className="col-span-2 bg-white border border-[#E6E6E4] rounded-lg p-2 text-xs"
                            />
                            <input
                              type="datetime-local"
                              value={editDeadline}
                              onChange={(e) => setEditDeadline(e.target.value)}
                              className="bg-white border border-[#E6E6E4] rounded-lg p-2 text-xs"
                            />
                            <input
                              type="number"
                              value={editEst}
                              onChange={(e) => setEditEst(Number(e.target.value))}
                              placeholder="Mins"
                              className="bg-white border border-[#E6E6E4] rounded-lg p-2 text-xs"
                            />
                            <input
                              type="text"
                              value={editDesc}
                              onChange={(e) => setEditDesc(e.target.value)}
                              placeholder="Description"
                              className="col-span-2 bg-white border border-[#E6E6E4] rounded-lg p-2 text-xs"
                            />
                            <div className="flex items-center gap-2 col-span-2">
                              <span className="text-[10px] font-semibold text-stone-500">Priority: {editScore}</span>
                              <input
                                type="range"
                                min="1"
                                max="100"
                                value={editScore}
                                onChange={(e) => setEditScore(Number(e.target.value))}
                                className="w-full h-1.5 accent-indigo-600"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setEditingTaskId(null)} className="px-3 py-1.5 text-xs text-stone-600 hover:text-stone-800">Cancel</button>
                            <button onClick={() => saveEdit(t.id)} className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Save</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                  <tr key={t.id} className="hover:bg-stone-50/50 transition-colors">
                    <td className="py-3.5 px-2">
                       <span className="font-semibold text-[#2D2D2D]">{t.title}</span>
                      {t.description && <div className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{t.description}</div>}
                      <TaskProgressBar task={t} allTasks={tasks} />
                    </td>
                    <td className="py-3.5 px-2 font-medium font-sans">
                      {t.deadline ? new Date(t.deadline).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—"}
                    </td>
                    <td className="py-3.5 px-2">{t.estimatedMinutes} mins</td>
                    <td className="py-3.5 px-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 bg-stone-100 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-indigo-600 h-full" style={{ width: `${t.priorityScore}%` }} />
                        </div>
                        <span className="font-mono text-[10px] font-bold text-gray-500">{t.priorityScore}</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                        t.status === "done" ? "bg-indigo-50 text-indigo-750" :
                        t.status === "in_progress" ? "bg-amber-50 text-amber-850" :
                        t.status === "missed" ? "bg-red-50 text-red-700 animate-pulse" :
                        "bg-stone-100 text-stone-600"
                      }`}>
                        {t.status.toUpperCase().replace("_", " ")}
                      </span>
                    </td>
                    <td className="py-3.5 px-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => startEditing(t)}
                          className="p-1 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-700 transition"
                          title="Edit Task"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        {t.status !== "done" && (
                          <button
                            onClick={() => changeStatus(t.id, "done")}
                            className="bg-indigo-50 text-indigo-800 p-1 px-2 rounded-xl border border-indigo-100 hover:bg-slate-200 transition-colors text-[10px] font-semibold font-sans"
                          >
                            Mark Done
                          </button>
                        )}
                        {t.status === "todo" && (
                          <button
                            onClick={() => changeStatus(t.id, "in_progress")}
                            className="bg-stone-50 text-[#2D2D2D] p-1 px-2 border border-[#E6E6E4] rounded-xl hover:bg-stone-100 transition-colors text-[10px] font-semibold font-sans"
                          >
                            Start
                          </button>
                        )}
                        <button
                          onClick={() => removeTask(t.id)}
                          className="p-1 hover:bg-red-50 rounded text-stone-400 hover:text-red-650 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
