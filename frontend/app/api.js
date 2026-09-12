const API_BASE_URL = "https://enterprise-knowledge-copilot-la27.onrender.com";

// 1. Login Function (टोकन सेव करने के लिए)
export async function loginUser(username: string, password: string) {
  const formData = new URLSearchParams();
  formData.append("username", username);
  formData.append("password", password);

  const response = await fetch(`${API_BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Login failed! Invalid username or password.");
  }

  const data = await response.json();
  // ब्राउज़र में टोकन और रोल सेव कर लो
  localStorage.setItem("access_token", data.access_token);
  localStorage.setItem("role", data.role);
  return data;
}

// 2. Query/Chat Function (टोकन हेडर के साथ भेजेगा)
export async function sendQuery(question: string) {
  const token = localStorage.getItem("access_token");

  const response = await fetch(`${API_BASE_URL}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ question }),
  });

  if (!response.ok) {
    throw new Error("Session expired or unauthorized. Please login again.");
  }

  return await response.json();
}

// 3. PDF Upload Function (सिर्फ Admin के लिए)
export async function uploadPdf(fileObject: File) {
  const token = localStorage.getItem("access_token");
  const formData = new FormData();
  formData.append("file", fileObject);

  const response = await fetch(`${API_BASE_URL}/api/upload`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`
    },
    body: formData,
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || "Upload failed. Make sure you are logged in as admin.");
  }

  return await response.json();
}

// 4. Change Password Function (नया पासवर्ड अपडेट करने के लिए)
export async function changePassword(oldPassword: string, newPassword: string) {
  const token = localStorage.getItem("access_token");

  const response = await fetch(`${API_BASE_URL}/api/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.detail || "Failed to change password.");
  }

  return await response.json();
}

// 5. Get Registered Users Function (सिर्फ Admin के लिए यूजर्स लिस्ट देखने के लिए)
export async function getRegisteredUsers() {
  const token = localStorage.getItem("access_token");

  const response = await fetch(`${API_BASE_URL}/api/users`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch registered users. Make sure you are admin.");
  }

  return await response.json();
}