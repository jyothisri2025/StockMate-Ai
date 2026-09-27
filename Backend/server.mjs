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
const vendorsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "vendors.json");
const purchasesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "purchases.json");
const issuesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "issues.json");
const sessions = new Set();

function readJson(filePath, fallback = []) {
  if (!existsSync(filePath)) writeFileSync(filePath, JSON.stringify(fallback, null, 2));
  try { return JSON.parse(readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function writeJson(filePath, value) { writeFileSync(filePath, JSON.stringify(value, null, 2)); }

function nextItemCode(inventory) {
  const numbers = inventory.map((item) => Number(String(item.itemCode || "").match(/(\d+)$/)?.[1] || 0));
  return `ITM-${String(Math.max(0, ...numbers) + 1).padStart(4, "0")}`;
}

function ensureItemCodes(inventory) {
  const used = new Set();
  let changed = false;
  for (const item of inventory) {
    if (!item.itemCode || used.has(item.itemCode)) {
      let code = nextItemCode(inventory);
      while (used.has(code)) { inventory.push({ itemCode: code }); code = nextItemCode(inventory); inventory.pop(); }
      item.itemCode = code;
      changed = true;
    }
    used.add(item.itemCode);
    item.vendors = Array.isArray(item.vendors) ? item.vendors : [];
  }
  return changed;
}

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
      ensureItemCodes(backup);
      return backup;
    }
  }
  if (ensureItemCodes(inventory)) saveInventory(inventory);
  migrateVendors(inventory);
  readJson(vendorsPath);
  readJson(purchasesPath);
  readJson(issuesPath);
  return inventory;
}

