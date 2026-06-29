import React, { useEffect, useState } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { Task } from "../types";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Sparkles, Trophy, AlertTriangle, RefreshCw, Star, Compass, ArrowRight } from "lucide-react";

interface WeeklyReviewProps {
  user: any;
}

export default function WeeklyReview({ user }: WeeklyReviewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reflection, setReflection] = useState<string>("");
  const [loadingReflection, setLoadingReflection] = useState(false);
  const [reflectionError, setReflectionError] = useState<string | null>(null);

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

  // Counting status
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const missedCount = tasks.filter((t) => t.status === "missed").length;
  const todoCount = tasks.filter((t) => t.status === "todo").length;
  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;

  const chartData = [
    { name: "Completed", value: doneCount, color: "#4f46e5" },
    { name: "Missed", value: missedCount, color: "#ef4444" },
    { name: "Pending", value: todoCount + inProgressCount, color: "#9ca3af" },
  ];

  // Request Gemini Assessment Reflection
  const fetchReflection = async () => {
    if (tasks.length === 0) return;
    setLoadingReflection(true);
    setReflectionError(null);
    try {
      const completedTaskTitles = tasks.filter(t => t.status === "done").map(t => t.title);
      const missedTaskTitles = tasks.filter(t => t.status === "missed").map(t => t.title);

      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completedCount: doneCount,
          missedCount: missedCount,
          completedTitles: completedTaskTitles.slice(0, 5),
          missedTitles: missedTaskTitles.slice(0, 5),
        }),
      });

      if (!res.ok) {
        throw new Error("Weekly analysis engine is warming up. Please recalculate.");
      }

      const data = await res.json();
      if (data.reflection) {
        setReflection(data.reflection);
      } else {
        throw new Error("Analysis generated an empty feedback sheet.");
      }
    } catch (err: any) {
      console.error(err);
      setReflectionError(err.message || "Failed to load dynamic analysis.");
    } finally {
      setLoadingReflection(false);
    }
  };

  // Auto trigger reflection fetch when tasks change
  useEffect(() => {
    if (tasks.length > 0 && !reflection) {
      fetchReflection();
    }
  }, [tasks, reflection]);

  return (
    <div id="weeklyreview_screen" className="max-w-4xl mx-auto px-6 py-8 font-sans">
      
      {/* HEADER ROW */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10 border-b border-[#E6E6E4] pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#2D2D2D]">Weekly Review</h1>
          <p className="text-gray-500 text-sm mt-1">
            Check your momentum, evaluate missed checkpoints, and fetch AI reflection guides.
          </p>
        </div>
        <button
          onClick={fetchReflection}
          disabled={loadingReflection}
          className="inline-flex items-center gap-2 bg-[#FAFAFA] hover:bg-[#F9F9F8] text-[#2D2D2D] text-xs font-semibold py-2.5 px-4 rounded-xl border border-[#E6E6E4] transition-all font-mono shadow-sm animate-fade-in"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingReflection ? "animate-spin" : ""}`} /> RE-EVALUATE FOCUS
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        
        {/* CHART AND COUNTS COLUMN */}
        <div className="md:col-span-5 flex flex-col gap-6">
          <div className="bg-white rounded-2xl border border-[#E6E6E4] p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-[#2D2D2D] mb-4 font-sans">Performance Ratio</h3>
            
            <div className="h-56 w-full mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#78716c" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#78716c" }} />
                  <Tooltip cursor={{ fill: "transparent" }} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="flex justify-around text-center pt-2 border-t border-[#E6E6E4]">
              <div>
                <p className="text-[10px] uppercase font-semibold text-stone-400">Completed</p>
                <p className="text-lg font-bold text-indigo-600 font-sans">{doneCount}</p>
              </div>
              <div className="border-r border-[#E6E6E4]" />
              <div>
                <p className="text-[10px] uppercase font-semibold text-stone-400">Missed</p>
                <p className="text-lg font-bold text-red-500 font-sans">{missedCount}</p>
              </div>
              <div className="border-r border-[#E6E6E4]" />
              <div>
                <p className="text-[10px] uppercase font-semibold text-stone-400">Todo</p>
                <p className="text-lg font-bold text-stone-600 font-sans">{todoCount + inProgressCount}</p>
              </div>
            </div>
          </div>

          {/* QUICK SUMMARY CARD */}
          <div className="bg-[#FAF9F8] border border-[#E6E6E4] rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-5 h-5 text-[#2D2D2D]" />
              <h4 className="text-xs font-semibold tracking-wider uppercase text-[#2D2D2D]">Focus Momentum</h4>
            </div>
            
            <p className="text-gray-650 text-xs leading-relaxed font-sans">
              {doneCount > 0 ? (
                `Magnificent work finishing ${doneCount} milestones! Lifeline synced calendar block secures continue work focus.`
              ) : (
                "Commit tasks on your 'Today' panel to activate automated calendar sync blocks and kickstart your streaks."
              )}
            </p>
          </div>
        </div>

        {/* GEMINI-WRITTEN REFLECTION COLUMN */}
        <div className="md:col-span-7">
          <div className="bg-white rounded-2xl border border-[#E6E6E4] p-6 md:p-8 shadow-sm h-full flex flex-col">
            <div className="flex items-center gap-2 mb-6 border-b border-stone-100 pb-4">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              <h3 className="text-sm font-semibold text-[#2D2D2D] uppercase tracking-wide">AI Active Reflection</h3>
            </div>

            {loadingReflection ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3 text-stone-400 text-xs">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                <span>Reading historical plan records & evaluating outcomes...</span>
              </div>
            ) : reflectionError ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 border-2 border-dashed border-red-105 rounded-xl bg-red-50/50">
                <AlertTriangle className="w-8 h-8 text-red-400 mb-2" />
                <p className="text-red-700 text-xs font-semibold">{reflectionError}</p>
                <button
                  onClick={fetchReflection}
                  className="mt-3 text-xs bg-white border border-red-200 text-red-700 py-1.5 px-3 rounded-lg hover:bg-white transition shadow-sm"
                >
                  Retry Analysis
                </button>
              </div>
            ) : reflection ? (
              <div className="flex-1 overflow-y-auto pr-1">
                <div className="text-xs text-[#2D2D2D] leading-relaxed font-sans whitespace-pre-line bg-[#FAFAFA] rounded-xl p-4 border border-[#E6E6E4] mb-6">
                  {reflection}
                </div>
                
                <div className="bg-indigo-50 border border-indigo-150 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 text-indigo-900 text-xs font-bold mb-2">
                    <Compass className="w-4 h-4 text-indigo-600" /> Weekly Suggestions Blueprint
                  </div>
                  <ul className="list-disc list-inside text-[11px] text-[#2D2D2D] flex flex-col gap-1.5 leading-relaxed font-sans pl-1">
                    <li>Maintain smaller, digestible 25-minute timeline intervals to conquer heavy topics.</li>
                    <li>Utilize Google free-busy scans before noon to block custom focus slots securely.</li>
                    <li>Notify Lifeline instantly when an agenda task slips to execute automatic importance adjustments.</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-stone-400 text-xs bg-[#FAF9F8] rounded-xl border border-dashed border-[#E6E6E4]">
                <Star className="w-8 h-8 text-[#2D2D2D] mb-2" />
                <p className="font-semibold text-[#2D2D2D]">Reflection Sheet Empty</p>
                <p className="text-[11px] text-gray-500 text-center max-w-xs mt-1">Create and complete or skip some tasks first to unlock custom analytical evaluation reports.</p>
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
