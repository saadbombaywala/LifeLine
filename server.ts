import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "./firebase-applet-config.json" assert { type: "json" };

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// Initialize Firebase Admin for server utility
admin.initializeApp({
  projectId: firebaseConfig.projectId
});
const db = getFirestore();

// Initialize Gemini SDK with User-Agent header for telemetry
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Helper functions for PlanLog appending
async function addPlanLog(userId: string, action: string, reason: string) {
  try {
    const logId = "log_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const ref = db.collection("users").doc(userId).collection("planLogs").doc(logId);
    await ref.set({
      userId,
      action,
      reason,
      createdAt: new Date().toISOString(), // Standard Iso format for easy client-side parsing
    });
  } catch (err) {
    console.error("Error adding plan log:", err);
  }
}

// REST helper to call Google APIs
async function callGoogleAPI(accessToken: string, endpoint: string, method: string, body?: any) {
  try {
    const response = await fetch(`https://www.googleapis.com${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google API Error: ${errText}`);
    }
    if (response.status === 204) return {};
    return await response.json();
  } catch (err: any) {
    console.error("Google network error:", err);
    throw err;
  }
}

// 1. Defining Function Declarations for Gemini Function Calling
const addTaskTool = {
  name: "addTask",
  description: "Creates and adds a new task to Lifeline. Provide the task description, deadline in ISO format (YYYY-MM-DDTHH:MM), source (manual/voice/photo), and optionally priority score (1-100) and estimated minutes.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Title of the task." },
      description: { type: Type.STRING, description: "Description or notes about this task." },
      deadline: { type: Type.STRING, description: "Deadline in ISO DateTime string (e.g. 2026-06-25T17:00:00)." },
      estimatedMinutes: { type: Type.INTEGER, description: "Duration estimate in minutes, defaults to 30." },
      priorityScore: { type: Type.INTEGER, description: "Priority level from 1 (low) to 100 (high)." },
      source: { type: Type.STRING, description: "Creation source. Must be one of: manual, voice, photo." },
    },
    required: ["title", "deadline", "source"],
  },
};

const decomposeTaskTool = {
  name: "decomposeTask",
  description: "Triggers task delegation by splitting a parent task into detailed subtasks with corresponding minutes.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      parentTaskId: { type: Type.STRING, description: "The ID of the parent task to decompose." },
      subtasks: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Subtask title." },
            estimatedMinutes: { type: Type.INTEGER, description: "Estimated duration for this subtask." },
          },
          required: ["title", "estimatedMinutes"],
        },
      },
    },
    required: ["parentTaskId", "subtasks"],
  },
};

const createCalendarEventTool = {
  name: "createCalendarEvent",
  description: "Creates an event in the user's Google Calendar with specific start and end times.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "The calendar event summary/title." },
      description: { type: Type.STRING, description: "Details of the calendar event." },
      startTime: { type: Type.STRING, description: "Event start in ISO DateTime string format (YYYY-MM-DDTHH:MM:SSZ)." },
      endTime: { type: Type.STRING, description: "Event end in ISO DateTime string format (YYYY-MM-DDTHH:MM:SSZ)." },
    },
    required: ["title", "startTime", "endTime"],
  },
};

const updateCalendarEventTool = {
  name: "updateCalendarEvent",
  description: "Modifies an existing google calendar event's timing or title.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      eventId: { type: Type.STRING, description: "The primary calendar event ID." },
      title: { type: Type.STRING, description: "New title update." },
      startTime: { type: Type.STRING, description: "New start time in ISO DateTime." },
      endTime: { type: Type.STRING, description: "New end time in ISO DateTime." },
    },
    required: ["eventId"],
  },
};

const getCalendarBusyTimesTool = {
  name: "getCalendarBusyTimes",
  description: "Reads user's google calendar and extracts busy periods between a specific range.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      timeMin: { type: Type.STRING, description: "ISO start boundary (e.g. 2026-06-22T00:00:00Z)." },
      timeMax: { type: Type.STRING, description: "ISO end boundary (e.g. 2026-06-22T23:59:59Z)." },
    },
    required: ["timeMin", "timeMax"],
  },
};

const generateDailyPlanTool = {
  name: "generateDailyPlan",
  description: "Scans user's open tasks and calendar gaps and proposes a daily productivity timeline.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      date: { type: Type.STRING, description: "The target date for planning (YYYY-MM-DD format)." },
    },
    required: ["date"],
  },
};

