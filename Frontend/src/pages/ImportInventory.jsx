import { ArrowRight, FileSpreadsheet, UploadCloud } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { importInventoryFile, importInventoryText, importMasterListFile, importMasterListText } from "../lib/api";
import "./ImportInventory.css";

function ImportInventory() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [manualText, setManualText] = useState("");
  const [mode, setMode] = useState("file");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (mode === "master-text") {
        if (!manualText.trim()) throw new Error("Paste the Master List table first.");
        setResult(await importMasterListText(manualText));
      } else if (mode === "master-file") {
        if (!file) throw new Error("Choose the Master List file first.");
        setResult(await importMasterListFile(file));
      } else if (mode === "text") {
        if (!manualText.trim()) throw new Error("Paste inventory lines or type them in first.");
        await importInventoryText(manualText, "manual-import.txt");
      } else {
        if (!file) throw new Error("Choose an Excel, Word, text, or image file first.");
        await importInventoryFile(file);
      }
      if (!mode.startsWith("master")) navigate("/");
    } catch (importError) {
      setError(importError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="import-page">
      <div className="import-card">
        <span className="import-icon"><FileSpreadsheet size={30} /></span>
        <span className="eyebrow">FIRST WORKSPACE SETUP</span>
        <h1>{mode.startsWith("master") ? "Process your Master List." : "Bring your inventory in."}</h1>
        <p>Upload Excel, Word, txt, or a photo of your stock list. StockMate can read the rows, normalize the quantities, and keep Stocky updated.</p>

        <div className="tab-row" style={{ display: "flex", gap: "0.75rem", margin: "1rem 0" }}>
          <button type="button" className={mode === "file" ? "primary-button compact" : "ghost-button"} onClick={() => setMode("file")}>File upload</button>
          <button type="button" className={mode === "text" ? "primary-button compact" : "ghost-button"} onClick={() => setMode("text")}>Paste items</button>
          <button type="button" className={mode === "master-file" ? "primary-button compact" : "ghost-button"} onClick={() => setMode("master-file")}>Master List file</button>
          <button type="button" className={mode === "master-text" ? "primary-button compact" : "ghost-button"} onClick={() => setMode("master-text")}>Master List text</button>
        </div>

        <form onSubmit={submit}>
          {mode === "file" || mode === "master-file" ? (
            <label className="file-drop">
              <UploadCloud size={24} />
              <strong>{file ? file.name : "Choose your inventory file"}</strong>
              <small>{mode === "master-file" ? "Excel or CSV with Item Code, Item Name, Vendor, Quantity, Price, dates..." : "Excel .xlsx / .xls / CSV, Word .docx, or image .png / .jpg"}</small>
              <input type="file" accept=".xlsx,.xls,.csv,.docx,.txt,.png,.jpg,.jpeg,.webp" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            </label>
          ) : (
            <label className="file-drop" style={{ display: "block", minHeight: "180px" }}>
              <strong>{mode === "master-text" ? "Paste Master List table" : "Paste items to add"}</strong>
              <small>{mode === "master-text" ? "Include headers such as Item Code, Item Name, Vendor, Current Stock, Unit Price, Purchase Date." : "Example: Rice Flour 5 kg; Tomato - 12 kg; Wheat 2 boxes"}</small>
              <textarea value={manualText} onChange={(event) => setManualText(event.target.value)} rows={8} style={{ width: "100%", marginTop: "0.75rem", resize: "vertical" }} placeholder={"Rice Flour 5 kg\nTomato - 12 kg\nWheat 2 boxes"} />
            </label>
          )}

          {error && <small className="login-error">{error}</small>}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Processing..." : mode.startsWith("master") ? "Process Master List" : "Import inventory"}
            <ArrowRight size={17} />
          </button>
        </form>

        {result && <div className="import-columns"><strong>Master List processed</strong><span>{result.reply}</span><button type="button" className="primary-button compact" onClick={() => navigate("/chat")}>Ask Stocky about the updated data</button></div>}

        <div className="import-columns">
          <strong>Recommended line format</strong>
          <span>Item name + quantity + unit, such as Rice 5 kg or Tomato - 12 kg</span>
        </div>
      </div>
    </main>
  );
}

export default ImportInventory;