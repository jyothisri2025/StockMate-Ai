import mammoth from "mammoth";
import Tesseract from "tesseract.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

function authHeaders(extra = {}) {
  return { ...extra, Authorization: `Bearer ${localStorage.getItem("stockmate-token") || ""}` };
}

async function readResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    localStorage.removeItem("stockmate-token");
    if (window.location.pathname !== "/login") window.location.assign("/login");
  }
  if (!response.ok) throw new Error(payload.error || fallbackMessage);
  return payload;
}

export async function login(username, password) {
  const response = await fetch(`${API_URL}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Login failed");
  localStorage.setItem("stockmate-token", payload.token);
  return payload;
}

export async function importInventoryText(text, filename = "manual-import.txt") {
  const response = await fetch(`${API_URL}/api/import`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ filename, text, source: "text" })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not import inventory");
  return payload.inventory;
}

export async function importMasterListText(text, filename = "master-list.csv") {
  const response = await fetch(`${API_URL}/api/master-list`, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ filename, text }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not process Master List");
  return payload;
}

export async function importInventoryFile(file) {
  const extension = (file.name.split(".").pop() || "").toLowerCase();

  if (["xlsx", "xls", "csv"].includes(extension)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const response = await fetch(`${API_URL}/api/import`, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ filename: file.name, data: btoa(binary) }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not import inventory");
    return payload.inventory;
  }

  if (extension === "docx") {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return importInventoryText(result.value || "", file.name);
  }

  if (["txt", "md"].includes(extension)) {
    return importInventoryText(await file.text(), file.name);
  }

  if (["png", "jpg", "jpeg", "webp"].includes(extension)) {
    const { data } = await Tesseract.recognize(file, "eng");
    return importInventoryText(data.text || "", file.name);
  }

  throw new Error("Unsupported file type. Use Excel, Word, text, or image files.");
}

export async function importMasterListFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  const response = await fetch(`${API_URL}/api/master-list`, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ filename: file.name, data: btoa(binary) }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not process Master List");
  return payload;
}

export async function fetchInventory() {
  const response = await fetch(`${API_URL}/api/inventory`, { headers: authHeaders() });
  return (await readResponse(response, "Could not load inventory")).inventory;
}

export async function askStocky(message) {
  const response = await fetch(`${API_URL}/api/agent`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ message })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Stocky is unavailable");
  return payload;
}

export async function fetchHistory() {
  const response = await fetch(`${API_URL}/api/history`, { headers: authHeaders() });
  if (!response.ok) throw new Error("Could not load history");
  return (await response.json()).history;
}

export async function mutateInventory(change) {
  const response = await fetch(`${API_URL}/api/inventory/mutate`, { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(change) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not update inventory");
  return payload;
}

export async function fetchChatHistory() {
  const response = await fetch(`${API_URL}/api/chat-history`, { headers: authHeaders() });
  if (!response.ok) throw new Error("Could not load recent chat");
  return (await response.json()).history;
}

export async function fetchActivity() {
  const response = await fetch(`${API_URL}/api/activity`, { headers: authHeaders() });
  if (!response.ok) throw new Error("Could not load activity");
  return response.json();
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: authHeaders({ "Content-Type": "application/json", ...(options.headers || {}) }) });
  return readResponse(response, "Request failed");
}

export async function fetchVendors() { return (await apiRequest("/api/vendors")).vendors; }
export async function createVendor(vendor) { return (await apiRequest("/api/vendors", { method: "POST", body: JSON.stringify(vendor) })).vendor; }
export async function updateVendor(vendorId, vendor) { return (await apiRequest(`/api/vendors/${encodeURIComponent(vendorId)}`, { method: "PUT", body: JSON.stringify(vendor) })).vendor; }
export async function fetchPurchases() { return (await apiRequest("/api/purchases")).purchases; }
export async function createPurchase(purchase) { return apiRequest("/api/purchases", { method: "POST", body: JSON.stringify(purchase) }); }
export async function fetchIssues() { return (await apiRequest("/api/issues")).issues; }
export async function createIssue(issue) { return apiRequest("/api/issues", { method: "POST", body: JSON.stringify(issue) }); }
export async function fetchDailyReport(date) { return apiRequest(`/api/reports/daily?date=${encodeURIComponent(date)}`); }
export async function fetchMonthlyReport(month) { return apiRequest(`/api/reports/monthly?month=${encodeURIComponent(month)}`); }
export async function fetchDepartmentReport() { return apiRequest("/api/reports/departments"); }
export async function fetchVendorReport() { return apiRequest("/api/reports/vendors"); }