const reprioritizeTasksTool = {
  name: "reprioritizeTasks",
  description: "Urgent prioritization review when tasks are marked missed. Recalculates and shifts priority scores.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

const markTaskStatusTool = {
  name: "markTaskStatus",
  description: "Updates state of a specific Lifeline task.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      taskId: { type: Type.STRING, description: "The task identifier." },
      status: { type: Type.STRING, description: "Target status. Must be: todo, in_progress, done, missed." },
    },
    required: ["taskId", "status"],
  },
};

const scanGmailForTasksTool = {
  name: "scanGmailForTasks",
  description: "Scans recent emails and intelligently extracts actionable deadlines as tasks.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      maxResults: { type: Type.INTEGER, description: "Maximum number of emails to scan." },
      after: { type: Type.STRING, description: "Date string in YYYY/MM/DD format to filter emails after this date." },
    },
    required: ["maxResults", "after"],
  },
};

const listGoogleTasksTool = {
  name: "listGoogleTasks",
  description: "Lists tasks from Google Tasks (default task list).",
  parameters: { type: Type.OBJECT, properties: {} }
};

const createGoogleTaskTool = {
  name: "createGoogleTask",
  description: "Creates a task in Google Tasks and mirrors it in Lifeline.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Task title" },
      notes: { type: Type.STRING, description: "Task description/notes" },
      due: { type: Type.STRING, description: "Due date in RFC 3339 format" }
    },
    required: ["title"]
  }
};

const updateGoogleTaskTool = {
  name: "updateGoogleTask",
  description: "Updates a task in Google Tasks.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      taskId: { type: Type.STRING, description: "The Google Task ID." },
      title: { type: Type.STRING, description: "New title." },
      notes: { type: Type.STRING, description: "New notes." },
      due: { type: Type.STRING, description: "New due date in RFC 3339." },
      status: { type: Type.STRING, description: "'needsAction' or 'completed'" }
    },
    required: ["taskId"]
  }
};

const completeGoogleTaskTool = {
  name: "completeGoogleTask",
  description: "Marks a Google Task as completed.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      taskId: { type: Type.STRING, description: "The Google Task ID." }
    },
    required: ["taskId"]
  }
};

const TOOLS = [
  addTaskTool,
  decomposeTaskTool,
  createCalendarEventTool,
  updateCalendarEventTool,
  getCalendarBusyTimesTool,
  generateDailyPlanTool,
  reprioritizeTasksTool,
  markTaskStatusTool,
  scanGmailForTasksTool,
  listGoogleTasksTool,
  createGoogleTaskTool,
  updateGoogleTaskTool,
  completeGoogleTaskTool,
];

// Health API
app.get("/api/health", (req, res) => {
  res.json({ status: "alive", code: 200 });
});

