import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as XLSX from "xlsx";

const port = Number(process.env.PORT || 8787);
const dataPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "inventory.json");
const backupPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "inventory.backup.json");
const historyPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "history.json");
const chatPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "chat-history.json");
const sessions = new Set();

function readInventory() {
  if (!existsSync(dataPath) && existsSync(backupPath)) {
    const backup = JSON.parse(readFileSync(backupPath, "utf8"));
    writeFileSync(dataPath, JSON.stringify(backup, null, 2));
    return backup;
  }
  if (!existsSync(dataPath)) {
    writeFileSync(dataPath, "[]");
  }
  const inventory = JSON.parse(readFileSync(dataPath, "utf8"));
  if (Array.isArray(inventory) && inventory.length === 0 && existsSync(backupPath)) {
    const backup = JSON.parse(readFileSync(backupPath, "utf8"));
    if (Array.isArray(backup) && backup.length) {
      writeFileSync(dataPath, JSON.stringify(backup, null, 2));
      return backup;
    }
  }
  return inventory;
}

function isAuthorized(request) {
  return sessions.has(request.headers.authorization?.replace("Bearer ", ""));
}

function headerValue(row, names) {
  const key = Object.keys(row).find((candidate) => names.includes(candidate.toLowerCase().replace(/[^a-z]/g, "")));
  return key ? row[key] : undefined;
}

function numeric(value) {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseHotelTemplate(workbook) {
  const inventory = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: false });
    const isHousekeeping = sheetName === "H K & Dispo.";
    const nameIndex = isHousekeeping ? 1 : sheetName === "Stock" ? 2 : 2;
    const priceIndex = isHousekeeping ? 0 : 1;
    const totalIndex = isHousekeeping ? 6 : 7;
    const balanceIndex = isHousekeeping ? 10 : 15;
    rows.forEach((row, index) => {
      const name = String(row[nameIndex] || "").trim();
      if (!name || /stock as on today|purchased|vegetables/i.test(name)) return;
      const totalQuantity = numeric(row[totalIndex]);
      const stockBalance = numeric(row[balanceIndex]);
      if (totalQuantity === 0 && stockBalance === 0 && !row[priceIndex]) return;
      const category = isHousekeeping ? "Housekeeping & Disposables" : sheetName;
      const departmentNames = isHousekeeping ? [String(row[8] || "General")] : sheetName === "Vegetables"
        ? ["North Indian", "Chinese", "Tandoori", "South Indian", "Pantry", "Restaurant & Banquet & Rooms & Kitchen"]
        : ["North Indian", "Chinese", "Tandoori", "Pantry", "South Indian", "Management & Banquet & Rooms"];
      const departmentStart = isHousekeeping ? 9 : 8;
      const usageByDepartment = {};
      departmentNames.forEach((department, departmentIndex) => {
        const used = numeric(row[departmentStart + departmentIndex]);
        if (used) usageByDepartment[department] = used;
      });
      const issued = Object.values(usageByDepartment).reduce((sum, value) => sum + value, 0);
      inventory.push({
        id: `${Date.now()}-${sheetName}-${index}`,
        name,
        category,
        quantity: stockBalance || totalQuantity,
        unit: /box|piece|packet|pack|roll|set|paper|napkin|tissue|marker|pen|pencil/i.test(name) ? "unit" : "kg",
        unitPrice: numeric(row[priceIndex]),
        reorderLevel: 0,
        stockToday: numeric(row[isHousekeeping ? 2 : 3]),
        purchased: numeric(row[isHousekeeping ? 3 : 4]),
        totalQuantity,
        issued,
        usedToday: issued,
        usageByDepartment,
        waste: numeric(row[isHousekeeping ? 9 : 14]),
        vendor: isHousekeeping ? String(row[7] || "") : "",
        department: isHousekeeping ? String(row[8] || "") : "",
        sourceSheet: sheetName,
        updatedAt: new Date().toISOString()
      });
    });
  }
  return inventory;
}

function parseTextInventory(text, filename) {
  const inventory = [];
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  lines.forEach((line, index) => {
    const match = line.match(/^(.*?)(?:\s+|[-:|,])\s*(\d+(?:\.\d+)?)\s*(kg|g|L|ml|pcs|piece|pieces|box|boxes|pack|packs|bunch|bunches|unit|units)?\s*$/i);
    if (!match) return;
    const name = String(match[1]).replace(/^(item|product|stock)\s*/i, "").replace(/[|,;]+$/g, "").trim();
    if (!name) return;
    const quantity = Number(match[2]);
    if (!Number.isFinite(quantity)) return;
    inventory.push({
      id: `${Date.now()}-text-${index}`,
      name,
      category: "Stock",
      quantity,
      unit: normalizeUnit(match[3] || "kg"),
      unitPrice: 0,
      reorderLevel: 5,
      updatedAt: new Date().toISOString()
    });
  });

  if (!inventory.length) throw new Error(`No usable inventory rows found in ${filename}. Try lines like "Rice Flour 5 kg" or "Tomato - 12 kg".`);
  saveInventory(inventory);
  const history = readHistory();
  history.push({ id: `${Date.now()}`, message: `${filename} imported`, reply: `${inventory.length} items added from text import.`, operation: "import", itemName: "Text inventory import", quantity: inventory.length, unit: "items", createdAt: new Date().toISOString() });
  saveHistory(history);
  return inventory;
}

