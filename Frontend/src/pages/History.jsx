import { ArrowDownLeft, ArrowUpRight, History as HistoryIcon, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchHistory } from "../lib/api";
import "./History.css";

function History() {
	const [history, setHistory] = useState([]);
	const [loading, setLoading] = useState(true);
	async function load() { setLoading(true); try { setHistory(await fetchHistory()); } finally { setLoading(false); } }
	useEffect(() => { let active = true; fetchHistory().then((items) => { if (active) setHistory(items); }).catch(() => {}).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
	return <section><div className="page-heading"><div><span className="eyebrow">AUDIT TRAIL</span><h2>History</h2><p>Every inventory change Stocky has recorded for you.</p></div><button className="ghost-button" onClick={load}><RefreshCw size={16} /> Refresh</button></div><div className="history-panel">{loading ? <div className="empty-state">Loading activity...</div> : history.length === 0 ? <div className="empty-state"><HistoryIcon size={28} /><p>Your inventory activity will appear here.</p></div> : history.map((entry) => <article className="history-row" key={entry.id}><span className={`history-icon ${entry.operation === "remove" ? "remove" : "add"}`}>{entry.operation === "remove" ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span><div><strong>{entry.itemName}</strong><p>{entry.message}</p></div><div className="history-amount"><b>{entry.operation === "remove" ? "-" : "+"}{entry.quantity} {entry.unit}</b><small>{new Date(entry.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></div></article>)}</div></section>;
}

export default History;
