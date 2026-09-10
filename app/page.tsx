"use client";

import RegisterForm from "./RegisterForm";
import { useState, useEffect, useCallback, FormEvent, ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import { loginUser, sendQuery, uploadPdf, changePassword, getRegisteredUsers } from "./api";

interface Message {
  role: "user" | "assistant";
  content: string;
  chunks?: string[];
}

interface ChatSession {
  id: number;
  title: string;
}

interface UserItem {
  username: string;
  role: string;
}

export default function Home() {
  // Auth States
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("access_token");
    return null;
  });
  const [role, setRole] = useState<string | null>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("role");
    return null;
  });

  const [isRegistering, setIsRegistering] = useState<boolean>(false);

  const [loginUsername, setLoginUsername] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [loginError, setLoginError] = useState<string>("");
  const [loadingLogin, setLoadingLogin] = useState<boolean>(false);

  // App States
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [loadingUpload, setLoadingUpload] = useState<boolean>(false);
  
  const [inputQuery, setInputQuery] = useState<string>("");
  const [loadingQuery, setLoadingQuery] = useState<boolean>(false);

  // Admin Modal States
  const [showAdminModal, setShowAdminModal] = useState<boolean>(false);
  const [adminTab, setAdminTab] = useState<"users" | "password">("users");
  
  // Change Password Form States
  const [oldPassword, setOldPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [passMsg, setPassMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [loadingPass, setLoadingPass] = useState<boolean>(false);

  // Users List States
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [loadingUsers, setLoadingUsers] = useState<boolean>(false);
  const [usersError, setUsersError] = useState<string>("");

  // Chat Sessions & Active ID
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("copilot_sessions");
      if (saved) {
        try { return JSON.parse(saved); } catch { /* ignore */ }
      }
    }
    return [{ id: 1, title: "Workspace / Enterprise Session" }];
  });

  const [activeSessionId, setActiveSessionId] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const savedActive = localStorage.getItem("copilot_active_id");
      if (savedActive) {
        try { return JSON.parse(savedActive); } catch { /* ignore */ }
      }
    }
    return 1;
  });

  // Messages map per session ID
  const [sessionMessages, setSessionMessages] = useState<Record<number, Message[]>>(() => {
    if (typeof window !== "undefined") {
      const savedMessages = localStorage.getItem("copilot_session_messages");
      if (savedMessages) {
        try { return JSON.parse(savedMessages); } catch { /* ignore */ }
      }
    }
    return {
      1: [{ role: "assistant", content: "Hello! I am your Enterprise Knowledge Copilot. Ask me anything." }]
    };
  });

  // Save to LocalStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("copilot_sessions", JSON.stringify(sessions));
      localStorage.setItem("copilot_active_id", JSON.stringify(activeSessionId));
      localStorage.setItem("copilot_session_messages", JSON.stringify(sessionMessages));
    }
  }, [sessions, activeSessionId, sessionMessages]);

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    setUsersError("");
    try {
      const data = await getRegisteredUsers();
      setUsersList(Array.isArray(data) ? data : data.users || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load users";
      setUsersError(msg);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (showAdminModal && adminTab === "users" && role === "admin") {
      queueMicrotask(() => {
        fetchUsers();
      });
    }
  }, [showAdminModal, adminTab, role, fetchUsers]);

  const messages = sessionMessages[activeSessionId] || [
    { role: "assistant", content: "Hello! I am your Enterprise Knowledge Copilot. Ask me anything." }
  ];

  const updateCurrentMessages = (newMessages: Message[] | ((prev: Message[]) => Message[])) => {
    setSessionMessages(prev => {
      const current = prev[activeSessionId] || [];
      const updated = typeof newMessages === "function" ? newMessages(current) : newMessages;
      return { ...prev, [activeSessionId]: updated };
    });
  };

  // Login Handler
  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoadingLogin(true);
    setLoginError("");

    try {
      const data = await loginUser(loginUsername, loginPassword);
      setToken(data.access_token);
      setRole(data.role);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Invalid credentials";
      setLoginError(errorMsg);
    } finally {
      setLoadingLogin(false);
    }
  };

  // Logout Handler
  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("role");
    setToken(null);
    setRole(null);
  };

  // Delete Session Handler
  const handleDeleteSession = (id: number, ev: React.MouseEvent) => {
    ev.stopPropagation();
    const updatedSessions = sessions.filter(session => session.id !== id);
    const updatedMessagesMap = { ...sessionMessages };
    delete updatedMessagesMap[id];

    if (updatedSessions.length === 0) {
      const defaultId = 1;
      setSessions([{ id: defaultId, title: "Workspace / Enterprise Session" }]);
      setActiveSessionId(defaultId);
      setSessionMessages({
        [defaultId]: [{ role: "assistant", content: "Hello! I am your Enterprise Knowledge Copilot. Ask me anything." }]
      });
    } else {
      setSessions(updatedSessions);
      setSessionMessages(updatedMessagesMap);
      if (activeSessionId === id) {
        setActiveSessionId(updatedSessions[0].id);
      }
    }
  };

  // Add New Session Handler
  const handleNewChat = () => {
    const newId = Date.now();
    setSessions(prev => [...prev, { id: newId, title: `Session ${prev.length + 1}` }]);
    setActiveSessionId(newId);
    setSessionMessages(prev => ({
      ...prev,
      [newId]: [{ role: "assistant", content: "Hello! I am your Enterprise Knowledge Copilot. Ask me anything." }]
    }));
  };

  // PDF Upload Handler (Admin Only)
  const handleUpload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return;

    setLoadingUpload(true);
    setUploadStatus("");

    try {
      const data = await uploadPdf(file);
      setUploadStatus(`Success: ${data.filename} indexed (${data.total_chunks} chunks).`);
      setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, title: data.filename } : s));
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to upload";
      setUploadStatus(`Error: ${errorMessage}`);
    } finally {
      setLoadingUpload(false);
    }
  };

  // Password Change Handler
  const handlePasswordChangeSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoadingPass(true);
    setPassMsg(null);

    try {
      await changePassword(oldPassword, newPassword);
      setPassMsg({ text: "Password successfully updated!", isError: false });
      setOldPassword("");
      setNewPassword("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update password";
      setPassMsg({ text: msg, isError: true });
    } finally {
      setLoadingPass(false);
    }
  };

  // Query Handler
  const handleSend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inputQuery.trim() || loadingQuery) return;

    const userQuestion = inputQuery;
    setInputQuery("");
    
    updateCurrentMessages(prev => [...prev, { role: "user", content: userQuestion }]);
    setLoadingQuery(true);

    try {
      const data = await sendQuery(userQuestion);
      updateCurrentMessages(prev => [
        ...prev,
        { role: "assistant", content: data.ai_answer, chunks: data.relevant_chunks }
      ]);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to get answer.";
      updateCurrentMessages(prev => [
        ...prev,
        { role: "assistant", content: `Error: ${errorMessage}` }
      ]);
    } finally {
      setLoadingQuery(false);
    }
  };

  // If Not Logged In, Show Enterprise Login Screen or Register Screen
  if (!token) {
    return (
      <div className="flex h-screen bg-neutral-900 text-neutral-100 items-center justify-center font-sans">
        {isRegistering ? (
          <RegisterForm 
            onRegisterSuccess={() => setIsRegistering(false)} 
            onSwitchToLogin={() => setIsRegistering(false)} 
          />
        ) : (
          <div className="w-full max-w-md p-8 bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl">
            <div className="flex items-center gap-3 mb-6 justify-center">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg text-lg">
                E
              </div>
              <h1 className="font-bold text-xl text-white">Enterprise Knowledge Copilot</h1>
            </div>
            <p className="text-xs text-neutral-400 text-center mb-6">Secure Sign-In required to access knowledge base.</p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Username</label>
                <input 
                  type="text" 
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="e.g. admin" 
                  required
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Password</label>
                <input 
                  type="password" 
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••" 
                  required
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-600"
                />
              </div>

              {loginError && (
                <p className="text-xs text-red-400 text-center">{loginError}</p>
              )}

              <button 
                type="submit" 
                disabled={loadingLogin}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 text-white rounded-xl text-sm font-medium transition shadow-lg mt-2"
              >
                {loadingLogin ? "Authenticating..." : "Sign In"}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button 
                onClick={() => setIsRegistering(true)}
                className="text-xs text-indigo-400 hover:underline"
              >
                Don&apos;t have an account? Register Now
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Main Authenticated Layout
  return (
    <div className="flex h-screen bg-neutral-900 text-neutral-100 font-sans overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-72 bg-neutral-950 border-r border-neutral-800 flex flex-col p-4 justify-between">
        <div>
          <div className="flex items-center justify-between mb-6 px-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg">
                E
              </div>
              <h1 className="font-semibold text-lg tracking-wide text-white">Knowledge Copilot</h1>
            </div>
          </div>

          {/* New Chat Button */}
          <button 
            onClick={handleNewChat}
            className="w-full mb-6 py-2 px-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-200 rounded-xl text-xs font-medium transition flex items-center justify-center gap-2"
          >
            <span>+ New Session</span>
          </button>

          {/* Admin Management Button */}
          {role === "admin" && (
            <div className="mb-6 px-1">
              <button 
                onClick={() => setShowAdminModal(true)}
                className="w-full py-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-indigo-400 rounded-xl text-xs font-medium transition flex items-center justify-center gap-2 shadow"
              >
                ⚙️ Admin Dashboard
              </button>
            </div>
          )}

          {/* Chat History List */}
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3 px-2">Chat History</h2>
            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {sessions.map((session) => (
                <div 
                  key={session.id}
                  onClick={() => setActiveSessionId(session.id)}
                  className={`group flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition ${
                    activeSessionId === session.id 
                      ? "bg-neutral-900 text-white font-medium border border-neutral-800" 
                      : "text-neutral-400 hover:bg-neutral-900/50 hover:text-neutral-200"
                  }`}
                >
                    <span className="truncate flex-1">{session.title}</span>
                    <button 
                      onClick={(e) => handleDeleteSession(session.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400 p-1 transition"
                      title="Delete Session"
                    >
                      🗑️
                    </button>
                </div>
              ))}
            </div>
          </div>

          {/* Upload Document Section */}
          {role === "admin" && (
            <div className="mb-6">
              <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3 px-2">Upload Document (Admin)</h2>
              <form onSubmit={handleUpload} className="flex flex-col gap-3 bg-neutral-900 p-3 rounded-xl border border-neutral-800">
                <input 
                  type="file" 
                  accept=".pdf" 
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] || null)}
                  className="text-xs text-neutral-400 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer"
                />
                <button 
                  type="submit" 
                  disabled={loadingUpload || !file}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 text-white rounded-lg text-xs font-medium transition shadow-md"
                >
                  {loadingUpload ? "Indexing..." : "Index PDF"}
                </button>
              </form>
              {uploadStatus && (
                <p className={`text-xs mt-2 px-2 ${uploadStatus.startsWith("Success") ? "text-green-400" : "text-red-400"}`}>
                  {uploadStatus}
                </p>
              )}
            </div>
          )}
        </div>

        {/* User Info & Logout */}
        <div className="border-t border-neutral-800 pt-4 px-2 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-white capitalize">Role: {role}</p>
            <p className="text-[10px] text-neutral-500">Secure Enterprise RAG</p>
          </div>
          <button 
            onClick={handleLogout}
            className="px-3 py-1.5 bg-neutral-900 hover:bg-red-500/20 hover:text-red-400 border border-neutral-800 text-neutral-400 rounded-lg text-xs transition"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col bg-neutral-900 relative">
        
        {/* Header */}
        <header className="h-14 border-b border-neutral-800 flex items-center px-6 bg-neutral-900/80 backdrop-blur-md">
          <span className="text-sm font-medium text-neutral-300">
            Workspace / {sessions.find(s => s.id === activeSessionId)?.title || "Enterprise Session"}
          </span>
        </header>

        {/* Message History */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 flex flex-col items-center">
          <div className="w-full max-w-3xl space-y-6">
            {messages.map((msg, index) => (
              <div 
                key={index} 
                className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 font-bold text-xs text-white">
                    AI
                  </div>
                )}
                
                <div className={`max-w-[80%] rounded-2xl px-5 py-3.5 text-sm leading-relaxed shadow-sm ${
                  msg.role === "user" 
                    ? "bg-indigo-600 text-white rounded-br-none" 
                    : "bg-neutral-800 border border-neutral-700 text-neutral-200 rounded-bl-none"
                }`}>
                  <div className="markdown-content prose prose-invert max-w-none text-sm">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>

                  {msg.chunks && msg.chunks.length > 0 && (
                    <details className="mt-3 pt-3 border-t border-neutral-700 text-xs text-neutral-400">
                      <summary className="cursor-pointer hover:text-indigo-400 font-medium">View Source Chunks</summary>
                      <div className="mt-2 space-y-2">
                        {msg.chunks.map((chunk, cIndex) => (
                          <div key={cIndex} className="p-2 bg-neutral-950 rounded border border-neutral-800 text-[11px] text-neutral-300">
                            {chunk}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-neutral-700 flex items-center justify-center shrink-0 font-bold text-xs text-white">
                    You
                  </div>
                )}
              </div>
            ))}

            {loadingQuery && (
              <div className="flex gap-4 justify-start">
                <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 font-bold text-xs text-white">
                  AI
                </div>
                <div className="bg-neutral-800 border border-neutral-700 text-neutral-400 rounded-2xl px-5 py-3.5 text-sm animate-pulse">
                  Thinking and searching documents...
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input Bar */}
        <div className="p-4 bg-neutral-900 border-t border-neutral-800 flex justify-center">
          <form onSubmit={handleSend} className="w-full max-w-3xl flex gap-2 bg-neutral-800 border border-neutral-700 rounded-xl p-2 shadow-lg">
            <input 
              type="text" 
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="Ask anything about your document..."
              className="flex-1 bg-transparent px-3 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none"
            />
            <button 
              type="submit" 
              disabled={loadingQuery || !inputQuery.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 text-white rounded-lg text-sm font-medium transition shadow"
            >
              Send
            </button>
          </form>
        </div>

    </main>

    {/* Admin Dashboard Modal */}
    {showAdminModal && (
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
          
          {/* Modal Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/50">
            <h2 className="font-semibold text-sm text-white flex items-center gap-2">
              ⚙️ Admin Management Dashboard
            </h2>
            <button 
              onClick={() => setShowAdminModal(false)}
              className="text-neutral-400 hover:text-white text-sm px-2 py-1 rounded-lg transition"
            >
              ✕
            </button>
          </div>

          {/* Modal Tabs */}
          <div className="flex border-b border-neutral-800 bg-neutral-900/20 px-6 pt-2 gap-4">
            <button
              onClick={() => setAdminTab("users")}
              className={`pb-3 text-xs font-medium border-b-2 transition ${
                adminTab === "users" 
                  ? "border-indigo-600 text-white" 
                  : "border-transparent text-neutral-400 hover:text-neutral-200"
              }`}
            >
              👥 Registered Users
            </button>
            <button
              onClick={() => setAdminTab("password")}
              className={`pb-3 text-xs font-medium border-b-2 transition ${
                adminTab === "password" 
                  ? "border-indigo-600 text-white" 
                  : "border-transparent text-neutral-400 hover:text-neutral-200"
              }`}
            >
              🔒 Change Password
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-6 max-h-[60vh] overflow-y-auto">
            {adminTab === "users" ? (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <p className="text-xs text-neutral-400">List of accounts registered in the system:</p>
                  <button 
                    onClick={fetchUsers} 
                    className="text-xs text-indigo-400 hover:underline"
                  >
                    🔄 Refresh List
                  </button>
                </div>

                {loadingUsers ? (
                  <p className="text-xs text-neutral-400 text-center py-6 animate-pulse">Loading registered users...</p>
                ) : usersError ? (
                  <p className="text-xs text-red-400 text-center py-4">{usersError}</p>
                ) : usersList.length === 0 ? (
                  <p className="text-xs text-neutral-500 text-center py-4">No users found.</p>
                ) : (
                  <div className="border border-neutral-800 rounded-xl overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-neutral-900 border-b border-neutral-800 text-neutral-400">
                          <th className="p-3 font-medium">Username</th>
                          <th className="p-3 font-medium">Role</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usersList.map((u, i) => (
                          <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-900/30">
                            <td className="p-3 text-neutral-200 font-medium">{u.username}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                u.role === "admin" ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" : "bg-neutral-800 text-neutral-300"
                              }`}>
                                {u.role}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handlePasswordChangeSubmit} className="space-y-4">
                <p className="text-xs text-neutral-400 mb-2">Update your secure admin credentials.</p>
                <div>
                  <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">Old Password</label>
                  <input 
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">New Password</label>
                  <input 
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-600"
                  />
                </div>

                {passMsg && (
                  <p className={`text-xs ${passMsg.isError ? "text-red-400" : "text-green-400"}`}>
                    {passMsg.text}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loadingPass}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 text-white rounded-xl text-sm font-medium transition shadow-lg mt-2"
                >
                  {loadingPass ? "Updating Password..." : "Update Password"}
                </button>
              </form>
            )}
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-3 border-t border-neutral-800 bg-neutral-900/50 flex justify-end">
            <button 
              onClick={() => setShowAdminModal(false)}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-medium transition"
            >
              Close
            </button>
          </div>

        </div>
      </div>
    )}

  </div>
);
}