// API endpoint for MULTIMODAL SYLLABUS / PHOTO TASK EXTRACTION
app.post("/api/capture", async (req, res) => {
  const { fileData, mimeType } = req.body;
  if (!fileData || !mimeType) {
    return res.status(400).json({ error: "Missing fileData or mimeType" });
  }

  try {
    const cleanMimeType = mimeType.split(";")[0].trim();
    let prompt = "Inspect this schedule, Syllabus, textbook pages or handwritten to-do note and extract all tasks. Return a clean JSON array of tasks where each object has parameters: 'title' (string), 'deadline' (ISO datetime string e.g. 2026-06-25T17:00:00 or current year: 2026), 'estimatedMinutes' (integer duration, default 30), and 'priorityScore' (1 to 100). Do not include any other markdown packaging, just the pure valid JSON.";

    if (cleanMimeType.startsWith("audio/")) {
      prompt = "Listen closely to this short audio recording of a user describing a task or objective they need to schedule. Transcribe their words, clean up any speaking pauses, and structure it into a clean, complete task object. Return a JSON array featuring a single object with properties: 'title' (string, the task transcription), 'deadline' (ISO datetime string, default to tomorrow at 9 AM if they didn't specify a date), 'estimatedMinutes' (integer duration e.g. 15, 30, 45, 60, default 30), and 'priorityScore' (integer 1 to 100, default 50). Do not include any markdown coding wrappers, just return the valid JSON array.";
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            data: fileData,
            mimeType: cleanMimeType,
          },
        },
        prompt,
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text || "[]";
    const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const tasks = JSON.parse(cleanedText);
    res.json({ success: true, tasks });
  } catch (error: any) {
    console.error("Multimodal error:", error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint for Weekly Review reflection generation
app.post("/api/review", async (req, res) => {
  const { completedCount, missedCount, completedTitles, missedTitles } = req.body;

  try {
    const prompt = `Review my performance for this week: I completed ${completedCount || 0} tasks and missed ${missedCount || 0} tasks.
    Here are some of the tasks I completed: ${JSON.stringify(completedTitles || [])}
    Here are some of the tasks I missed: ${JSON.stringify(missedTitles || [])}

    Provide a short, elegant 2-paragraph reflection focusing on my productivity momentum.
    Be constructive, practical, encouraging, and clear. Do not use Markdown headings like # or ##.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    res.json({ success: true, reflection: response.text || "Your momentum is steady. Continue scheduling focus blocks." });
  } catch (error: any) {
    console.error("Aggregation reflection error:", error);
    res.json({ success: false, reflection: "Your weekly planning strategy is synchronized. Keep adding tasks." });
  }
});

// API endpoint to execute the planning agent (Chat + function calling recursion loop)
app.post("/api/agent", async (req, res) => {
  const { message, history, userId } = req.body;
  const googleAccessToken = req.headers["x-google-access-token"] as string;

  if (!userId) {
    return res.status(400).json({ error: "Missing authenticated userId parameter." });
  }

  try {
    // 1. Compile conversations for history
    const geminiContents: any[] = [];
    if (history && Array.isArray(history)) {
      for (const h of history) {
        geminiContents.push({
          role: h.role,
          parts: [{ text: h.text }],
        });
      }
    }

    // Add the fresh incoming message
    geminiContents.push({
      role: "user",
      parts: [{ text: message }],
    });

    const sysInstruction = `You are Lifeline, a highly active, helpful premium AI planning agent. Your mission is to proactively help the user schedule and accomplish tasks before they slip, rather than simply offering passive warnings.
    The current local date-time is ${new Date().toISOString()}.
    You have tools to add tasks, decompose complex tasks, read/write calendar events, reprioritize schedules, retrieve busy timelines, and mark tasks completed.
    IMPORTANT guidelines:
    - Whenever you invoke a tool, write a clear, concise one-sentence plain-English reason and explanation into the planLog for the user's Agent Activity Feed.
    - If a task is missed or slipping, propose structured calendar slots to secure the user's commitment.
    - Chain multiple logic tools in one turn if necessary (e.g. decompose a task into subtasks, then schedule them into open slots on the calendar).
    - Always speak in a reassuring, crisp, organized, and helpful developer/planning perspective.
    `;

    // We execute the generation content
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: geminiContents,
      config: {
        systemInstruction: sysInstruction,
        tools: [{ functionDeclarations: TOOLS }],
      },
    });

    const functionCalls = response.functionCalls;
    const finalLogs: string[] = [];

    if (functionCalls && functionCalls.length > 0) {
      const results: any[] = [];

      for (const call of functionCalls) {
        const { name, args } = call;
        console.log(`Executing tool: ${name}`, args);

        try {
          if (name === "addTask") {
            const taskParams = args as any;
            const taskId = "task_" + Date.now() + "_" + Math.floor(Math.random() * 100);
            const taskRef = db.collection("users").doc(userId).collection("tasks").doc(taskId);
            
            const taskObj = {
              id: taskId,
              userId,
              title: taskParams.title,
              description: taskParams.description || "",
              deadline: taskParams.deadline,
              estimatedMinutes: Number(taskParams.estimatedMinutes) || 30,
              priorityScore: Number(taskParams.priorityScore) || 50,
              status: "todo",
              source: taskParams.source || "manual",
              createdAt: new Date().toISOString(),
            };

            await taskRef.set(taskObj);
            const reason = `I added the priority task "${taskParams.title}" expecting completion by ${taskParams.deadline}.`;
            await addPlanLog(userId, `Added task: ${taskParams.title}`, reason);
            finalLogs.push(reason);

            results.push({
              name,
              content: { success: true, taskId, message: "Task successfully saved to Firestore and synchronized." },
            });
          } 
          else if (name === "decomposeTask") {
            const decompParams = args as any;
            const subtaskObjs: any[] = [];

            for (const sub of decompParams.subtasks) {
              const subId = "task_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
              const subRef = db.collection("users").doc(userId).collection("tasks").doc(subId);
              const subObj = {
                id: subId,
                userId,
                title: sub.title,
                description: `Decomposed from parent task ID ${decompParams.parentTaskId}`,
                deadline: new Date().toISOString(), // Default
                estimatedMinutes: Number(sub.estimatedMinutes) || 15,
                priorityScore: 80,
                status: "todo",
                parentTaskId: decompParams.parentTaskId,
                source: "manual",
                createdAt: new Date().toISOString(),
              };
              await subRef.set(subObj);
              subtaskObjs.push(subObj);
            }

            const reason = `Decomposed task ${decompParams.parentTaskId} into ${decompParams.subtasks.length} actionable subtasks to optimize flow.`;
            await addPlanLog(userId, `Decomposed task`, reason);
            finalLogs.push(reason);

            results.push({
              name,
              content: { success: true, subtasks: subtaskObjs },
            });
          } 
          else if (name === "createCalendarEvent") {
            const eventParams = args as any;
            if (!googleAccessToken) {
              throw new Error("Google Calendar API requires Google authentication token.");
            }
            
            const googleResponse = await callGoogleAPI(googleAccessToken, "/calendar/v3/calendars/primary/events", "POST", {
              summary: eventParams.title,
              description: eventParams.description || "Scheduled via Lifeline AI Planner",
              start: { dateTime: eventParams.startTime },
              end: { dateTime: eventParams.endTime },
            });

            const reason = `Scheduled meeting/work event "${eventParams.title}" directly on your primary Google Calendar.`;
            await addPlanLog(userId, `Created Google Calendar Event`, reason);
            finalLogs.push(reason);

            results.push({
              name,
              content: { success: true, eventId: googleResponse.id, link: googleResponse.htmlLink },
            });
          } 
          else if (name === "updateCalendarEvent") {
            const eventParams = args as any;
            if (!googleAccessToken) {
              throw new Error("Google Calendar API requires Google authentication token.");
            }

            const patchBody: any = {};
            if (eventParams.title) patchBody.summary = eventParams.title;
            if (eventParams.startTime) patchBody.start = { dateTime: eventParams.startTime };
            if (eventParams.endTime) patchBody.end = { dateTime: eventParams.endTime };

            const googleResponse = await callGoogleAPI(
              googleAccessToken,
              `/calendar/v3/calendars/primary/events/${eventParams.eventId}`,
              "PATCH",
              patchBody
            );

            const reason = `Rescheduled or updated Google Calendar event "${eventParams.title || eventParams.eventId}".`;
            await addPlanLog(userId, `Updated Google Calendar Event`, reason);
            finalLogs.push(reason);

            results.push({
              name,
              content: { success: true, eventId: googleResponse.id },
            });
          } 
          else if (name === "getCalendarBusyTimes") {
            const busyParams = args as any;
            if (!googleAccessToken) {
              throw new Error("Google Calendar access token is required to retrieve busy times.");
            }

            const busyData = await callGoogleAPI(googleAccessToken, "/freeBusy", "POST", {
              timeMin: busyParams.timeMin,
              timeMax: busyParams.timeMax,
              items: [{ id: "primary" }],
            });

            const busyPeriods = busyData?.calendars?.primary?.busy || [];
            const reason = `Analyzed calendar commitments between ${busyParams.timeMin} and ${busyParams.timeMax} to extract free slots.`;
            await addPlanLog(userId, `Scanned calendar busy times`, reason);
            finalLogs.push(reason);

            results.push({
              name,
              content: { success: true, busy: busyPeriods },
            });
          } 
          else if (name === "generateDailyPlan") {
            const planParams = args as any;
            // Fetch all tasks of user
            const tasksRef = db.collection("users").doc(userId).collection("tasks");
            const querySnap = await tasksRef.where("status", "in", ["todo", "in_progress"]).get();
            const list: any[] = [];
            querySnap.forEach(d => list.push(d.data()));

            // Plan scheduling recommendation
            const planLogText = `Drafted personalized focus blocks on ${planParams.date} for ${list.length} pending tasks.`;
            await addPlanLog(userId, `Generated daily schedule`, planLogText);
            finalLogs.push(planLogText);

            results.push({
              name,
              content: {
                success: true,
                tasks: list,
                proposedPlan: list.map((t, idx) => ({
                  time: `09:${idx * 3}0`,
                  duration: t.estimatedMinutes || 30,
                  title: `Focus Block: ${t.title}`,
                })),
              },
            });
          } 
          else if (name === "reprioritizeTasks") {
            const tasksRef = db.collection("users").doc(userId).collection("tasks");
            const querySnap = await tasksRef.get();
            let updatedCount = 0;

            for (const docObj of querySnap.docs) {
              const taskData = docObj.data();
              if (taskData.status === "missed" && taskData.priorityScore < 90) {
                const newScore = Math.min(100, (taskData.priorityScore || 50) + 20);
                await docObj.ref.update({
                  priorityScore: newScore,
                });
                updatedCount++;
              }
            }

            const reason = `Detected missed benchmarks. Automatically elevated importance scores on ${updatedCount} delayed objectives.`;
            await addPlanLog(userId, `Urgent reprioritization adaptive cycle`, reason);
            finalLogs.push(reason);

            results.push({
              name,
              content: { success: true, upgradedCount: updatedCount },
            });
          } 
          else if (name === "markTaskStatus") {
            const statusParams = args as any;
            const taskDocRef = db.collection("users").doc(userId).collection("tasks").doc(statusParams.taskId);
            await taskDocRef.update({
              status: statusParams.status,
            });

            const reason = `Marked task benchmark ${statusParams.taskId} as ${statusParams.status}.`;
            await addPlanLog(userId, `Modified task status`, reason);
            finalLogs.push(reason);

            results.push({
              name,
              content: { success: true, taskId: statusParams.taskId, status: statusParams.status },
            });
          } else if (name === "scanGmailForTasks") {
            if (!googleAccessToken) throw new Error("Google access token required.");
            const p = args as any;
            const q = `after:${p.after}`;
            const searchData = await callGoogleAPI(googleAccessToken, `/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${p.maxResults || 10}`, "GET");
            const messages = searchData.messages || [];
            const newTasks: any[] = [];
            
            for (const m of messages) {
              const msgData = await callGoogleAPI(googleAccessToken, `/gmail/v1/users/me/messages/${m.id}`, "GET");
              const subjectHeader = msgData.payload?.headers?.find((h: any) => h.name === "Subject")?.value || "No Subject";
              const snippet = msgData.snippet || "";
              
              const prompt = `Analyze this email subject and snippet to determine if it contains an actionable deadline or task.\nSubject: ${subjectHeader}\nSnippet: ${snippet}\n\nIf it DOES contain an actionable deadline, extract a concise task title, and a deadline in ISO format, and return a JSON object like {"hasTask":true, "title":"...", "deadline":"..."}.\nIf it DOES NOT, return {"hasTask":false}. Only return valid JSON.`;
              
              const aiRes = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: { responseMimeType: "application/json" }
              });
              const aiJsonStr = aiRes.text?.replace(/```json/g, "")?.replace(/```/g, "")?.trim() || "{}";
              try {
                const analysis = JSON.parse(aiJsonStr);
                if (analysis.hasTask && analysis.title && analysis.deadline) {
                  const taskId = "task_" + Date.now() + "_" + Math.floor(Math.random() * 100);
                  const taskRef = db.collection("users").doc(userId).collection("tasks").doc(taskId);
                  const taskObj = {
                    id: taskId,
                    userId,
                    title: analysis.title,
                    description: `Extracted from email: ${subjectHeader}`,
                    deadline: analysis.deadline,
                    estimatedMinutes: 30,
                    priorityScore: 60,
                    status: "todo",
                    source: "email",
                    externalId: `gmail_${m.id}`,
                    createdAt: new Date().toISOString()
                  };
                  await taskRef.set(taskObj);
                  newTasks.push(taskObj);
                  
                  const reason = `Extracted task "${analysis.title}" from email "${subjectHeader}".`;
                  await addPlanLog(userId, `Scanned email for tasks`, reason);
                  finalLogs.push(reason);
                }
              } catch (e) {
                console.error("Failed to parse Gemini output for email:", aiJsonStr);
              }
            }
            results.push({ name, content: { success: true, newTasks } });
          } else if (name === "listGoogleTasks") {
            if (!googleAccessToken) throw new Error("Google access token required.");
            const data = await callGoogleAPI(googleAccessToken, "/tasks/v1/lists/@default/tasks", "GET");
            results.push({ name, content: { success: true, tasks: data.items || [] } });
          } else if (name === "createGoogleTask") {
            if (!googleAccessToken) throw new Error("Google access token required.");
            const p = args as any;
            const data = await callGoogleAPI(googleAccessToken, "/tasks/v1/lists/@default/tasks", "POST", {
              title: p.title,
              notes: p.notes,
              due: p.due
            });
            
            // Mirror it in Lifeline
            const taskId = "task_" + Date.now() + "_" + Math.floor(Math.random() * 100);
            const taskRef = db.collection("users").doc(userId).collection("tasks").doc(taskId);
            const taskObj = {
              id: taskId,
              userId,
              title: p.title,
              description: p.notes || "",
              deadline: p.due || new Date(Date.now() + 86400000).toISOString(),
              estimatedMinutes: 30,
              priorityScore: 50,
              status: "todo",
              source: "google_tasks",
              externalId: `tasks_${data.id}`,
              createdAt: new Date().toISOString()
            };
            await taskRef.set(taskObj);
            
            const reason = `Created task "${p.title}" on Google Tasks and synchronized it to Lifeline.`;
            await addPlanLog(userId, `Synced Google Task`, reason);
            finalLogs.push(reason);

            results.push({ name, content: { success: true, task: data, lifelineTaskId: taskId } });
          } else if (name === "updateGoogleTask") {
            if (!googleAccessToken) throw new Error("Google access token required.");
            const p = args as any;
            const data = await callGoogleAPI(googleAccessToken, `/tasks/v1/lists/@default/tasks/${p.taskId}`, "PATCH", {
              title: p.title,
              notes: p.notes,
              due: p.due,
              status: p.status
            });
            
            // Mirror it in Lifeline
            const extId = `tasks_${p.taskId}`;
            const tasksSnap = await db.collection("users").doc(userId).collection("tasks").where("externalId", "==", extId).get();
            if (!tasksSnap.empty) {
              const docRef = tasksSnap.docs[0].ref;
              const updateData: any = {};
              if (p.title) updateData.title = p.title;
              if (p.notes) updateData.description = p.notes;
              if (p.due) updateData.deadline = p.due;
              if (p.status) updateData.status = (p.status === "completed") ? "done" : "todo";
              await docRef.update(updateData);
            }
            
            const reason = `Updated Google Task and synced changes back to Lifeline.`;
            await addPlanLog(userId, `Updated Google Task`, reason);
            finalLogs.push(reason);
            
            results.push({ name, content: { success: true, task: data } });
          } else if (name === "completeGoogleTask") {
            if (!googleAccessToken) throw new Error("Google access token required.");
            const p = args as any;
            const data = await callGoogleAPI(googleAccessToken, `/tasks/v1/lists/@default/tasks/${p.taskId}`, "PATCH", {
              status: "completed"
            });
            
            // Mirror it in Lifeline
            const extId = `tasks_${p.taskId}`;
            const tasksSnap = await db.collection("users").doc(userId).collection("tasks").where("externalId", "==", extId).get();
            if (!tasksSnap.empty) {
              await tasksSnap.docs[0].ref.update({ status: "done" });
            }
            
            const reason = `Marked Google Task as completed and synced to Lifeline.`;
            await addPlanLog(userId, `Completed Google Task`, reason);
            finalLogs.push(reason);
            
            results.push({ name, content: { success: true, task: data } });
          }
        } catch (toolError: any) {
          console.error(`Error in tool execution (${name}):`, toolError);
          results.push({
            name,
            content: { error: true, message: toolError.message },
          });
        }
      }

      // Chain the tool execution results back to the model for final evaluation / textual greeting
      const secondContents = [
        ...geminiContents,
        response.candidates?.[0]?.content,
        {
          role: "tool",
          parts: results.map(r => ({
            functionResponse: {
              name: r.name,
              response: r.content,
            }
          })),
        },
      ];

      const secondResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: secondContents,
        config: { systemInstruction: sysInstruction },
      });

      return res.json({
        success: true,
        text: secondResponse.text || "I executed the requested task and synchronized details.",
        logs: finalLogs,
      });
    }

    res.json({
      success: true,
      text: response.text || "Everything is perfect. Let me know if you want me to update your agenda.",
      logs: finalLogs,
    });
  } catch (error: any) {
    console.error("Agent orchestration failed:", error);
    res.status(500).json({ error: error.message });
  }
});

// Configure Vite middleware and static routes
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Lifeline dev server running on port ${PORT}`);
  });
}

startServer();
