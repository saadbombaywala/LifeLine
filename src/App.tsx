import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { initAuth, logout, db } from "./firebase";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { Task } from "./types";
import SignIn from "./components/SignIn";
import Dashboard from "./components/Dashboard";
import AllTasks from "./components/AllTasks";
import Capture from "./components/Capture";
import WeeklyReview from "./components/WeeklyReview";
import { Sparkles, Calendar, FolderHeart, CheckSquare, BarChart, LogOut, Cpu, Bell, BellRing, X, Download, Smartphone } from "lucide-react";

export default function App() {
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  // Tab navigation selection: "today" | "all_tasks" | "capture" | "review"
  const [currentTab, setCurrentTab] = useState<"today" | "all_tasks" | "capture" | "review">("today");

  // Web Notification System States
  const [tasksForNotifications, setTasksForNotifications] = useState<Task[]>([]);
  const [notificationPermission, setNotificationPermission] = useState<string>(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default"
  );
  const [showNotificationBanner, setShowNotificationBanner] = useState(() => {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('lifeline_dismissed_notification_banner') !== 'true' : true;
  });

  // Android / PWA App Download Prompt States
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPwaBanner, setShowPwaBanner] = useState(() => {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('lifeline_dismissed_pwa_banner') !== 'true' : true;
  });
  const [pwaInstalled, setPwaInstalled] = useState(false);

  // Track current time to dynamically calculate task deadlines within the next hour
  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const urgentTasksCount = tasksForNotifications.filter((task) => {
    if (task.status !== "todo" && task.status !== "in_progress") return false;
    if (!task.deadline) return false;
    const deadlineTime = new Date(task.deadline).getTime();
    const timeDiffMs = deadlineTime - currentTime;
    const oneHourMs = 60 * 60 * 1000;
    return timeDiffMs > 0 && timeDiffMs <= oneHourMs;
  }).length;

  // Monitor for PWA installation capacity
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Automatically keep the install option visible if prompted
      setShowPwaBanner(true);
    };

    const handleAppInstalled = () => {
      setPwaInstalled(true);
      setDeferredPrompt(null);
      console.log("[PWA] Lifeline successfully installed on Android/system home screen!");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    // Some browsers have separate ways to detect stand alone
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setPwaInstalled(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallPWA = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`[PWA] Installation prompt user decision: ${outcome}`);
      setDeferredPrompt(null);
    } else {
      // Fallback instruction triggers if native prompt hasn't happened
      alert(
        "📱 Android App Sizing Instruction:\n\n" +
        "1. Open Chrome on your Android device.\n" +
        "2. Tap the three dots (Menu) in the top right corner.\n" +
        "3. Select 'Add to Home screen' or 'Install App'.\n" +
        "4. Tap 'Add' or 'Install' on the popup to package Lifeline into a fast, native-wrapped Android app!"
      );
    }
  };


  // Subscribe to Firebase Authentication state
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setCurrentUser(user);
        setAccessToken(token);
        setAuthChecking(false);
      },
      () => {
        setCurrentUser(null);
        setAccessToken(null);
        setAuthChecking(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Subscribe to Tasks for background pre-deadline notification checking
  useEffect(() => {
    if (!currentUser) {
      setTasksForNotifications([]);
      return;
    }
    const tasksPath = `users/${currentUser.uid}/tasks`;
    const q = query(collection(db, tasksPath), orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(collection(db, tasksPath), (snapshot) => {
      const list: Task[] = [];
      snapshot.forEach((docSnap) => {
        list.push(docSnap.data() as Task);
      });
      setTasksForNotifications(list);
    }, (error) => {
      console.error("Backround notifications subscription error:", error);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Periodic deadline monitor loop
  useEffect(() => {
    if (!currentUser || tasksForNotifications.length === 0) return;

    const checkUpcomingDeadlines = () => {
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") return;

      const now = Date.now();
      const storageKey = `lifeline_notified_tasks_${currentUser.uid}`;
      let notifiedIds: string[] = [];

      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          notifiedIds = JSON.parse(stored);
        }
      } catch (e) {
        console.error("Error reading notified tasks cache:", e);
      }

      let updatedList = [...notifiedIds];
      let didNotify = false;

      tasksForNotifications.forEach((task) => {
        // Only inspect incomplete tasks
        if (task.status !== "todo" && task.status !== "in_progress") return;
        if (!task.deadline) return;

        const deadlineTime = new Date(task.deadline).getTime();
        const timeDiffMs = deadlineTime - now;
        
        // Target window: deadline is within the next 5 minutes (0 to 5 minutes)
        const fiveMinutesMs = 5 * 60 * 1000;

        if (timeDiffMs > 0 && timeDiffMs <= fiveMinutesMs) {
          if (!updatedList.includes(task.id)) {
            const minutesLeft = Math.ceil(timeDiffMs / 60000);
            
            try {
              const notification = new Notification("⏰ Lifeline Objective Alert", {
                body: `"${task.title}" is due in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}!\nSave yours or secure a slot.`,
                tag: task.id,
                requireInteraction: true,
              });

              notification.onclick = () => {
                window.focus();
                setCurrentTab("today");
                notification.close();
              };
            } catch (err) {
              console.error("Filing browser Notification crashed:", err);
            }

            updatedList.push(task.id);
            didNotify = true;
          }
        }
      });

      if (didNotify) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(updatedList));
        } catch (e) {
          console.error("Error updating notified tasks cache:", e);
        }
      }
    };

    // Run first inspection instantly, then poll every 10 seconds
    checkUpcomingDeadlines();
    const intervalRef = setInterval(checkUpcomingDeadlines, 10000);
    return () => clearInterval(intervalRef);
  }, [currentUser, tasksForNotifications]);

  const handleRequestNotificationPermission = () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      Notification.requestPermission().then((permission) => {
        setNotificationPermission(permission);
        if (permission === "granted") {
          try {
            new Notification("🎉 Lifeline alerts on board!", {
              body: "You will be proactively alerted 5 minutes before any task deadlines.",
            });
          } catch (e) {
            console.error("Failed to fire setup notification:", e);
          }
        }
      });
    }
  };

  const handleSignInSuccess = (user: any, token: string) => {
    setCurrentUser(user);
    setAccessToken(token);
  };

  const handleLogout = async () => {
    try {
      await logout();
      setCurrentUser(null);
      setAccessToken(null);
    } catch (err) {
      console.error("Logout issue:", err);
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#F9F9F8] flex flex-col items-center justify-center font-sans gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white text-lg font-bold shadow-sm animate-bounce">
          <div className="w-1.5 h-5 bg-white rounded-full"></div>
        </div>
        <span className="text-xs text-stone-500 font-medium font-sans">Verifying Lifeline Workspace...</span>
      </div>
    );
  }

  if (!currentUser) {
    return <SignIn onSignInSuccess={handleSignInSuccess} />;
  }

  return (
    <div className="min-h-screen bg-[#F9F9F8] text-[#2D2D2D] font-sans antialiased flex flex-col">
      {/* HEADER NAVIGATION */}
      <header className="bg-white border-b border-[#E6E6E4] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
          
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <div className="w-1 h-4 bg-white rounded-full"></div>
            </div>
            <span className="text-lg font-semibold tracking-tight">Lifeline</span>
          </div>

          {/* MAIN TABS */}
          <nav className="hidden md:flex items-center gap-1 bg-[#F5F5F4] p-1 rounded-xl border border-[#E6E6E4]/40">
            <button
              onClick={() => setCurrentTab("today")}
              className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
                currentTab === "today" ? "bg-white text-indigo-700 shadow-sm border border-[#E6E6E4]/30" : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <span className="relative flex items-center justify-center">
                <Cpu className="w-3.5 h-3.5" />
                {urgentTasksCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500 flex-shrink-0"></span>
                  </span>
                )}
              </span>
              Today
            </button>
            <button
              onClick={() => setCurrentTab("all_tasks")}
              className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
                currentTab === "all_tasks" ? "bg-white text-indigo-700 shadow-sm border border-[#E6E6E4]/30" : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <span className="relative flex items-center justify-center">
                <CheckSquare className="w-3.5 h-3.5" />
                {urgentTasksCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500 flex-shrink-0"></span>
                  </span>
                )}
              </span>
              Priority Matrix
            </button>
            <button
              onClick={() => setCurrentTab("capture")}
              className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
                currentTab === "capture" ? "bg-white text-indigo-700 shadow-sm border border-[#E6E6E4]/30" : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" /> Input Objective
            </button>
            <button
              onClick={() => setCurrentTab("review")}
              className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
                currentTab === "review" ? "bg-white text-indigo-700 shadow-sm border border-[#E6E6E4]/30" : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <BarChart className="w-3.5 h-3.5" /> Weekly Review
            </button>
          </nav>

          {/* USER ACTIONS */}
          <div className="flex items-center gap-3">
            {/* Install Android PWA Button */}
            {!pwaInstalled && (
              <button
                onClick={handleInstallPWA}
                className="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 hover:text-indigo-700 border border-indigo-100 rounded-lg transition-all flex items-center gap-1.5 text-xs font-semibold"
                title="Download Lifeline Android App"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span className="hidden lg:inline text-[11px]">Android App</span>
              </button>
            )}

            <div className="flex items-center gap-2 bg-stone-50 border border-[#E6E6E4] p-1.5 pr-3 rounded-xl">
              {currentUser.photoURL ? (
                <img src={currentUser.photoURL} alt={currentUser.displayName || "User"} referrerPolicy="no-referrer" className="w-6 h-6 rounded-full border border-stone-200/50 shadow-sm" />
              ) : (
                <div className="w-6 h-6 bg-stone-200 rounded-full flex items-center justify-center text-[10px] uppercase font-bold text-stone-600">
                  {currentUser.email ? currentUser.email[0] : "U"}
                </div>
              )}
              <span className="text-[11px] font-semibold text-stone-600 font-sans hidden sm:inline-block">
                {currentUser.displayName || currentUser.email}
              </span>
            </div>

            <button
              onClick={handleLogout}
              className="p-2 bg-stone-50 hover:bg-stone-100 text-stone-500 hover:text-stone-900 border border-[#E6E6E4] rounded-lg transition-all"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

        </div>

        {/* MOBILE SUB-NAVIGATION */}
        <div className="flex md:hidden bg-stone-50 border-t border-[#E6E6E4] justify-around py-2">
          <button
            onClick={() => setCurrentTab("today")}
            className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-all ${
              currentTab === "today" ? "text-indigo-600 font-bold" : "text-stone-400"
            }`}
          >
            <span className="relative flex items-center justify-center">
              <Cpu className="w-4 h-4" />
              {urgentTasksCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500 flex-shrink-0"></span>
                </span>
              )}
            </span>
            Today
          </button>
          <button
            onClick={() => setCurrentTab("all_tasks")}
            className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-all ${
              currentTab === "all_tasks" ? "text-indigo-600 font-bold" : "text-stone-400"
            }`}
          >
            <span className="relative flex items-center justify-center">
              <CheckSquare className="w-4 h-4" />
              {urgentTasksCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500 flex-shrink-0"></span>
                </span>
              )}
            </span>
            Matrix
          </button>
          <button
            onClick={() => setCurrentTab("capture")}
            className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-all ${
              currentTab === "capture" ? "text-indigo-600 font-bold" : "text-stone-400"
            }`}
          >
            <Sparkles className="w-4 h-4" /> Capture
          </button>
          <button
            onClick={() => setCurrentTab("review")}
            className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition-all ${
              currentTab === "review" ? "text-indigo-600 font-bold" : "text-stone-400"
            }`}
          >
            <BarChart className="w-4 h-4" /> Weekly
          </button>
        </div>
      </header>

      {/* ANDROID / PWA APP DOWNLOAD & INSTALLATION BANNER */}
      {!pwaInstalled && showPwaBanner && (
        <div id="android_install_banner" className="max-w-7xl mx-auto px-6 mt-4 w-full">
          <div className="bg-gradient-to-r from-stone-900 via-stone-800 to-stone-950 border border-stone-800 rounded-2xl p-4 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-fade-in">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center p-1.5 shrink-0 border border-white/10">
                <img src="/icon.svg" alt="Lifeline Logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
                  Install Lifeline on Android
                </h4>
                <p className="text-[11px] text-stone-300 mt-0.5 leading-relaxed">
                  Download the official standalone Android app to stay in sync with your deadlines, unlock native speeds, and enjoy robust offline access!
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
              <button
                onClick={() => {
                  setShowPwaBanner(false);
                  if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('lifeline_dismissed_pwa_banner', 'true');
                  }
                }}
                className="px-3 py-2 text-[11px] font-medium text-stone-400 hover:text-stone-200 transition-colors"
              >
                Maybe Later
              </button>
              <button
                onClick={handleInstallPWA}
                className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-xl text-[11px] font-semibold shadow-sm transition-all flex items-center gap-1.5 border border-indigo-400/20"
              >
                <Download className="w-3.5 h-3.5" />
                {deferredPrompt ? "Install App" : "Download App"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICATION PROMPT BANNER */}
      <AnimatePresence>
        {notificationPermission === "default" && showNotificationBanner && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
            id="notification_request_banner" 
            className="max-w-7xl mx-auto px-6 mt-4 w-full"
          >
            <div className="bg-white border border-[#E6E6E4] rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0 border border-indigo-100">
                  <Bell className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-[#2D2D2D]">Enable Deadline Reminders</h4>
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                    Never miss an objective! Enable browser alerts to notify you 5 minutes before your task deadlines.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                <button
                  onClick={() => {
                    setShowNotificationBanner(false);
                    if (typeof localStorage !== 'undefined') {
                      localStorage.setItem('lifeline_dismissed_notification_banner', 'true');
                    }
                  }}
                  className="px-3 py-2 text-[11px] font-medium text-stone-500 hover:text-stone-900 transition-colors"
                >
                  Dismiss
                </button>
                <button
                  onClick={handleRequestNotificationPermission}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[11px] font-semibold shadow-sm transition-all flex items-center gap-1.5"
                >
                  <BellRing className="w-3.5 h-3.5" /> Enable Alerts
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FOOTER ACTION OR MAIN SCREEN BODY */}
      <main className="flex-1 bg-[#F9F9F8] pb-16">
        {currentTab === "today" && <Dashboard user={currentUser} googleAccessToken={accessToken} />}
        {currentTab === "all_tasks" && <AllTasks user={currentUser} />}
        {currentTab === "capture" && <Capture user={currentUser} />}
        {currentTab === "review" && <WeeklyReview user={currentUser} />}
      </main>
    </div>
  );
}