function importWorkbook(data, filename, text) {
  if (text && String(text).trim()) return parseTextInventory(String(text), filename || "manual-import.txt");
  if (!data || !filename) throw new Error("No workbook data received.");
  const normalizedFilename = String(filename).toLowerCase();
  if (normalizedFilename.endsWith(".txt") || normalizedFilename.endsWith(".md") || normalizedFilename.endsWith(".doc") || normalizedFilename.endsWith(".docx")) {
    return parseTextInventory(Buffer.from(data, "base64").toString("utf8"), filename);
  }

  const workbook = XLSX.read(Buffer.from(data, "base64"), { type: "buffer" });
  if (workbook.SheetNames.includes("Vegetables") && workbook.SheetNames.includes("Stock") && workbook.SheetNames.includes("H K & Dispo.")) {
    const inventory = parseHotelTemplate(workbook);
    if (!inventory.length) throw new Error(`No inventory rows found in ${filename}.`);
    saveInventory(inventory);
    const history = readHistory();
    history.push({ id: `${Date.now()}`, message: `${filename} imported`, reply: `${inventory.length} categorized hotel inventory items imported.`, operation: "import", itemName: "Hotel inventory workbook", quantity: inventory.length, unit: "items", createdAt: new Date().toISOString() });
    saveHistory(history);
    return inventory;
  }
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
  const inventory = rows.map((row, index) => {
    const name = String(headerValue(row, ["item", "product", "itemname", "productname", "name"]) || "").trim();
    const quantity = Number(headerValue(row, ["quantity", "qty", "stock", "currentstock"]) || 0);
    const unit = normalizeUnit(String(headerValue(row, ["unit", "uom", "measurement"]) || "kg"));
    const unitPrice = Number(headerValue(row, ["unitprice", "price", "cost", "rate"]) || 0);
    const reorderLevel = Number(headerValue(row, ["reorderlevel", "minimumstock", "minstock", "threshold"]) || 5);
    return { id: `${Date.now()}-${index}`, name, quantity, unit, unitPrice, reorderLevel, updatedAt: new Date().toISOString() };
  }).filter((item) => item.name && Number.isFinite(item.quantity));
  if (!inventory.length) throw new Error(`No usable inventory rows found in ${filename}. Use columns such as Item, Quantity, Unit, Unit Price, and Reorder Level.`);
  saveInventory(inventory);
  const history = readHistory();
  history.push({ id: `${Date.now()}`, message: `${filename} imported`, reply: `${inventory.length} inventory items imported.`, operation: "import", itemName: "Inventory workbook", quantity: inventory.length, unit: "items", createdAt: new Date().toISOString() });
  saveHistory(history);
  return inventory;
}

function saveInventory(inventory) {
  const serialized = JSON.stringify(inventory, null, 2);
  writeFileSync(dataPath, serialized);
  writeFileSync(backupPath, serialized);
}

function readHistory() {
  if (!existsSync(historyPath)) writeFileSync(historyPath, "[]");
  return JSON.parse(readFileSync(historyPath, "utf8"));
}

function saveHistory(history) {
  writeFileSync(historyPath, JSON.stringify(history.slice(-100), null, 2));
}

function readChatHistory() {
  if (!existsSync(chatPath)) writeFileSync(chatPath, "[]");
  return JSON.parse(readFileSync(chatPath, "utf8"));
}

function saveChatHistory(history) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  writeFileSync(chatPath, JSON.stringify(history.filter((entry) => new Date(entry.createdAt).getTime() > cutoff).slice(-200), null, 2));
}

function recordChat(message, reply, changed = null) {
  const chat = readChatHistory();
  chat.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, message, reply, changed: changed ? changed.name : null, createdAt: new Date().toISOString() });
  saveChatHistory(chat);
}

function normalizeUnit(unit = "kg") {
  const value = unit.toLowerCase();
  if (["g", "gram", "grams"].includes(value)) return "g";
  if (["ml", "milliliter", "milliliters"].includes(value)) return "ml";
  if (["l", "liter", "litre", "liters", "litres"].includes(value)) return "L";
  return "kg";
}

function toBaseQuantity(quantity, unit) {
  return ["g", "ml"].includes(unit) ? quantity / 1000 : quantity;
}

