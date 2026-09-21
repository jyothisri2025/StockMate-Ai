import { AlertTriangle, Boxes, Plus, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchInventory, mutateInventory } from "../lib/api";
import "./Inventory.css";

const categories = ["Vegetables", "Stock", "Housekeeping & Disposables"];
const emptyForm = { name: "", quantity: "", unit: "kg", operation: "add", category: "Stock", department: "", unitPrice: "", reorderLevel: "" };

function Inventory() {
  const [inventory, setInventory] = useState([]);
  const [category, setCategory] = useState("Vegetables");
  const [query, setQuery] = useState("");
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

  const visible = inventory.filter((item) => item.category === category && item.name.toLowerCase().includes(query.toLowerCase()));
  const lowStock = inventory.filter((item) => item.reorderLevel > 0 && item.quantity <= item.reorderLevel);
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

  return <section><div className="page-heading"><div><span className="eyebrow">HOTEL STOCK CONTROL</span><h2>Inventory</h2><p>Today&apos;s stock, usage, and balance by operating area.</p></div><div className="inventory-actions"><button className="ghost-button" onClick={() => window.location.reload()}><RefreshCw size={16} /> Refresh</button><button className="primary-button compact" onClick={() => setShowForm(true)}><Plus size={16} /> Add / update</button></div></div><div className="metric-grid"><div className="metric-card"><span className="metric-icon green"><Boxes size={18} /></span><small>Total items</small><strong>{inventory.length}</strong><span>Across 3 workbook pages</span></div><div className="metric-card"><span className="metric-icon amber"><AlertTriangle size={18} /></span><small>Needs attention</small><strong>{lowStock.length}</strong><span>Below reorder level</span></div><div className="metric-card"><span className="metric-icon blue"><Boxes size={18} /></span><small>Visible category</small><strong>{visible.length}</strong><span>{category}</span></div></div><div className="category-tabs">{categories.map((itemCategory) => <button className={category === itemCategory ? "selected" : ""} onClick={() => setCategory(itemCategory)} key={itemCategory}>{itemCategory}<span>{inventory.filter((item) => item.category === itemCategory).length}</span></button>)}</div><div className="table-panel"><div className="table-toolbar"><div><h3>{category}</h3><small>Imported page, organized for daily operations</small></div><label className="search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an item" /></label></div>{loading ? <div className="empty-state">Loading your workbook...</div> : <div className="table-scroll"><table><thead><tr><th>Item</th><th>Stock today</th><th>Used today</th><th>Left</th><th>Price</th><th>Used by / department</th><th>Status</th></tr></thead><tbody>{visible.map((item) => { const low = item.reorderLevel > 0 && item.quantity <= item.reorderLevel; const users = Object.entries(item.usageByDepartment || {}); return <tr key={item.id}><td><strong>{item.name}</strong><small>{item.vendor || item.sourceSheet}</small></td><td>{item.stockToday || item.totalQuantity || 0} {item.unit}</td><td>{item.usedToday || item.issued || 0} {item.unit}</td><td><b>{item.quantity} {item.unit}</b></td><td>₹{Number(item.unitPrice || 0).toLocaleString()}</td><td>{users.length ? users.map(([name, value]) => <span className="usage-chip" key={name}>{name}: {value}</span>) : <small>{item.department || "Not recorded"}</small>}</td><td><span className={`stock-pill ${low ? "low" : "good"}`}>{low ? "Low stock" : "Available"}</span></td></tr>; })}</tbody></table></div>}</div>{showForm && <div className="form-overlay"><form className="inventory-form" onSubmit={save}><div className="form-heading"><div><span className="eyebrow">MANUAL LEDGER ENTRY</span><h3>Add or update inventory</h3></div><button type="button" className="icon-button" onClick={() => setShowForm(false)} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label>Item name<input required value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="e.g. Chicken Breast" /></label><label>Category<select value={form.category} onChange={(event) => updateField("category", event.target.value)}>{categories.map((itemCategory) => <option key={itemCategory}>{itemCategory}</option>)}</select></label><label>Action<select value={form.operation} onChange={(event) => updateField("operation", event.target.value)}><option value="add">Add received stock</option><option value="remove">Record used / issued</option><option value="set">Set remaining balance</option></select></label><label>Quantity<input type="number" min="0" step="any" value={form.quantity} onChange={(event) => updateField("quantity", event.target.value)} /></label><label>Unit<select value={form.unit} onChange={(event) => updateField("unit", event.target.value)}><option>kg</option><option>g</option><option>L</option><option>ml</option><option>unit</option></select></label><label>Used by / department<input value={form.department} onChange={(event) => updateField("department", event.target.value)} placeholder="Chinese / South Indian" /></label><label>Unit price (₹)<input type="number" min="0" step="any" value={form.unitPrice} onChange={(event) => updateField("unitPrice", event.target.value)} /></label><label>Reorder level<input type="number" min="0" step="any" value={form.reorderLevel} onChange={(event) => updateField("reorderLevel", event.target.value)} /></label></div>{error && <small className="form-error">{error}</small>}<button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving..." : "Save ledger entry"}</button></form></div>}</section>;
}

export default Inventory;
