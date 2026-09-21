import mammoth from "mammoth";
import Tesseract from "tesseract.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

function authHeaders(extra = {}) {
  return { ...extra, Authorization: `Bearer ${localStorage.getItem("stockmate-token") || ""}` };
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

export async function fetchInventory() {
  const response = await fetch(`${API_URL}/api/inventory`, { headers: authHeaders() });
  if (!response.ok) throw new Error("Could not load inventory");
  return (await response.json()).inventory;
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