function migrateVendors(inventory) {
  const vendors = readJson(vendorsPath);
  let changed = false;
  inventory.filter((item) => item.vendor).forEach((item) => {
    if (!vendors.some((vendor) => vendor.vendorName.toLowerCase() === String(item.vendor).toLowerCase())) {
      vendors.push({ vendorId: `VEN-${String(vendors.length + 1).padStart(4, "0")}`, vendorName: item.vendor, active: true, createdAt: new Date().toISOString() });
      changed = true;
    }
  });
  if (changed) writeJson(vendorsPath, vendors);
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

function normalizedHeader(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

function masterValue(row, aliases) {
  const key = Object.keys(row).find((candidate) => aliases.includes(normalizedHeader(candidate)));
  return key === undefined ? undefined : row[key];
}

function hasMasterValue(value) { return value !== undefined && value !== null && String(value).trim() !== ""; }

const masterHeaderAliases = new Set(["itemcode", "sku", "productcode", "stockcode", "itemname", "item", "product", "productname", "name", "category", "group", "type", "unit", "uom", "measurement", "currentstock", "stockbalance", "balance", "quantity", "qty", "stock", "unitprice", "purchaseprice", "price", "cost", "rate", "lastpurchaseprice", "vendor", "vendorname", "supplier", "suppliername", "vendorid", "supplierid", "contactperson", "contact", "phone", "email", "address", "reorderlevel", "minimumstock", "minstock", "threshold", "purchasedate", "datepurchased", "receiveddate", "purchasequantity", "purchasedqty", "receivedquantity", "receivedqty", "issuedate", "dateissued", "useddate", "issuequantity", "issuedquantity", "issuedqty", "quantityissued", "usedquantity", "department", "receivingdepartment", "issuedtodepartment"]);

function detectMasterHeader(rows) {
  let best = { index: -1, score: 0 };
  rows.slice(0, 25).forEach((row, index) => {
    const score = row.reduce((total, value) => total + (masterHeaderAliases.has(normalizedHeader(value)) ? 1 : 0), 0);
    if (score > best.score) best = { index, score };
  });
  return best.score >= 1 ? best.index : -1;
}

function positionalMasterHeaders(sheetName) {
  if (sheetName === "H K & Dispo.") return ["itemCode", "itemName", "stockToday", "purchaseQuantity", "unitPrice", "rate2", "totalQuantity", "vendor", "department", "issueQuantity", "currentStock"];
  return ["itemCode", "unitPrice", "itemName", "stockToday", "purchaseQuantity", "rate2", "rate3", "totalQuantity", "departmentNorthIndian", "departmentChinese", "departmentTandoori", "departmentSouthIndian", "departmentPantry", "departmentOther", "waste", "currentStock"];
}

function splitVendorContact(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(.*?)(?:\s*;\s*|\s+-\s+|\s*\|\s*)(\+?\d[\d\s-]{6,})$/);
  return match ? { name: match[1].trim(), phone: match[2].replace(/\s+/g, " ").trim() } : { name: text, phone: "" };
}

function isDepartmentColumn(key) {
  const value = normalizedHeader(key);
  return value.startsWith("department") || ["kitchen", "restaurant", "banquet", "housekeeping", "northindian", "southindian", "chinese", "tandoori", "pantry", "management", "rooms"].some((term) => value.includes(term));
}

function validMasterDate(value) {
  if (!hasMasterValue(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date in Master List: ${value}`);
  return date.toISOString();
}

function masterRows(data, filename, text) {
  let workbook;
  if (text && String(text).trim()) workbook = XLSX.read(String(text), { type: "string", raw: false });
  else if (data && filename) workbook = XLSX.read(Buffer.from(data, "base64"), { type: "buffer", raw: false });
  else throw new Error("No Master List file or table was received.");
  const rows = workbook.SheetNames.flatMap((sheetName) => {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
    const headerIndex = detectMasterHeader(matrix);
    const headers = headerIndex >= 0 ? matrix[headerIndex].map((value, index) => normalizedHeader(value) || `column${index}`) : positionalMasterHeaders(sheetName);
    const dataStart = headerIndex >= 0 ? headerIndex + 1 : 0;
    return matrix.slice(dataStart).map((values, rowIndex) => {
      const row = { __sheetName: sheetName, __rowIndex: rowIndex + dataStart + 1 };
      headers.forEach((header, index) => { row[header] = values[index] ?? ""; });
      return row;
    }).filter((row) => Object.values(row).some((value) => hasMasterValue(value) && !String(value).startsWith("__")));
  });
  if (!rows.length) throw new Error(`No rows found in ${filename || "Master List"}.`);
  return rows;
}

function processMasterList(data, filename, text) {
  const rows = masterRows(data, filename, text);
  const inventory = readInventory(); const vendors = readVendors(); const purchases = readPurchases(); const issues = readIssues();
  const summary = { itemsProcessed: 0, vendorsProcessed: 0, purchasesUpdated: 0, issuesUpdated: 0, createdItems: 0, createdVendors: 0, errors: [], currentStockProvided: 0 };
  const historyRecords = [];
  const touchedVendors = new Set(); const now = new Date().toISOString();
  rows.forEach((row, rowIndex) => {
    try {
      const itemCodeValue = masterValue(row, ["itemcode", "sku", "productcode", "stockcode"]);
      const nameValue = masterValue(row, ["itemname", "item", "product", "productname", "name"]);
      const itemCode = hasMasterValue(itemCodeValue) ? String(itemCodeValue).trim() : "";
      const name = hasMasterValue(nameValue) ? String(nameValue).trim() : "";
      if (!itemCode && !name) throw new Error("Item Code or Item Name is required.");
      let item = itemCode ? inventory.find((entry) => entry.itemCode === itemCode) : null;
      if (!item && name) item = inventory.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
      if (!item) { item = { id: `${Date.now()}-master-${rowIndex}`, itemCode: itemCode || nextItemCode(inventory), name: name || itemCode, category: "Stock", quantity: 0, unit: "kg", unitPrice: 0, reorderLevel: 0, vendors: [], usageByDepartment: {}, updatedAt: now }; inventory.push(item); summary.createdItems += 1; }
      if (itemCode) item.itemCode = itemCode;
      if (name) item.name = name;
      const category = masterValue(row, ["category", "group", "type"]); item.category = hasMasterValue(category) ? String(category).trim() : item.category || row.__sheetName || "Stock"; item.sourceSheet = row.__sheetName || item.sourceSheet || "Master List";
      const unit = masterValue(row, ["unit", "uom", "measurement"]); if (hasMasterValue(unit)) item.unit = normalizeUnit(String(unit));
      const stockTodayValue = masterValue(row, ["stocktoday", "openingstock", "stockasontoday"]); if (hasMasterValue(stockTodayValue)) item.stockToday = Number(stockTodayValue);
      const purchasedValue = masterValue(row, ["purchasequantity", "purchasedqty", "purchased", "receivedquantity", "receivedqty"]); if (hasMasterValue(purchasedValue)) item.purchased = Number(purchasedValue);
      const issuedValue = masterValue(row, ["issuequantity", "issuedquantity", "issuedqty", "issued", "quantityissued", "usedquantity"]); if (hasMasterValue(issuedValue)) item.issued = Number(issuedValue);
      if (item.stockToday !== undefined && !Number.isFinite(item.stockToday)) throw new Error("Stock as Today must be numeric.");
      if (item.purchased !== undefined && (!Number.isFinite(item.purchased) || item.purchased < 0)) throw new Error("Purchased quantity must be zero or greater.");
      if (item.issued !== undefined && (!Number.isFinite(item.issued) || item.issued < 0)) throw new Error("Issued quantity must be zero or greater.");
      const reorder = masterValue(row, ["reorderlevel", "minimumstock", "minstock", "threshold"]); if (hasMasterValue(reorder)) { item.reorderLevel = Number(reorder); if (!Number.isFinite(item.reorderLevel) || item.reorderLevel < 0) throw new Error("Reorder level must be zero or greater."); }
      const currentStock = masterValue(row, ["currentstock", "stockbalance", "balance", "quantity", "qty", "stock"]);
      if (hasMasterValue(currentStock)) { const quantity = Number(currentStock); if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Current Stock must be zero or greater."); item.quantity = quantity; summary.currentStockProvided += 1; }
      const priceValue = masterValue(row, ["unitprice", "purchaseprice", "price", "cost", "rate", "lastpurchaseprice"]);
      if (hasMasterValue(priceValue)) { item.unitPrice = Number(priceValue); if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new Error("Unit Price cannot be negative."); item.lastPurchasePrice = item.unitPrice; }
      const rawVendorValue = masterValue(row, ["vendor", "vendorname", "supplier", "suppliername"]); const vendorContact = splitVendorContact(rawVendorValue); const vendorNameValue = hasMasterValue(rawVendorValue) ? vendorContact.name : rawVendorValue; const vendorIdValue = masterValue(row, ["vendorid", "supplierid"]);
      let vendor = null;
      if (hasMasterValue(vendorIdValue)) vendor = vendors.find((entry) => entry.vendorId === String(vendorIdValue).trim());
      if (!vendor && hasMasterValue(vendorNameValue)) vendor = vendors.find((entry) => entry.vendorName.toLowerCase() === String(vendorNameValue).trim().toLowerCase());
      if (hasMasterValue(vendorNameValue) || hasMasterValue(vendorIdValue)) {
        if (!vendor) { vendor = { vendorId: hasMasterValue(vendorIdValue) ? String(vendorIdValue).trim() : `VEN-${String(vendors.length + 1).padStart(4, "0")}`, vendorName: hasMasterValue(vendorNameValue) ? String(vendorNameValue).trim() : String(vendorIdValue).trim(), active: true, createdAt: now }; vendors.push(vendor); summary.createdVendors += 1; }
        const contact = masterValue(row, ["contactperson", "contact", "phone", "email", "address"]); if (vendorContact.phone) vendor.phone = vendorContact.phone; if (hasMasterValue(contact) && normalizedHeader(Object.keys(row).find((key) => row[key] === contact)) === "phone") vendor.phone = String(contact); if (hasMasterValue(vendorNameValue)) vendor.vendorName = String(vendorNameValue).trim();
        touchedVendors.add(vendor.vendorId); item.vendor = vendor.vendorName; if (hasMasterValue(priceValue)) updateVendorPrice(item, vendor, item.unitPrice, item.unit, now);
      }
      const purchaseDate = validMasterDate(masterValue(row, ["purchasedate", "datepurchased", "receiveddate"])); if (purchaseDate && vendor && hasMasterValue(priceValue)) item.lastPurchaseDate = purchaseDate; const purchaseQuantityValue = masterValue(row, ["purchasequantity", "purchasedqty", "receivedquantity", "receivedqty"]);
      if (purchaseDate && hasMasterValue(priceValue) && vendor) { const quantity = Number(hasMasterValue(purchaseQuantityValue) ? purchaseQuantityValue : currentStock); if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Purchase quantity must be greater than 0."); const purchase = { purchaseId: `PUR-${Date.now()}-${rowIndex}`, date: dateOnly(purchaseDate), itemCode: item.itemCode, itemName: item.name, vendorId: vendor.vendorId, vendorName: vendor.vendorName, quantity, unit: item.unit, unitPrice: item.unitPrice, totalPurchaseCost: Number((quantity * item.unitPrice).toFixed(2)), createdAt: purchaseDate }; purchases.push(purchase); summary.purchasesUpdated += 1; }
      const issueQuantityValue = masterValue(row, ["issuequantity", "issuedquantity", "issuedqty", "quantityissued", "usedquantity"]); const issueDate = validMasterDate(masterValue(row, ["issuedate", "dateissued", "useddate"])); const departmentValue = masterValue(row, ["department", "receivingdepartment", "issuedtodepartment"]);
      if (hasMasterValue(issueQuantityValue) || issueDate || hasMasterValue(departmentValue)) { const quantity = Number(issueQuantityValue); if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Issue quantity must be greater than 0."); if (!hasMasterValue(departmentValue)) throw new Error("Issue department is required."); const effectiveIssueDate = issueDate || now; if (!hasMasterValue(currentStock) && quantity > Number(item.quantity || 0)) throw new Error(`Issue quantity exceeds stock for ${item.name}.`); if (!hasMasterValue(currentStock)) applyQuantity(item, quantity, item.unit, "remove"); const unitCost = Number(priceValue ?? item.lastPurchasePrice ?? item.unitPrice ?? 0); const issue = { issueId: `ISS-${Date.now()}-${rowIndex}`, date: dateOnly(effectiveIssueDate), time: effectiveIssueDate.slice(11, 19), itemCode: item.itemCode, itemName: item.name, quantity, unit: item.unit, department: String(departmentValue).trim(), unitCost, vendorId: vendor?.vendorId || "", vendorName: vendor?.vendorName || item.vendor || "", totalIssueValue: Number((quantity * unitCost).toFixed(2)), issuedBy: "Master List", notes: "Imported from Master List", createdAt: effectiveIssueDate }; item.issued = Number(item.issued || 0) + quantity; item.usedToday = Number(item.usedToday || 0) + quantity; item.usageByDepartment = { ...(item.usageByDepartment || {}), [issue.department]: Number(item.usageByDepartment?.[issue.department] || 0) + quantity }; issues.push(issue); summary.issuesUpdated += 1; }
      const explicitIssue = hasMasterValue(issueQuantityValue) || issueDate || hasMasterValue(departmentValue); const departmentColumns = Object.entries(row).filter(([key, value]) => key !== "department" && isDepartmentColumn(key) && hasMasterValue(value));
      if (!explicitIssue && departmentColumns.length) departmentColumns.forEach(([key, value], departmentIndex) => { const quantity = Number(value); if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Department issue for ${key} must be numeric and zero or greater.`); if (quantity === 0) return; if (!hasMasterValue(currentStock) && quantity > Number(item.quantity || 0)) throw new Error(`Department issue exceeds stock for ${item.name}.`); if (!hasMasterValue(currentStock)) applyQuantity(item, quantity, item.unit, "remove"); const department = String(key).replace(/^department/i, "").replace(/([a-z])([A-Z])/g, "$1 $2").trim() || "General"; const unitCost = Number(item.lastPurchasePrice ?? item.unitPrice ?? 0); item.issued = Number(item.issued || 0) + quantity; item.usedToday = Number(item.usedToday || 0) + quantity; item.usageByDepartment = { ...(item.usageByDepartment || {}), [department]: Number(item.usageByDepartment?.[department] || 0) + quantity }; issues.push({ issueId: `ISS-${Date.now()}-${rowIndex}-${departmentIndex}`, date: dateOnly(purchaseDate || now), time: now.slice(11, 19), itemCode: item.itemCode, itemName: item.name, quantity, unit: item.unit, department, unitCost, vendorId: vendor?.vendorId || "", vendorName: vendor?.vendorName || item.vendor || "", totalIssueValue: Number((quantity * unitCost).toFixed(2)), issuedBy: "Master List", notes: "Imported department column", createdAt: purchaseDate || now }); summary.issuesUpdated += 1; });
      item.updatedAt = now; historyRecords.push({ itemCode: item.itemCode, itemName: item.name, vendorName: vendor?.vendorName || item.vendor || "", quantity: hasMasterValue(currentStock) ? Number(currentStock) : Number(item.quantity || 0), unit: item.unit, unitPrice: Number(item.lastPurchasePrice ?? item.unitPrice ?? 0), action: "MASTER_LIST_UPDATE", source: filename || "Master List", createdAt: now }); summary.itemsProcessed += 1;
    } catch (error) { summary.errors.push(`Row ${rowIndex + 2}: ${error.message}`); }
  });
  if (!summary.itemsProcessed) throw new Error(`No valid Master List rows were processed. ${summary.errors.join(" ")}`);
  ensureItemCodes(inventory); saveInventory(inventory); writeJson(vendorsPath, vendors); writeJson(purchasesPath, purchases); writeJson(issuesPath, issues);
  const outOfStock = inventory.filter((item) => Number(item.quantity) === 0).length; const lowStock = inventory.filter((item) => Number(item.quantity) > 0 && Number(item.reorderLevel) > 0 && Number(item.quantity) <= Number(item.reorderLevel)).length; const totalStock = inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const reply = `Master List processed successfully.\n\n✓ ${summary.itemsProcessed} items processed\n✓ ${touchedVendors.size} vendors processed\n✓ ${summary.purchasesUpdated} purchase records updated\n✓ ${summary.issuesUpdated} issue records updated\n\nInventory:\n• ${totalStock.toLocaleString()} total stock units\n• ${outOfStock} items out of stock\n• ${lowStock} items low stock${summary.errors.length ? `\n\nSkipped rows: ${summary.errors.length}` : ""}`;
  const history = readHistory(); history.push({ id: `${Date.now()}`, message: `${filename || "Master List"} processed`, reply, operation: "master-list", itemName: "Master List", quantity: summary.itemsProcessed, unit: "items", createdAt: now, details: summary, records: historyRecords }); saveHistory(history);
  return { inventory, vendors, purchases, issues, summary: { ...summary, vendorsProcessed: touchedVendors.size, totalStock, outOfStock, lowStock }, reply };
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

