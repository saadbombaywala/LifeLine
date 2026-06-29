import React, { useEffect, useState, useRef } from "react";
import { collection, onSnapshot, query, orderBy, limit, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { Task, PlanLog } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { Send, Sparkles, Calendar, Clock, CheckCircle2, History, Trash2, ArrowRight, User, Settings, Info } from "lucide-react";
import TaskProgressBar from "./TaskProgressBar";

interface DashboardProps {
  user: any;
  googleAccessToken: string | null;
}

export default function Dashboard({ user, googleAccessToken }: DashboardProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [planLogs, setPlanLogs] = useState<PlanLog[]>([]);
  
  // Chat state
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<Array<{ id: string; role: "user" | "model"; text: string }>>([
    {
      id: "welcome",
      role: "model",
      text: "Hello! I am Lifeline, your proactive planning assistant. Tell me about any big tasks you're stressed about, or ask me to generate a personalized focus block plan for today.",
    },
  ]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Subscribe to user's Tasks
  useEffect(() => {
    if (!user) return;
    const tasksPath = `users/${user.uid}/tasks`;
    const q = query(collection(db, tasksPath), orderBy("createdAt", "desc"));
    
    const unsubscribe = onSnapshot(collection(db, tasksPath), (snapshot) => {
      const taskList: Task[] = [];
      snapshot.forEach((docSnap) => {
        taskList.push(docSnap.data() as Task);
      });
      // Sort priority and date
      setTasks(taskList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, tasksPath);
    });

    return () => unsubscribe();
  }, [user]);

  // Subscribe to User's Agent Activity (PlanLogs)
  useEffect(() => {
    if (!user) return;
    const logPath = `users/${user.uid}/planLogs`;
    const q = query(collection(db, logPath), orderBy("createdAt", "desc"), limit(12));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logList: PlanLog[] = [];
      snapshot.forEach((docSnap) => {
        logList.push(docSnap.data() as PlanLog);
      });
      setPlanLogs(logList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, logPath);
    });

    return () => unsubscribe();
  }, [user]);

  // Scroll chat to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, agentLoading]);

  // Sync Google Tasks status changes to Lifeline on mount
  useEffect(() => {
    if (!googleAccessToken || tasks.length === 0) return;
    
    let isSubscribed = true;
    const syncFromGoogleTasks = async () => {
      try {
        const res = await fetch(`https://www.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=true&showHidden=true`, {
          headers: { "Authorization": `Bearer ${googleAccessToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.items && isSubscribed) {
          for (const gTask of data.items) {
            const externalIdMatch = `tasks_${gTask.id}`;
            const existing = tasks.find(t => t.externalId === externalIdMatch);
            
            if (existing) {
              const targetStatus = (gTask.status === "completed") ? "done" : "todo";
              if (existing.status !== targetStatus && (existing.status === "todo" || existing.status === "done")) {
                await updateDoc(doc(db, "users", user.uid, "tasks", existing.id), { status: targetStatus });
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to sync from Google Tasks:", err);
      }
    };
    
    syncFromGoogleTasks();
    return () => { isSubscribed = false; };
  }, [googleAccessToken, tasks.length]); // only run initially or when tasks count changes

  // Fast direct actions
  const changeTaskStatus = async (taskId: string, targetStatus: any) => {
    try {
      const taskRef = doc(db, "users", user.uid, "tasks", taskId);
      await updateDoc(taskRef, { status: targetStatus });

      const task = tasks.find(t => t.id === taskId);
      if (task && task.externalId && task.externalId.startsWith("tasks_") && googleAccessToken) {
        const googleTaskId = task.externalId.replace("tasks_", "");
        const gStatus = (targetStatus === "done") ? "completed" : "needsAction";
        
        await fetch(`https://www.googleapis.com/tasks/v1/lists/@default/tasks/${googleTaskId}`, {
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${googleAccessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ status: gStatus })
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const removeTaskDirect = async (taskId: string) => {
    if (!window.confirm("Verify: Are you sure you want to delete this task?")) return;
    try {
      const task = tasks.find(t => t.id === taskId);
      const taskRef = doc(db, "users", user.uid, "tasks", taskId);
      await deleteDoc(taskRef);

      if (task && task.externalId && task.externalId.startsWith("tasks_") && googleAccessToken) {
        const googleTaskId = task.externalId.replace("tasks_", "");
        await fetch(`https://www.googleapis.com/tasks/v1/lists/@default/tasks/${googleTaskId}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${googleAccessToken}`,
          }
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Submit Chat Message to Gemini Server-Proxy Agent
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || agentLoading) return;

    const userMessageText = chatInput.trim();
    setChatInput("");
    
    const userMsgId = "msg_" + Date.now();
    setMessages((prev) => [...prev, { id: userMsgId, role: "user", text: userMessageText }]);
    setAgentLoading(true);
    setAgentStatus("Analyzing schedule gaps...");

    try {
      const chatHistoryForGemini = messages.map(m => ({
        role: m.role,
        text: m.text
      }));

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-google-access-token": googleAccessToken || "",
        },
        body: JSON.stringify({
          message: userMessageText,
          history: chatHistoryForGemini,
          userId: user.uid,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to communicate with planning agent.");
      }

      const data = await response.json();
      
      setMessages((prev) => [...prev, { 
        id: "model_" + Date.now(), 
        role: "model", 
        text: data.text || "Synchronized details successfully." 
      }]);

    } catch (err: any) {
      console.error(err);
      setMessages((prev) => [...prev, { 
        id: "err_" + Date.now(), 
        role: "model", 
        text: "I encountered an error planning with your calendar. Please ensure Google permissions are fully active: " + err.message
      }]);
    } finally {
      setAgentLoading(false);
      setAgentStatus(null);
    }
  };

  // Propose a quick daily plan via agent chat
  const handleAutoSchedule = () => {
    setChatInput("Generate a detailed focus block plan for today based on my tasks.");
    setTimeout(() => {
      handleSendMessage();
    }, 100);
  };

  // Format date helper
  const getTodayDateString = () => {
    return new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric"
    });
  };

  // Compile timeline focus blocks based on today's tasks
  const todayTasksList = tasks.filter(t => t.status !== "done" && t.status !== "missed");

  return (
    <div id="dashboard_screen" className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-7xl mx-auto px-6 py-8 font-sans">
      
      {/* LEFT AREA: Schedule, Calendar Gaps and Activity Flow */}
      <div className="lg:col-span-8 flex flex-col gap-8">
        
        {/* HEADING ACCENT BANNER */}
        <div className="bg-white rounded-2xl border border-[#E6E6E4] p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100/50 mb-2">
              <Sparkles className="w-3.5 h-3.5" /> Proactive Agent Mode Active
            </div>
            <h1 className="text-2xl font-sans font-semibold tracking-tight text-[#2D2D2D]">
              Your Day Plan
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {getTodayDateString()} — Synchronized with your workspace activities
            </p>
          </div>
          <button
            onClick={handleAutoSchedule}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs py-2.5 px-4 rounded-xl shadow-sm transition-all hover:scale-[1.01]"
          >
            <Clock className="w-3.5 h-3.5" /> Auto-Schedule Focus Blocks
          </button>
        </div>

        {/* TIMELINE OF TODAY'S SCHEDULED BLOCKS */}
        <div className="bg-white rounded-2xl border border-[#E6E6E4] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6 pb-2 border-b border-stone-100">
            <h2 className="text-lg font-semibold text-[#2D2D2D] flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-600" /> Planned Time blocks
            </h2>
            <span className="text-xs font-mono text-gray-400">
              {todayTasksList.length} Tasks Scheduled
            </span>
          </div>

          {todayTasksList.length === 0 ? (
            <div className="text-center py-12 px-4 border border-dashed border-[#E6E6E4] rounded-xl bg-stone-50/50">
              <div className="bg-stone-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                <Clock className="w-5 h-5 text-gray-400" />
              </div>
              <p className="text-gray-600 text-sm font-medium">Your schedule is currently clear</p>
              <p className="text-gray-400 text-xs mt-1 max-w-xs mx-auto">
                Type in the chat to tell Lifeline what needs to be accomplished today, or click "Auto-Schedule".
              </p>
            </div>
          ) : (
            <div className="relative border-l border-[#E6E6E4] pl-5 ml-2.5 py-2 flex flex-col gap-6">
              {todayTasksList.map((task, idx) => {
                // Propose simple timings
                const hours = 9 + idx;
                const timeString = `${hours > 12 ? hours - 12 : hours}:00 ${hours >= 12 ? "PM" : "AM"}`;
                return (
                  <motion.div
                    key={task.id}
                    layoutId={`dashboard-task-${task.id}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="relative group bg-[#FAFAFA] hover:bg-stone-50 p-4 rounded-xl border border-stone-100 transition-colors"
                  >
                    {/* Time Dot Indicator */}
                    <span className="absolute -left-[26px] top-5 w-2.5 h-2.5 rounded-full bg-indigo-600 border-2 border-white shadow-sm ring-4 ring-[#F9F9F8]" />
                    
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1.55">
                          <span className="text-xs font-semibold font-mono text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                            {timeString}
                          </span>
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {task.estimatedMinutes} mins
                          </span>
                          {task.priorityScore >= 80 && (
                            <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded font-medium">
                              Critical
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-medium text-[#2D2D2D]">{task.title}</h3>
                        {task.description && (
                          <p className="text-gray-400 text-xs mt-1 block leading-relaxed line-clamp-1">
                            {task.description}
                          </p>
                        )}
                        {task.deadline && (
                          <div className="text-[10px] text-red-500 font-sans mt-2.5 bg-red-50 inline-block px-2 py-0.5 rounded">
                            Due: {new Date(task.deadline).toLocaleDateString()}
                          </div>
                        )}
                        <TaskProgressBar task={task} allTasks={tasks} />
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => changeTaskStatus(task.id, "done")}
                          className="p-1 px-2.5 rounded bg-white hover:bg-indigo-50 text-stone-600 hover:text-indigo-700 border border-[#E6E6E4] hover:border-indigo-200 text-xs flex items-center gap-1 transition-all"
                          title="Mark completed"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-stone-400 group-hover:text-indigo-600" /> Done
                        </button>
                        <button
                          onClick={() => removeTaskDirect(task.id)}
                          className="p-1 rounded hover:bg-red-50 text-stone-400 hover:text-red-600 border border-transparent hover:border-red-100 transition-all"
                          title="Discard task"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* AGENT ACTIVITY FEED */}
        <div className="bg-white rounded-2xl border border-[#E6E6E4] p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[#2D2D2D] flex items-center gap-2 mb-4 pb-2 border-b border-stone-100">
            <History className="w-5 h-5 text-indigo-600" /> Proactive Agent Activity
          </h2>

          {planLogs.length === 0 ? (
            <p className="text-gray-400 text-xs py-4 text-center">
              No recent automated planning cycles or changes. Ask me to sync or optimize your schedule!
            </p>
          ) : (
            <div className="flex flex-col gap-3 max-h-[280px] overflow-y-auto pr-1">
              {planLogs.map((log) => (
                <div key={log.id} className="p-3.5 rounded-xl bg-[#FAFAFA] border border-stone-100 hover:border-[#E6E6E4] transition-all">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-[#2D2D2D] flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-indigo-600" /> {log.action}
                    </span>
                    <span className="text-[10px] font-mono text-gray-400">
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-gray-600 text-xs leading-relaxed">{log.reason}</p>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* RIGHT SIDEBAR: Chat Panel with Lifeline Agent */}
      <div className="lg:col-span-4 flex flex-col h-[750px] bg-white rounded-2xl border border-[#E6E6E4] shadow-sm overflow-hidden">
        
        {/* Chat Header */}
        <div className="bg-white border-b border-[#E6E6E4] p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white text-sm">
            <div className="w-1 h-4 bg-white rounded-full"></div>
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-[#2D2D2D]">Lifeline Planner</h2>
            <span className="text-[10px] text-indigo-600 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" /> Active Companion
            </span>
          </div>
        </div>

        {/* Conversation flow */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-[#F9F9F8]">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col max-w-[85%] ${m.role === "user" ? "self-end items-end" : "self-start items-start"}`}
            >
              <div
                className={`p-3.5 rounded-2xl text-xs leading-relaxed ${
                  m.role === "user"
                    ? "bg-indigo-600 text-white rounded-tr-none shadow-sm"
                    : "bg-white text-stone-800 rounded-tl-none border border-[#E6E6E4] shadow-sm"
                }`}
              >
                {m.text}
              </div>
              <span className="text-[9px] text-gray-450 font-mono mt-1 px-1">
                {m.role === "user" ? "Me" : "Companion"}
              </span>
            </div>
          ))}

          {agentLoading && (
            <div className="self-start items-start flex flex-col max-w-[85%]">
              <div className="bg-white border border-[#E6E6E4] p-3.5 rounded-2xl rounded-tl-none flex items-center gap-3 shadow-sm">
                <div className="flex space-x-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span className="text-[10px] text-indigo-600 font-mono">
                  {agentStatus || "Calculating strategies..."}
                </span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <form onSubmit={handleSendMessage} className="p-3 border-t border-[#E6E6E4] bg-white flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={agentLoading}
            placeholder="Type planning, calendar commands..."
            className="flex-1 bg-[#F9F9F8] border border-[#E6E6E4] outline-none p-2.5 px-3 rounded-xl text-xs font-sans placeholder-stone-400 focus:border-stone-400 transition-colors"
          />
          <button
            type="submit"
            disabled={!chatInput.trim() || agentLoading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white p-2.5 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-md active:scale-95"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

      </div>

    </div>
  );
}