function applyQuantity(item, quantity, unit, operation) {
  const normalizedUnit = normalizeUnit(unit || item.unit);
  const baseQuantity = toBaseQuantity(Number(quantity), normalizedUnit);
  const itemBase = toBaseQuantity(Number(item.quantity), item.unit);
  const nextBase = operation === "remove" ? Math.max(0, itemBase - baseQuantity) : itemBase + baseQuantity;
  item.quantity = Number(nextBase.toFixed(3));
  item.unit = item.unit === normalizedUnit ? item.unit : normalizedUnit;
  item.updatedAt = new Date().toISOString();
}

function recordHistory(message, reply, operation, item, quantity, unit) {
  const history = readHistory();
  history.push({ id: `${Date.now()}`, message, reply, operation, itemName: item.name, quantity, unit: unit || item.unit, createdAt: new Date().toISOString() });
  saveHistory(history);
}

function findItem(inventory, name) {
  const requested = String(name || "").toLowerCase().trim();
  return inventory.find((entry) => entry.name.toLowerCase() === requested) || inventory.find((entry) => requested.includes(entry.name.toLowerCase()) || entry.name.toLowerCase().includes(requested));
}

function fallbackAction(text) {
  const lower = text.toLowerCase();
  const operation = /\b(use|used|utili[sz]e|remove|subtract|sold|waste|out)\b/.test(lower) ? "remove" : "add";
  const quantityMatch = lower.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|g|gram|grams|l|liter|litre|ml|milliliter|milliliters)?/i);
  const quantity = quantityMatch ? Number(quantityMatch[1]) : null;
  const unit = normalizeUnit(quantityMatch?.[2]);
  const cleaned = lower.replace(/\d+(?:\.\d+)?\s*(kg|kgs|g|gram|grams|l|liter|litre|ml|milliliter|milliliters)?/i, " ");
  const name = cleaned.replace(/\b(add|bought|buy|purchase|purchased|received|use|used|utili[sz]e|remove|subtract|sold|waste|out|of|to|from|inventory|stock|please|the|a|an)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").trim();
  return { intent: quantity && name ? "update" : "question", operation, itemName: name || null, quantity, unit };
}

async function getAction(message, inventory) {
  if (!process.env.GROQ_API_KEY) return fallbackAction(message);
  const prompt = `You are Stocky, a single inventory agent for a hotel. Return JSON only with keys intent (update|question), operation (add|remove), itemName, quantity, unit, reply. Understand Telugu written with English/Latin letters and Telugu-English mixed sentences. Preserve the user's conversational style in reply when practical. Match itemName against the imported inventory, including category and vendor context. Infer synonyms such as bought/received/add and used/sold/removed. Units must be kg, g, L, or ml, but hotel template items such as boxes, pieces, pens, and rolls may use unit. Inventory: ${JSON.stringify(inventory)}. User: ${message}`;
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile", temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: prompt }] })
  });
  if (!response.ok) throw new Error(`Groq request failed: ${response.status}`);
  return JSON.parse((await response.json()).choices[0].message.content);
}

function replyFor(action, item) {
  if (!item) return "I could not find an item and quantity in that request. Try: Add 5 kg rice.";
  const verb = action.operation === "remove" ? "removed from" : "added to";
  return `${action.quantity} ${action.unit || item.unit} ${item.name} ${verb} inventory. You now have ${item.quantity} ${item.unit}.`;
}

async function handleAgent(body) {
  const inventory = readInventory();
  const action = await getAction(body.message, inventory);
  if (action.intent === "update" && action.itemName && action.quantity) {
    const itemName = action.itemName.toLowerCase();
    let item = findItem(inventory, itemName);
    if (!item) {
      item = { id: `${Date.now()}`, name: action.itemName.replace(/\b\w/g, (letter) => letter.toUpperCase()), quantity: 0, unit: normalizeUnit(action.unit), unitPrice: 0, reorderLevel: 5, updatedAt: new Date().toISOString() };
      inventory.push(item);
    }
    applyQuantity(item, action.quantity, action.unit, action.operation);
    saveInventory(inventory);
    const reply = action.reply || replyFor(action, item);
    item.usedToday = Number(item.usedToday || 0) + (action.operation === "remove" ? Number(action.quantity) : 0);
    recordHistory(body.message, reply, action.operation, item, action.quantity, action.unit || item.unit);
    recordChat(body.message, reply, item);
    return { reply, inventory, changed: item };
  }
  const lowStock = inventory.filter((item) => item.quantity <= item.reorderLevel).map((item) => item.name);
  const reply = action.reply || `You have ${inventory.length} tracked items. ${lowStock.length ? `Low stock: ${lowStock.join(", ")}.` : "Everything is above its reorder level."}`;
  recordChat(body.message, reply);
  return { reply, inventory, changed: null };
}

