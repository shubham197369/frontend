"use client";

import { useState, FormEvent } from "react";

interface RegisterFormProps {
  onRegisterSuccess: () => void;
  onSwitchToLogin: () => void;
}

export default function RegisterForm({ onRegisterSuccess, onSwitchToLogin }: RegisterFormProps) {
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  const handleRegister = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("http://localhost:8000/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Registration failed");
      }

      setSuccess("Registration successful! You can now sign in.");
      setUsername("");
      setPassword("");
      setTimeout(() => {
        onRegisterSuccess();
      }, 1500);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Something went wrong";
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl">
      <div className="flex items-center gap-3 mb-6 justify-center">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg text-lg">
          E
        </div>
        <h1 className="font-bold text-xl text-white">Create Account</h1>
      </div>
      <p className="text-xs text-neutral-400 text-center mb-6">
        Register a new account to access the Enterprise Knowledge Copilot.
      </p>

      <form onSubmit={handleRegister} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Username</label>
          <input 
            type="text" 
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. johndoe" 
            required
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-600"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Password</label>
          <input 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••" 
            required
            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-600"
          />
        </div>

        {error && <p className="text-xs text-red-400 text-center">{error}</p>}
        {success && <p className="text-xs text-green-400 text-center">{success}</p>}

        <button 
          type="submit" 
          disabled={loading}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 text-white rounded-xl text-sm font-medium transition shadow-lg mt-2"
        >
          {loading ? "Creating Account..." : "Register Account"}
        </button>
      </form>

      <div className="mt-6 text-center">
        <button 
          onClick={onSwitchToLogin}
          className="text-xs text-indigo-400 hover:underline"
        >
          Already have an account? Sign In
        </button>
      </div>
    </div>
  );
}