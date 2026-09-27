import { Plus, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchInventory, mutateInventory } from "../lib/api";
import "./Inventory.css";

const defaultCategories = ["Vegetables", "Stock", "Housekeeping & Disposables"];
const emptyForm = { name: "", quantity: "", unit: "kg", operation: "add", category: "Stock", department: "", unitPrice: "", reorderLevel: "" };

function stockStatus(item) {
  const currentStock = Number(item.quantity);
  const reorderLevel = Number(item.reorderLevel);
  if (currentStock === 0) return "out";
  if (currentStock > 0 && reorderLevel > 0 && currentStock <= reorderLevel) return "low";
  return "in";
}

function Inventory() {
  const [inventory, setInventory] = useState([]);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchInventory().then((items) => { if (active) setInventory(items); }).catch((loadError) => { if (active) setError(loadError.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const categories = ["All", ...new Set([...defaultCategories, ...inventory.map((item) => item.category).filter(Boolean)])];
  const visible = inventory.filter((item) => { const currentStatus = stockStatus(item); return (category === "All" || item.category === category) && `${item.itemCode || ""} ${item.name} ${item.vendor || ""} ${item.category}`.toLowerCase().includes(query.toLowerCase()) && (status === "all" || status === currentStatus); });
  const needsAttention = inventory.filter((item) => stockStatus(item) !== "in");
  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim() || (form.operation !== "set" && !form.quantity)) return setError("Add an item name and quantity.");
    setSaving(true); setError("");
    try {
      const result = await mutateInventory({ ...form, quantity: form.quantity ? Number(form.quantity) : undefined, unitPrice: form.unitPrice ? Number(form.unitPrice) : undefined, reorderLevel: form.reorderLevel ? Number(form.reorderLevel) : undefined });
      setInventory(result.inventory); setForm(emptyForm); setShowForm(false); setCategory(result.changed.category);
    } catch (saveError) { setError(saveError.message); } finally { setSaving(false); }
  }

  return <section><div className="page-heading"><div><span className="eyebrow">HOTEL STOCK CONTROL</span><h2>Inventory</h2><p>Today's stock, usage, and balance by operating area.</p></div><div className="inventory-actions"><button className="ghost-button" onClick={() => window.location.reload()}><RefreshCw size={16} /> Refresh</button><button className="primary-button compact" onClick={() => setShowForm(true)}><Plus size={16} /> Add / update</button></div></div><div className="metric-grid"><div className="metric-card"><small>Total items</small><strong>{inventory.length}</strong><span>Permanent coded items</span></div><div className="metric-card"><small>Needs attention</small><strong>{needsAttention.length}</strong><span>Out of stock or below reorder level</span></div><div className="metric-card"><small>Visible category</small><strong>{visible.length}</strong><span>{category}</span></div></div><div className="category-tabs">{categories.map((itemCategory) => <button className={category === itemCategory ? "selected" : ""} onClick={() => setCategory(itemCategory)} key={itemCategory}>{itemCategory}<span>{itemCategory === "All" ? inventory.length : inventory.filter((item) => item.category === itemCategory).length}</span></button>)}</div><div className="table-panel"><div className="table-toolbar"><div><h3>{category}</h3><small>Search by item code, item, vendor, or category</small></div><label className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find item or code" /></label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All status</option><option value="out">Out of stock</option><option value="low">Low stock</option><option value="in">In stock</option></select></div>{loading ? <div className="empty-state">Loading your workbook...</div> : error ? <div className="empty-state form-error">{error}</div> : <div className="table-scroll"><table><thead><tr><th>Item code</th><th>Item name / vendor</th><th>Category</th><th>Current stock</th><th>Unit</th><th>Last purchase price</th><th>Last purchase date</th><th>Total purchased</th><th>Total issued</th><th>Status</th></tr></thead><tbody>{visible.map((item) => { const currentStatus = stockStatus(item); const out = currentStatus === "out"; const low = currentStatus === "low"; return <tr key={item.id} className={out ? "out-of-stock-row" : ""}><td><strong>{item.itemCode}</strong></td><td><strong>{item.name}</strong><small>{item.vendor || "No vendor"}</small></td><td>{item.category || "Stock"}</td><td><b className={out ? "zero-stock" : ""}>{item.quantity}</b></td><td>{item.unit}</td><td>₹{Number(item.lastPurchasePrice ?? item.unitPrice ?? 0).toLocaleString()}</td><td>{item.lastPurchaseDate ? new Date(item.lastPurchaseDate).toLocaleDateString() : "-"}</td><td>{Number(item.purchased || 0)} {item.unit}</td><td>{Number(item.issued || 0)} {item.unit}</td><td><span className={`stock-pill ${out ? "out" : low ? "low" : "good"}`}>{out ? "OUT OF STOCK" : low ? "LOW STOCK" : "IN STOCK"}</span></td></tr>; })}</tbody></table></div>}</div>{showForm && <div className="form-overlay"><form className="inventory-form" onSubmit={save}><div className="form-heading"><div><span className="eyebrow">MANUAL LEDGER ENTRY</span><h3>Add or update inventory</h3></div><button type="button" className="icon-button" onClick={() => setShowForm(false)} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label>Item name<input required value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="e.g. Chicken Breast" /></label><label>Category<select value={form.category} onChange={(event) => updateField("category", event.target.value)}>{defaultCategories.map((itemCategory) => <option key={itemCategory}>{itemCategory}</option>)}</select></label><label>Action<select value={form.operation} onChange={(event) => updateField("operation", event.target.value)}><option value="add">Add received stock</option><option value="remove">Record used / issued</option><option value="set">Set remaining balance</option></select></label><label>Quantity<input type="number" min="0" step="any" value={form.quantity} onChange={(event) => updateField("quantity", event.target.value)} /></label><label>Unit<select value={form.unit} onChange={(event) => updateField("unit", event.target.value)}><option>kg</option><option>g</option><option>L</option><option>ml</option><option>unit</option></select></label><label>Used by / department<input value={form.department} onChange={(event) => updateField("department", event.target.value)} placeholder="Chinese / South Indian" /></label><label>Unit price (₹)<input type="number" min="0" step="any" value={form.unitPrice} onChange={(event) => updateField("unitPrice", event.target.value)} /></label><label>Reorder level<input type="number" min="0" step="any" value={form.reorderLevel} onChange={(event) => updateField("reorderLevel", event.target.value)} /></label></div>{error && <small className="form-error">{error}</small>}<button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save ledger entry"}</button></form></div>}</section>;
}

export default Inventory;