function mutateInventory(body) {
  const inventory = readInventory();
  let item = body.itemId ? inventory.find((entry) => entry.id === body.itemId) : findItem(inventory, body.name);
  if (!item) {
    item = { id: `${Date.now()}`, name: body.name.trim(), category: body.category || "Stock", quantity: 0, unit: normalizeUnit(body.unit), unitPrice: 0, reorderLevel: 0, stockToday: 0, purchased: 0, totalQuantity: 0, issued: 0, usedToday: 0, waste: 0, usageByDepartment: {}, vendor: body.vendor || "", department: body.department || "", sourceSheet: body.category || "Stock", updatedAt: new Date().toISOString() };
    inventory.push(item);
  }
  if (body.operation === "remove" || body.operation === "add") {
    applyQuantity(item, Number(body.quantity || 0), body.unit || item.unit, body.operation);
    item.usedToday = Number(item.usedToday || 0) + (body.operation === "remove" ? Number(body.quantity || 0) : 0);
    item.issued = Number(item.issued || 0) + (body.operation === "remove" ? Number(body.quantity || 0) : 0);
    if (body.department) item.usageByDepartment = { ...(item.usageByDepartment || {}), [body.department]: Number(item.usageByDepartment?.[body.department] || 0) + (body.operation === "remove" ? Number(body.quantity || 0) : 0) };
  }
  if (body.quantity !== undefined && body.operation === "set") item.quantity = Number(body.quantity);
  if (body.unitPrice !== undefined) item.unitPrice = Number(body.unitPrice || 0);
  if (body.reorderLevel !== undefined) item.reorderLevel = Number(body.reorderLevel || 0);
  if (body.stockToday !== undefined) item.stockToday = Number(body.stockToday || 0);
  if (body.purchased !== undefined) item.purchased = Number(body.purchased || 0);
  if (body.department) item.department = body.department;
  if (body.vendor !== undefined) item.vendor = body.vendor;
  item.totalQuantity = Number(item.stockToday || 0) + Number(item.purchased || 0);
  item.updatedAt = new Date().toISOString();
  saveInventory(inventory);
  const reply = `${item.name} updated. ${item.quantity} ${item.unit} left.`;
  recordHistory(`Manual inventory update: ${item.name}`, reply, body.operation || "update", item, Number(body.quantity || 0), body.unit || item.unit);
  return { inventory, changed: item, reply };
}

function send(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization" });
  response.end(JSON.stringify(payload));
}

createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, {});
  if (request.method === "POST" && request.url === "/api/login") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const credentials = JSON.parse(body);
      if (credentials.username !== "psr@321" || credentials.password !== "hotelinvent#234") return send(response, 401, { error: "Invalid username or password" });
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessions.add(token);
      return send(response, 200, { token, needsImport: readInventory().length === 0 });
    });
    return;
  }
  if (!isAuthorized(request)) return send(response, 401, { error: "Please log in first" });
  if (request.method === "GET" && request.url === "/api/inventory") return send(response, 200, { inventory: readInventory() });
  if (request.method === "GET" && request.url === "/api/history") return send(response, 200, { history: readHistory().reverse() });
  if (request.method === "GET" && request.url === "/api/chat-history") return send(response, 200, { history: readChatHistory().filter((entry) => Date.now() - new Date(entry.createdAt).getTime() <= 24 * 60 * 60 * 1000) });
  if (request.method === "GET" && request.url === "/api/activity") {
    const history = readHistory();
    const today = new Date().toISOString().slice(0, 10);
    const todayEntries = history.filter((entry) => entry.createdAt.slice(0, 10) === today);
    const days = [...new Set(history.map((entry) => entry.createdAt.slice(0, 10)))].sort().reverse().slice(0, 7).map((date) => ({ date, count: history.filter((entry) => entry.createdAt.slice(0, 10) === date).length }));
    return send(response, 200, { today: todayEntries.slice(-8).reverse(), todayCount: todayEntries.length, days, inventoryCount: readInventory().length });
  }
  if (request.method === "POST" && request.url === "/api/inventory/mutate") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { try { return send(response, 200, mutateInventory(JSON.parse(body))); } catch (error) { return send(response, 400, { error: error.message }); } });
    return;
  }
  if (request.method === "POST" && request.url === "/api/import") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body);
        return send(response, 200, { inventory: importWorkbook(payload.data, payload.filename, payload.text) });
      }
      catch (error) { return send(response, 400, { error: error.message }); }
    });
    return;
  }
  if (request.method === "POST" && request.url === "/api/agent") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", async () => {
      try { return send(response, 200, await handleAgent(JSON.parse(body))); }
      catch (error) { return send(response, 500, { error: error.message }); }
    });
    return;
  }
  send(response, 404, { error: "Not found" });
}).listen(port, () => console.log(`StockMate API listening on http://localhost:${port}`));