import React from "react";
import { googleSignIn, guestSignIn } from "../firebase";
import { LogIn } from "lucide-react";

interface SignInProps {
  onSignInSuccess: (user: any, token: string | null) => void;
}

export default function SignIn({ onSignInSuccess }: SignInProps) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await googleSignIn();
      if (res) {
        onSignInSuccess(res.user, res.accessToken);
      }
    } catch (err: any) {
      console.error("Sign-In Error Caught:", err);
      const errCode = err?.code || "";
      const errMsg = err?.message || "";
      
      if (errCode === "auth/popup-blocked" || errMsg.includes("popup-blocked") || errMsg.includes("popup_blocked")) {
        setError("POPUP_BLOCKED");
      } else if (errCode === "auth/popup-closed-by-user" || errMsg.includes("popup-closed-by-user") || errMsg.includes("cancelled-by-user")) {
        setError("The login window was closed before completing. Please try again and complete the Google prompt.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to sign in. Please verify your internet connection or Google Auth settings.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGuestSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const user = await guestSignIn();
      onSignInSuccess(user, null);
    } catch (err: any) {
      console.error("Guest Sign-In Error Caught:", err);
      setError(err instanceof Error ? err.message : "Failed to sign in as Guest. Anonymous sessions may be disabled in Firebase console.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="signin_screen" className="min-h-screen flex items-center justify-center bg-[#F9F9F8] px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-[#E6E6E4] p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
            <div className="w-1.5 h-6 bg-white rounded-full"></div>
          </div>
        </div>

        <h1 className="text-2xl font-sans font-semibold tracking-tight text-[#2D2D2D] mb-2">
          Lifeline
        </h1>
        <p className="text-gray-500 font-sans text-sm mb-8 leading-relaxed max-w-xs mx-auto">
          An active AI planning companion designed to protect your commitments and conquer deadlines stress-free.
        </p>

        {error && error === "POPUP_BLOCKED" ? (
          <div className="bg-indigo-50 text-[#2D2D2D] text-xs rounded-xl p-4 mb-6 font-sans text-left border border-indigo-150 shadow-sm animate-fade-in">
            <h3 className="font-semibold text-indigo-950 mb-1.5 flex items-center gap-1.5">
              💡 Google Sign-In Protected
            </h3>
            <p className="text-gray-650 leading-relaxed mb-2.5">
              Because this application is running inside a sandboxed preview iframe, the browser's popup blocker has restricted the Google authentication window.
            </p>
            <div className="bg-white/80 p-2.5 rounded-lg border border-[#E6E6E4]/50 leading-relaxed text-[11px] text-gray-550 flex flex-col gap-1.5">
              <p>
                <strong>Option 1 (Recommended)</strong>: Click the <strong className="text-indigo-600">"Open in New Tab"</strong> button in the top-right corner of the preview area, and sign in there.
              </p>
              <div className="h-[1px] bg-stone-100" />
              <p>
                <strong>Option 2</strong>: Click the <strong className="text-indigo-600">"Always allow popups"</strong> option in your browser's address bar settings and click Sign In again.
              </p>
            </div>
          </div>
        ) : error && (
          <div className="bg-red-50 text-red-600 text-xs rounded-xl p-3 mb-6 font-sans text-left border border-red-100 shadow-sm">
            {error}
          </div>
        )}

        {/* Official-looking Google GSI button style as mandated by the Workspace skill */}
        <button
          id="google_signin_btn"
          disabled={loading}
          onClick={handleSignIn}
          className="w-full inline-flex items-center justify-center gap-3 bg-[#4285F4] hover:bg-[#357ae8] active:bg-[#1f5ec9] text-white py-3 px-5 rounded-xl text-sm font-medium font-sans shadow-sm transition-colors duration-200 disabled:opacity-75 disabled:cursor-not-allowed"
        >
          {loading ? (
            <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-5 h-5 bg-white p-1 rounded shrink-0">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
              <path fill="none" d="M0 0h48v48H0z"></path>
            </svg>
          )}
          <span className="font-sans">Sign in with Google</span>
        </button>

        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-stone-200/60"></div>
          </div>
          <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
            <span className="bg-white px-2.5 text-stone-400 font-semibold">OR</span>
          </div>
        </div>

        <button
          id="guest_signin_btn"
          disabled={loading}
          onClick={handleGuestSignIn}
          className="w-full inline-flex items-center justify-center gap-2 bg-[#FAFAFA] hover:bg-[#F4F4F3] text-stone-700 py-3 px-5 rounded-xl text-xs font-semibold font-sans border border-[#E6E6E4] shadow-sm transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          <LogIn className="w-4 h-4 text-stone-500" />
          <span>Continue as Guest (Sandbox Sandbox Mode)</span>
        </button>

        <p className="text-[11px] text-stone-400 font-sans mt-6 leading-relaxed">
          Accessing Google Calendar permits proactive timing lock. Lifeline takes data safety seriously. Guest mode does not sync to Google Calendar.
        </p>
      </div>
    </div>
  );
}
