import React, { useState, useEffect } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Task } from "../types";
import { Upload, Mic, MicOff, Type, FileSearch, Sparkles, Check, AlertCircle, RefreshCw } from "lucide-react";

interface CaptureProps {
  user: any;
}

export default function Capture({ user }: CaptureProps) {
  // Capture modes: "manual" | "voice" | "photo"
  const [activeMode, setActiveMode] = useState<"manual" | "voice" | "photo">("manual");
  
  // Voice recognition states (legacy built-in Web Speech API)
  const [recognizing, setRecognizing] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const [recognitionObj, setRecognitionObj] = useState<any>(null);
  const [speechSupported, setSpeechSupported] = useState(true);

  // Modern robust AI speech recorder fallback
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [voiceExtractLoading, setVoiceExtractLoading] = useState(false);
  const [voiceExtractError, setVoiceExtractError] = useState<string | null>(null);

  // Photo extract states
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extractedDrafts, setExtractedDrafts] = useState<any[]>([]);

  // Manual inputs
  const [manualTitle, setManualTitle] = useState("");
  const [manualDesc, setManualDesc] = useState("");
  const [manualDeadline, setManualDeadline] = useState("");
  const [manualScore, setManualScore] = useState(50);
  const [manualEst, setManualEst] = useState(30);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Initialize Web Speech API if available
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    try {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "en-US";

      rec.onstart = () => {
        setRecognizing(true);
        setVoiceText("Listening closely to your voice... Speak now.");
      };

      rec.onresult = (event: any) => {
        const resultText = event.results[0][0].transcript;
        setVoiceText(resultText);
        setManualTitle(resultText);
      };

      rec.onerror = (err: any) => {
        console.error("Web Speech API Error:", err);
        setVoiceText("Microphone permission or service is obstructed. Try the AI Voice Intelligent Recorder below.");
        setRecognizing(false);
      };

      rec.onend = () => {
        setRecognizing(false);
      };

      setRecognitionObj(rec);
    } catch (e) {
      console.error("Speech recognition construction failed", e);
      setSpeechSupported(false);
    }
  }, []);

  const toggleVoiceRecording = () => {
    if (!recognitionObj) return;
    if (recognizing) {
      recognitionObj.stop();
    } else {
      setVoiceText("");
      setVoiceExtractError(null);
      recognitionObj.start();
    }
  };

  // Modern AI Voice Intelligent Recording logic
  const startRecordingAudio = async () => {
    setVoiceExtractError(null);
    setVoiceText("Initializing microphone stream...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstart = () => {
        setIsRecordingAudio(true);
        setVoiceText("AI is recording... Tell me exactly what you want to achieve!");
      };

      recorder.onstop = async () => {
        setIsRecordingAudio(false);
        setVoiceText("Processing voice patterns with Gemini...");
        setVoiceExtractLoading(true);

        const audioBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach(track => track.stop());

        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            try {
              const base64String = (reader.result as string).split(",")[1];
              const res = await fetch("/api/capture", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  fileData: base64String,
                  mimeType: audioBlob.type || "audio/webm",
                }),
              });

              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || "Gemini voice task parsing failed.");
              }

              const data = await res.json();
              if (data.success && Array.isArray(data.tasks) && data.tasks.length > 0) {
                const firstTask = data.tasks[0];
                setVoiceText(`Successfully structured task: "${firstTask.title}"`);
                setManualTitle(firstTask.title);
                
                if (firstTask.deadline) {
                  try {
                    const d = new Date(firstTask.deadline);
                    const pad = (n: number) => n.toString().padStart(2, "0");
                    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                    setManualDeadline(dateStr);
                  } catch (e) {
                    // fall back
                  }
                }
                setManualEst(Number(firstTask.estimatedMinutes) || 30);
                setManualScore(Number(firstTask.priorityScore) || 50);
              } else {
                throw new Error("No structured agenda fields could be extracted from voice.");
              }
            } catch (innerErr: any) {
              console.error(innerErr);
              setVoiceExtractError(innerErr.message || "Failed to parse recording. Please try keyboard input.");
              setVoiceText("");
            } finally {
              setVoiceExtractLoading(false);
            }
          };
          reader.onerror = () => {
            throw new Error("Local audio file stream broke.");
          };
        } catch (readErr: any) {
          console.error(readErr);
          setVoiceExtractError(readErr.message || "Failed to read local voice block.");
          setVoiceExtractLoading(false);
          setVoiceText("");
        }
      };

      recorder.start();
      setMediaRecorder(recorder);
    } catch (err: any) {
      console.error(err);
      setVoiceExtractError("Microphone hardware was blocked or not found. Please review browser permission bars.");
      setVoiceText("");
    }
  };

  const stopRecordingAudio = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  };

  // Convert uploaded Syllabus/Note to Base64 & Extract
  const handleUploadedPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadLoading(true);
    setUploadError(null);
    setExtractedDrafts([]);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        try {
          const base64String = (reader.result as string).split(",")[1];
          const res = await fetch("/api/capture", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileData: base64String,
              mimeType: file.type,
            }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || "Gemini can't extract tasks from this format. Try another PDF or image.");
          }

          const data = await res.json();
          if (data.success && Array.isArray(data.tasks)) {
            setExtractedDrafts(data.tasks);
          } else {
            throw new Error("No structured syllabus items could be extracted.");
          }
        } catch (innerErr: any) {
          console.error(innerErr);
          setUploadError(innerErr.message || "Extraction failed.");
        } finally {
          setUploadLoading(false);
        }
      };
      reader.onerror = () => {
        setUploadError("Could not read local file.");
        setUploadLoading(false);
      };
    } catch (err: any) {
      console.error(err);
      setUploadError(err.message || "Extraction failed.");
      setUploadLoading(false);
    }
  };

  // Confirm extracted individual task
  const saveExtractedDraft = async (draftIdx: number) => {
    const draft = extractedDrafts[draftIdx];
    try {
      const truncatedTitle = (draft.title || "").slice(0, 195);
      const taskId = "task_" + Date.now() + "_" + Math.floor(Math.random() * 100);
      const docRef = doc(db, "users", user.uid, "tasks", taskId);
      await setDoc(docRef, {
        id: taskId,
        userId: user.uid,
        title: truncatedTitle,
        description: "Extracted via Gemini Syllabus Lens",
        deadline: draft.deadline || new Date(Date.now() + 86400000 * 3).toISOString(), // Default 3 days out
        estimatedMinutes: Number(draft.estimatedMinutes) || 45,
        priorityScore: Number(draft.priorityScore) || 60,
        status: "todo",
        source: "photo",
        createdAt: new Date().toISOString(),
      });

      // Filter from draft state
      setExtractedDrafts((prev) => prev.filter((_, idx) => idx !== draftIdx));
    } catch (err) {
      console.error(err);
    }
  };

  // Save all extracted drafts
  const saveAllExtractedDrafts = async () => {
    const totalCount = extractedDrafts.length;
    for (let i = 0; i < totalCount; i++) {
      await saveExtractedDraft(0); // Always saving index 0 as previous is removed
    }
    alert("Superb! All tasks successfully scheduled on Lifeline.");
  };

  // Submit manual / voice form
  const handleSaveManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTitle.trim() || !manualDeadline) return;

    try {
      const truncatedTitle = manualTitle.slice(0, 195);
      const taskId = "task_" + Date.now();
      const docRef = doc(db, "users", user.uid, "tasks", taskId);
      await setDoc(docRef, {
        id: taskId,
        userId: user.uid,
        title: truncatedTitle,
        description: manualDesc,
        deadline: manualDeadline,
        estimatedMinutes: Number(manualEst) || 30,
        priorityScore: Number(manualScore) || 50,
        status: "todo",
        source: activeMode === "voice" ? "voice" : "manual",
        createdAt: new Date().toISOString(),
      });

      // Reset
      setManualTitle("");
      setManualDesc("");
      setManualDeadline("");
      setManualScore(50);
      setManualEst(30);
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 4000);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div id="capture_screen" className="max-w-4xl mx-auto px-6 py-8 font-sans">
      
      {/* Title block */}
      <div className="text-center mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-[#2D2D2D]">Input Objective</h1>
        <p className="text-gray-500 text-sm mt-1 max-w-md mx-auto">
          Add new agendas manually, dictate via speech recognition, or upload images of syllabi/to-do notebooks.
        </p>
      </div>

      {/* Capture Mode Toggle Buttons */}
      <div className="flex justify-center gap-1 bg-[#F9F9F8] p-1.5 rounded-2xl max-w-sm mx-auto mb-8 border border-[#E6E6E4]">
        <button
          onClick={() => setActiveMode("manual")}
          className={`flex-1 py-2 px-3 text-xs font-medium rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            activeMode === "manual" ? "bg-white text-[#2D2D2D] shadow-sm border border-stone-100" : "text-gray-550 hover:text-[#2D2D2D]"
          }`}
        >
          <Type className="w-3.5 h-3.5" /> Keyboard
        </button>
        <button
          onClick={() => setActiveMode("voice")}
          className={`flex-1 py-2 px-3 text-xs font-medium rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            activeMode === "voice" ? "bg-white text-[#2D2D2D] shadow-sm border border-stone-100" : "text-gray-550 hover:text-[#2D2D2D]"
          }`}
        >
          <Mic className="w-3.5 h-3.5" /> Speak
        </button>
        <button
          onClick={() => setActiveMode("photo")}
          className={`flex-1 py-2 px-3 text-xs font-medium rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            activeMode === "photo" ? "bg-white text-[#2D2D2D] shadow-sm border border-stone-100" : "text-gray-550 hover:text-[#2D2D2D]"
          }`}
        >
          <FileSearch className="w-3.5 h-3.5" /> Syllabus Lens
        </button>
      </div>

      {submitSuccess && (
        <div className="bg-indigo-50 border border-indigo-150 text-indigo-900 rounded-xl p-4 mb-6 text-xs text-center font-semibold">
          Saved! The planning agent is aware and aligning timings.
        </div>
      )}

      {/* CARD INTERFACES */}
      <div className="bg-white rounded-2xl border border-[#E6E6E4] p-6 md:p-8 shadow-sm">
        
        {/* KEYBOARD / MANUAL CAPTURE FORM */}
        {activeMode === "manual" && (
          <form onSubmit={handleSaveManual} className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Objective Title *</label>
                <input
                  type="text"
                  required
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="e.g. Work on chapter 4 physics assignment"
                  className="w-full bg-[#FAFAFA] border border-[#E6E6E4] rounded-xl p-3 text-xs outline-none focus:border-stone-400 transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Target Deadline *</label>
                <input
                  type="datetime-local"
                  required
                  value={manualDeadline}
                  onChange={(e) => setManualDeadline(e.target.value)}
                  className="w-full bg-[#FAFAFA] border border-[#E6E6E4] rounded-xl p-3 text-xs outline-none focus:border-stone-400 transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Estimated Duration</label>
                <select
                  value={manualEst}
                  onChange={(e) => setManualEst(Number(e.target.value))}
                  className="w-full bg-[#FAFAFA] border border-[#E6E6E4] rounded-xl p-3 text-xs outline-none focus:border-stone-400 transition-colors"
                >
                  <option value={15}>15 Minutes</option>
                  <option value={30}>30 Minutes</option>
                  <option value={45}>45 Minutes</option>
                  <option value={60}>1 Hour</option>
                  <option value={90}>1.5 Hours</option>
                  <option value={120}>2 Hours</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">Description / DELIVERABLES</label>
                <textarea
                  value={manualDesc}
                  onChange={(e) => setManualDesc(e.target.value)}
                  placeholder="Insert additional notes, reference chapters, or team contacts..."
                  className="w-full bg-[#FAFAFA] border border-[#E6E6E4] rounded-xl p-3 text-xs outline-none focus:border-stone-400 transition-colors h-24 resize-none"
                />
              </div>

              <div className="md:col-span-2">
                <label className="flex justify-between text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-2">
                  <span>Priority Importance (1-100)</span>
                  <span className="text-indigo-600 font-mono font-bold">{manualScore}</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={manualScore}
                  onChange={(e) => setManualScore(Number(e.target.value))}
                  className="w-full h-1.5 bg-stone-200 rounded-xl accent-indigo-600 cursor-pointer"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-3.5 px-6 rounded-xl shadow-sm transition-all mt-4"
            >
              Secure Objective to Agenda
            </button>
          </form>
        )}

        {/* VOICE DICTATION VIEW */}
        {activeMode === "voice" && (
          <div className="flex flex-col gap-8 py-4">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Option A: AI Voice Intelligent Recorder (Server pipeline) */}
              <div className="border border-indigo-100 bg-indigo-50/20 rounded-2xl p-6 flex flex-col items-center text-center gap-4 hover:border-indigo-300 transition-colors">
                <div className="relative">
                  <span className={`absolute inset-0 rounded-full bg-indigo-200/50 scale-125 transition-all ${isRecordingAudio ? "animate-ping" : "hidden"}`} />
                  <button
                    onClick={isRecordingAudio ? stopRecordingAudio : startRecordingAudio}
                    disabled={voiceExtractLoading}
                    className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-sm ${
                      isRecordingAudio ? "bg-[#EA4335] text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white"
                    } disabled:opacity-50`}
                  >
                    {voiceExtractLoading ? (
                      <RefreshCw className="w-6 h-6 animate-spin" />
                    ) : isRecordingAudio ? (
                      <MicOff className="w-6 h-6" />
                    ) : (
                      <Mic className="w-6 h-6" />
                    )}
                  </button>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-indigo-950 flex items-center justify-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" /> AI Intelligent Recorder
                  </h4>
                  <p className="text-gray-550 text-[11px] mt-1 line-clamp-2">
                    Records audio block on any device and requests Gemini to structure deadlines, priorities, and details directly.
                  </p>
                </div>
                {isRecordingAudio && <span className="text-[10px] text-red-650 font-mono font-bold animate-pulse">● RECORDING IN PROGRESS</span>}
              </div>

              {/* Option B: Standard Browser Dictation */}
              <div className="border border-stone-150 bg-stone-50/20 rounded-2xl p-6 flex flex-col items-center text-center gap-4 hover:border-stone-300 transition-colors">
                <div className="relative">
                  <span className={`absolute inset-0 rounded-full bg-stone-200/50 scale-125 transition-all ${recognizing ? "animate-ping" : "hidden"}`} />
                  <button
                    onClick={toggleVoiceRecording}
                    disabled={!speechSupported}
                    className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-sm ${
                      recognizing ? "bg-[#EA4335] text-white" : "bg-stone-800 hover:bg-stone-900 text-white"
                    } disabled:opacity-30`}
                  >
                    {recognizing ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                  </button>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-stone-900">Browser Dictation</h4>
                  <p className="text-gray-550 text-[11px] mt-1 line-clamp-2">
                    Real-time local speech-to-text. Requires chrome or safari engine with system microphone lines active.
                  </p>
                </div>
                {recognizing && <span className="text-[10px] text-amber-600 font-bold animate-pulse">● DICTATION ACTIVE</span>}
                {!speechSupported && <span className="text-[10px] text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded">Not supported on this browser</span>}
              </div>

            </div>

            {/* Transcription Logging Display */}
            {voiceText && (
              <div className="w-full bg-[#F9F9F8] border border-[#E6E6E4] rounded-xl p-4 text-xs italic text-stone-700 font-sans leading-relaxed text-center">
                "{voiceText}"
              </div>
            )}

            {voiceExtractError && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-xs text-center font-medium">
                {voiceExtractError}
              </div>
            )}

            {voiceText && !recognizing && !isRecordingAudio && !voiceExtractLoading && (
              <form onSubmit={handleSaveManual} className="w-full text-left border-t border-stone-150 pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">Confirm Title</label>
                    <input
                      type="text"
                      required
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                      className="w-full bg-white border border-[#E6E6E4] rounded-xl p-3 text-xs outline-none focus:border-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">Confirm Deadline</label>
                    <input
                      type="datetime-local"
                      required
                      value={manualDeadline}
                      onChange={(e) => setManualDeadline(e.target.value)}
                      className="w-full bg-white border border-[#E6E6E4] rounded-xl p-3 text-xs outline-none focus:border-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">Duration estimate (minutes)</label>
                    <input
                      type="number"
                      value={manualEst}
                      onChange={(e) => setManualEst(Number(e.target.value))}
                      className="w-full bg-white border border-[#E6E6E4] rounded-xl p-3 text-xs outline-none focus:border-indigo-400"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-3.5 px-6 rounded-xl transition-all"
                >
                  Secure Voice Extracted Task to Lifeline
                </button>
              </form>
            )}

          </div>
        )}

        {/* MULTIMODAL SYLLABUS LENS UPLOAD VIEW */}
        {activeMode === "photo" && (
          <div className="flex flex-col gap-6">
            
            <div className="border-2 border-dashed border-[#E6E6E4] rounded-2xl p-8 text-center bg-[#FAFAFA] hover:bg-[#F9F9F8] transition-colors relative">
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={handleUploadedPhoto}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                disabled={uploadLoading}
              />
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-4 border border-[#E6E6E4]">
                <Upload className="w-5 h-5 text-indigo-600" />
              </div>
              <h3 className="text-sm font-semibold text-[#2D2D2D]">Drop syllabus, calendar snapshot or handwritten note</h3>
              <p className="text-gray-400 text-xs mt-1">Accepts PDF or images (PNG, JPEG up to 20MB)</p>
            </div>

            {uploadLoading && (
              <div className="flex items-center justify-center gap-3 py-6">
                <RefreshCw className="w-5 h-5 text-indigo-600 animate-spin" />
                <span className="text-xs text-[#2D2D2D] font-medium">Gemini Lens extracting syllabus objectives...</span>
              </div>
            )}

            {uploadError && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-red-700 text-xs text-center font-medium">
                {uploadError}
              </div>
            )}

            {/* EXTRACTED TASKS PREVIEW DRAFTS */}
            {extractedDrafts.length > 0 && (
              <div className="mt-4 flex flex-col gap-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h3 className="text-sm font-semibold text-[#2D2D2D] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-600 animate-bounce" /> Extracted Tasks Drafts
                  </h3>
                  <button
                    onClick={saveAllExtractedDrafts}
                    className="text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-150 p-1.5 px-3 rounded-xl"
                  >
                    Accept All
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  {extractedDrafts.map((draft, idx) => (
                    <div key={idx} className="p-4 rounded-xl border border-[#E6E6E4] bg-[#FAFAFA] flex justify-between items-center gap-4 hover:border-indigo-300 hover:shadow-sm transition-all">
                      <div>
                        <div className="text-xs font-semibold text-[#2D2D2D]">{draft.title}</div>
                        <div className="text-[10px] text-gray-400 mt-1 flex flex-wrap gap-2">
                          <span>EST: {draft.estimatedMinutes || 30}m</span>
                          <span>•</span>
                          <span>Priority: {draft.priorityScore || 50}</span>
                          {draft.deadline && (
                            <>
                              <span>•</span>
                              <span className="text-indigo-700 font-semibold bg-indigo-50 px-1 rounded">
                                Deadline: {new Date(draft.deadline).toLocaleDateString()}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => saveExtractedDraft(idx)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl p-2 px-3 text-xs font-semibold flex items-center gap-1 shrink-0"
                      >
                        <Check className="w-3.5 h-3.5" /> Confirm
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

      </div>

    </div>
  );
}