function readVendors() { return readJson(vendorsPath); }
function readPurchases() { return readJson(purchasesPath); }
function readIssues() { return readJson(issuesPath); }

function dateOnly(value = new Date()) { return new Date(value).toISOString().slice(0, 10); }

function findInventoryItem(inventory, body) {
  return inventory.find((item) => body.itemCode && item.itemCode === body.itemCode)
    || inventory.find((item) => body.itemId && item.id === body.itemId)
    || findItem(inventory, body.itemName || body.name);
}

function requirePositive(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${label} must be greater than 0.`);
  return result;
}

function requireVendor(vendorId) {
  const vendor = readVendors().find((entry) => entry.vendorId === vendorId);
  if (!vendor) throw new Error("Select an existing vendor first.");
  return vendor;
}

function updateVendorPrice(item, vendor, price, unit, createdAt) {
  const priceEntry = { vendorId: vendor.vendorId, vendorName: vendor.vendorName, purchasePrice: price, unit, lastPurchaseDate: createdAt };
  item.vendors = (item.vendors || []).filter((entry) => entry.vendorId !== vendor.vendorId).concat(priceEntry);
  item.vendor = vendor.vendorName;
  item.unitPrice = price;
  item.lastPurchasePrice = price;
  item.lastPurchaseDate = createdAt;
}

function recordPurchase(body) {
  const inventory = readInventory();
  const item = findInventoryItem(inventory, body);
  if (!item) throw new Error("The selected inventory item does not exist.");
  const vendor = requireVendor(body.vendorId);
  const quantity = requirePositive(body.quantity, "Purchase quantity");
  const unitPrice = Number(body.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("Purchase price cannot be negative.");
  const createdAt = new Date(body.date || Date.now()).toISOString();
  const purchase = { purchaseId: `PUR-${Date.now()}`, date: dateOnly(createdAt), itemCode: item.itemCode, itemName: item.name, vendorId: vendor.vendorId, vendorName: vendor.vendorName, quantity, unit: body.unit || item.unit, unitPrice, totalPurchaseCost: Number((quantity * unitPrice).toFixed(2)), createdAt };
  applyQuantity(item, quantity, purchase.unit, "add");
  item.purchased = Number(item.purchased || 0) + quantity;
  item.totalQuantity = Number(item.totalQuantity || 0) + quantity;
  updateVendorPrice(item, vendor, unitPrice, purchase.unit, createdAt);
  saveInventory(inventory);
  const purchases = readPurchases(); purchases.push(purchase); writeJson(purchasesPath, purchases);
  recordHistory(`Purchase: ${item.name} from ${vendor.vendorName}`, `${quantity} ${purchase.unit} purchased for ₹${purchase.totalPurchaseCost}.`, "purchase", item, quantity, purchase.unit);
  return { purchase, inventory, changed: item };
}

function recordIssue(body) {
  const inventory = readInventory();
  const item = findInventoryItem(inventory, body);
  if (!item) throw new Error("The selected inventory item does not exist.");
  const quantity = requirePositive(body.quantity, "Issue quantity");
  if (!body.department?.trim()) throw new Error("Receiving department is required.");
  const available = toBaseQuantity(Number(item.quantity || 0), item.unit);
  const requested = toBaseQuantity(quantity, normalizeUnit(body.unit || item.unit));
  if (requested > available + 0.000001) throw new Error(`Only ${item.quantity} ${item.unit} is available; issue quantity is too high.`);
  const vendor = body.vendorId ? requireVendor(body.vendorId) : null;
  const unitCost = Number(body.unitCost ?? item.lastPurchasePrice ?? item.unitPrice ?? 0);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("Issue cost cannot be negative.");
  const createdAt = new Date(body.date || Date.now()).toISOString();
  const issue = { issueId: `ISS-${Date.now()}`, date: dateOnly(createdAt), time: createdAt.slice(11, 19), itemCode: item.itemCode, itemName: item.name, quantity, unit: body.unit || item.unit, department: body.department.trim(), unitCost, vendorId: vendor?.vendorId || "", vendorName: vendor?.vendorName || item.vendor || "", totalIssueValue: Number((quantity * unitCost).toFixed(2)), issuedBy: body.issuedBy || "Admin", notes: body.notes || "", createdAt };
  applyQuantity(item, quantity, issue.unit, "remove");
  item.issued = Number(item.issued || 0) + quantity;
  item.usedToday = Number(item.usedToday || 0) + quantity;
  item.usageByDepartment = { ...(item.usageByDepartment || {}), [issue.department]: Number(item.usageByDepartment?.[issue.department] || 0) + quantity };
  saveInventory(inventory);
  const issues = readIssues(); issues.push(issue); writeJson(issuesPath, issues);
  recordHistory(`Issue: ${item.name} to ${issue.department}`, `${quantity} ${issue.unit} issued for ₹${issue.totalIssueValue}.`, "issue", item, quantity, issue.unit);
  return { issue, inventory, changed: item };
}

function sumBy(records, key, valueKey) {
  return records.reduce((result, record) => { const name = record[key] || "Unknown"; result[name] = Number((result[name] || 0) + Number(record[valueKey] || 0)); return result; }, {});
}

function reportForRange(from, to) {
  const purchases = readPurchases().filter((entry) => entry.date >= from && entry.date <= to);
  const issues = readIssues().filter((entry) => entry.date >= from && entry.date <= to);
  return { purchases, issues, purchaseValue: purchases.reduce((sum, entry) => sum + entry.totalPurchaseCost, 0), issueValue: issues.reduce((sum, entry) => sum + entry.totalIssueValue, 0), purchaseQuantity: purchases.reduce((sum, entry) => sum + entry.quantity, 0), issueQuantity: issues.reduce((sum, entry) => sum + entry.quantity, 0), vendorTotals: sumBy(purchases, "vendorName", "totalPurchaseCost"), departmentTotals: sumBy(issues, "department", "totalIssueValue") };
}

function dailyReport(date = dateOnly()) { return { date, ...reportForRange(date, date), inventory: readInventory() }; }

function monthlyReport(month = dateOnly().slice(0, 7)) {
  const report = reportForRange(`${month}-01`, `${month}-31`);
  const itemTotals = {};
  report.issues.forEach((entry) => { itemTotals[entry.itemCode] = itemTotals[entry.itemCode] || { itemCode: entry.itemCode, itemName: entry.itemName, quantity: 0, value: 0 }; itemTotals[entry.itemCode].quantity += entry.quantity; itemTotals[entry.itemCode].value += entry.totalIssueValue; });
  return { month, ...report, itemTotals: Object.values(itemTotals), lowStock: readInventory().filter((item) => Number(item.quantity) === 0 || (Number(item.reorderLevel) > 0 && Number(item.quantity) <= Number(item.reorderLevel))) };
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

function operationalAnswer(message, inventory) {
  const lower = message.toLowerCase(); const purchases = readPurchases(); const issues = readIssues(); const today = dateOnly();
  if (/which items.*out of stock|out of stock items|what is out of stock/.test(lower)) {
    const rows = inventory.filter((entry) => Number(entry.quantity) === 0);
    return rows.length ? `${rows.length} items are out of stock: ${rows.map((entry) => `${entry.itemCode} ${entry.name}`).join(", ")}.` : "No items are currently out of stock.";
  }
  if (/what did we issue|issues today|issued today/.test(lower)) {
    const rows = issues.filter((entry) => entry.date === today);
    return rows.length ? `Today we issued ${rows.map((entry) => `${entry.quantity} ${entry.unit} ${entry.itemName} to ${entry.department}`).join(", ")}. Total issue value is ₹${rows.reduce((sum, entry) => sum + entry.totalIssueValue, 0).toLocaleString()}.` : "There are no issue transactions recorded today.";
  }
  if (/purchase.*month|purchased.*month/.test(lower)) {
    const month = today.slice(0, 7); const rows = purchases.filter((entry) => entry.date.startsWith(month));
    return `This month we recorded ${rows.length} purchases worth ₹${rows.reduce((sum, entry) => sum + entry.totalPurchaseCost, 0).toLocaleString()}.`;
  }
  const ignoredWords = new Set(["how", "much", "do", "we", "have", "is", "the", "what", "latest", "price", "who", "supplies", "stock", "left", "of", "did", "issue", "to", "kitchen"]);
  const itemTerms = lower.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((term) => term.length > 2 && !ignoredWords.has(term));
  const item = inventory.find((entry) => lower.includes(entry.name.toLowerCase())) || inventory.find((entry) => itemTerms.some((term) => entry.name.toLowerCase().includes(term)));
  if (item && /how much|how many|left|stock/.test(lower)) return `${item.name} (${item.itemCode}) has ${item.quantity} ${item.unit} in stock.`;
  if (item && /vendor|suppl(?:y|ies|ied)|last price|price.*pay/.test(lower)) {
    const prices = item.vendors?.length ? item.vendors.map((entry) => `${entry.vendorName} at ₹${entry.purchasePrice}/${entry.unit}`).join(", ") : item.vendor ? `${item.vendor} at ₹${item.unitPrice}/${item.unit}` : "no vendor price is recorded";
    return `${item.name} (${item.itemCode}) supplier pricing: ${prices}.`;
  }
  if (/department.*consum|consum.*department|most stock/.test(lower)) {
    const totals = sumBy(issues, "department", "totalIssueValue"); const winner = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
    return winner ? `${winner[0]} has consumed the most by value: ₹${Number(winner[1]).toLocaleString()}.` : "There are no issue transactions to compare yet.";
  }
  if (/housekeeping|kitchen|restaurant|banquet/.test(lower) && /issue|gave|issued|yesterday/.test(lower)) {
    const department = ["housekeeping", "kitchen", "restaurant", "banquet"].find((name) => lower.includes(name)); const rows = issues.filter((entry) => entry.department.toLowerCase().includes(department));
    return rows.length ? `${department} received ${rows.reduce((sum, entry) => sum + entry.quantity, 0)} units across ${rows.length} issue transactions.` : `No issue transactions are recorded for ${department}.`;
  }
  return null;
}

async function getAction(message, inventory) {
  if (!process.env.GROQ_API_KEY) return fallbackAction(message);
  const prompt = `You are Stocky, a single inventory agent for a hotel. Return JSON only with keys intent (update|question), operation (add|remove), itemName, quantity, unit, reply. Understand Telugu written with English/Latin letters and Telugu-English mixed sentences. Preserve the user's conversational style in reply when practical. Match itemName against the imported inventory, including category and vendor context. Infer synonyms such as bought/received/add and used/sold/removed. Units must be kg, g, L, or ml, but hotel template items such as boxes, pieces, pens, and rolls may use unit. Inventory: ${JSON.stringify(inventory)}. Recent purchases: ${JSON.stringify(readPurchases().slice(-100))}. Recent issues: ${JSON.stringify(readIssues().slice(-100))}. User: ${message}`;
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
  const operationalReply = operationalAnswer(body.message, inventory);
  if (operationalReply) { recordChat(body.message, operationalReply); return { reply: operationalReply, inventory, changed: null }; }
  const action = await getAction(body.message, inventory);
  if (action.intent === "update" && action.itemName && action.quantity) {
    const itemName = action.itemName.toLowerCase();
    let item = findItem(inventory, itemName);
    if (!item) {
      item = { id: `${Date.now()}`, itemCode: nextItemCode(inventory), name: action.itemName.replace(/\b\w/g, (letter) => letter.toUpperCase()), quantity: 0, unit: normalizeUnit(action.unit), unitPrice: 0, reorderLevel: 5, vendors: [], updatedAt: new Date().toISOString() };
      inventory.push(item);
    }
    if (action.operation === "remove" && toBaseQuantity(Number(action.quantity), normalizeUnit(action.unit || item.unit)) > toBaseQuantity(Number(item.quantity || 0), item.unit) + 0.000001) throw new Error(`Only ${item.quantity} ${item.unit} is available; issue quantity is too high.`);
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
    item = { id: `${Date.now()}`, itemCode: nextItemCode(inventory), name: body.name.trim(), category: body.category || "Stock", quantity: 0, unit: normalizeUnit(body.unit), unitPrice: 0, reorderLevel: 0, stockToday: 0, purchased: 0, totalQuantity: 0, issued: 0, usedToday: 0, waste: 0, usageByDepartment: {}, vendors: [], vendor: body.vendor || "", department: body.department || "", sourceSheet: body.category || "Stock", updatedAt: new Date().toISOString() };
    inventory.push(item);
  }
  if (body.operation === "remove" || body.operation === "add") {
    if (body.operation === "remove") {
      const requested = toBaseQuantity(Number(body.quantity || 0), normalizeUnit(body.unit || item.unit));
      const available = toBaseQuantity(Number(item.quantity || 0), item.unit);
      if (!Number.isFinite(requested) || requested <= 0) throw new Error("Quantity must be greater than 0.");
      if (requested > available + 0.000001) throw new Error(`Only ${item.quantity} ${item.unit} is available; issue quantity is too high.`);
    }
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
  response.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization" });
  response.end(JSON.stringify(payload));
}

function requestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(new Error("Invalid JSON request.")); } });
    request.on("error", reject);
  });
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
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && requestUrl.pathname === "/api/vendors") return send(response, 200, { vendors: readVendors() });
  if (request.method === "POST" && requestUrl.pathname === "/api/vendors") {
    try {
      const body = await requestBody(request);
      if (!body.vendorName?.trim()) throw new Error("Vendor name is required.");
      const vendors = readVendors();
      if (vendors.some((vendor) => vendor.vendorName.toLowerCase() === body.vendorName.trim().toLowerCase())) throw new Error("Vendor already exists.");
      const vendor = { vendorId: `VEN-${String(vendors.length + 1).padStart(4, "0")}`, vendorName: body.vendorName.trim(), contactPerson: body.contactPerson || "", phone: body.phone || "", email: body.email || "", address: body.address || "", active: body.active !== false, createdAt: new Date().toISOString() };
      vendors.push(vendor); writeJson(vendorsPath, vendors); return send(response, 201, { vendor, vendors });
    } catch (error) { return send(response, 400, { error: error.message }); }
  }
  if (request.method === "PUT" && requestUrl.pathname.startsWith("/api/vendors/")) {
    try {
      const vendorId = decodeURIComponent(requestUrl.pathname.split("/").pop());
      const body = await requestBody(request); const vendors = readVendors(); const vendor = vendors.find((entry) => entry.vendorId === vendorId);
      if (!vendor) return send(response, 404, { error: "Vendor not found." });
      Object.assign(vendor, { vendorName: body.vendorName?.trim() || vendor.vendorName, contactPerson: body.contactPerson ?? vendor.contactPerson, phone: body.phone ?? vendor.phone, email: body.email ?? vendor.email, address: body.address ?? vendor.address, active: body.active ?? vendor.active });
      writeJson(vendorsPath, vendors); return send(response, 200, { vendor, vendors });
    } catch (error) { return send(response, 400, { error: error.message }); }
  }
  if (request.method === "GET" && requestUrl.pathname === "/api/purchases") return send(response, 200, { purchases: readPurchases() });
  if (request.method === "POST" && requestUrl.pathname === "/api/purchases") { try { return send(response, 201, recordPurchase(await requestBody(request))); } catch (error) { return send(response, 400, { error: error.message }); } }
  if (request.method === "GET" && requestUrl.pathname === "/api/issues") return send(response, 200, { issues: readIssues() });
  if (request.method === "POST" && requestUrl.pathname === "/api/issues") { try { return send(response, 201, recordIssue(await requestBody(request))); } catch (error) { return send(response, 400, { error: error.message }); } }
  if (request.method === "GET" && requestUrl.pathname === "/api/reports/daily") return send(response, 200, dailyReport(requestUrl.searchParams.get("date") || dateOnly()));
  if (request.method === "GET" && requestUrl.pathname === "/api/reports/monthly") return send(response, 200, monthlyReport(requestUrl.searchParams.get("month") || dateOnly().slice(0, 7)));
  if (request.method === "GET" && requestUrl.pathname === "/api/reports/departments") {
    const issues = readIssues(); const departments = Object.values(issues.reduce((result, issue) => { const current = result[issue.department] || { department: issue.department, quantity: 0, value: 0, issues: [] }; current.quantity += issue.quantity; current.value += issue.totalIssueValue; current.issues.push(issue); result[issue.department] = current; return result; }, {}));
    return send(response, 200, { departments, issues });
  }
  if (request.method === "GET" && requestUrl.pathname === "/api/reports/vendors") {
    const purchases = readPurchases(); const inventory = readInventory(); const vendors = readVendors().map((vendor) => { const rows = purchases.filter((entry) => entry.vendorId === vendor.vendorId); const suppliedItems = inventory.filter((item) => item.vendor === vendor.vendorName || item.vendors?.some((entry) => entry.vendorId === vendor.vendorId)); const items = [...new Set([...rows.map((entry) => entry.itemName), ...suppliedItems.map((item) => item.name)])]; const suppliedPrices = suppliedItems.flatMap((item) => item.vendors?.filter((entry) => entry.vendorId === vendor.vendorId).map((entry) => entry.purchasePrice) || []); return { ...vendor, items, purchaseQuantity: rows.reduce((sum, entry) => sum + entry.quantity, 0), purchaseValue: rows.reduce((sum, entry) => sum + entry.totalPurchaseCost, 0), averagePurchasePrice: rows.length ? rows.reduce((sum, entry) => sum + entry.unitPrice, 0) / rows.length : suppliedPrices.length ? suppliedPrices.reduce((sum, price) => sum + price, 0) / suppliedPrices.length : 0, lastPurchaseDate: rows.at(-1)?.date || suppliedItems.map((item) => item.lastPurchaseDate).filter(Boolean).sort().at(-1) || "" }; });
    return send(response, 200, { vendors });
  }
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
  if (request.method === "POST" && request.url === "/api/master-list") {
    try { const payload = await requestBody(request); return send(response, 200, processMasterList(payload.data, payload.filename, payload.text)); }
    catch (error) { return send(response, 400, { error: error.message }); }
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