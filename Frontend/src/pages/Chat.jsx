import { ArrowUp, Bot, CheckCircle2, Plus, RotateCcw, Sparkles, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { askStocky, fetchChatHistory, importMasterListFile } from "../lib/api";

const examples = ["Add 5 kg rice", "I used 2 litres of oil", "How much sugar is left?", "Process Master List"];

function Chat() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([{ role: "agent", text: "Hi, I’m Stocky. Tell me what happened in the kitchen today and I’ll keep the ledger straight." }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const masterFileRef = useRef(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages]);
  useEffect(() => { let active = true; fetchChatHistory().then((history) => { if (active && history.length) setMessages(history.flatMap((entry) => [{ role: "user", text: entry.message }, { role: "agent", text: entry.reply, changed: entry.changed }])); }).catch(() => {}); return () => { active = false; }; }, []);

  async function submit(event) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput(""); setMessages((current) => [...current, { role: "user", text }]); setLoading(true);
    try { const result = await askStocky(text); setMessages((current) => [...current, { role: "agent", text: result.reply, changed: result.changed }]); }
    catch (error) { setMessages((current) => [...current, { role: "agent", text: error.message }]); }
    finally { setLoading(false); }
  }

  async function processMasterList(event) {
    const file = event.target.files?.[0]; if (!file) return;
    setMessages((current) => [...current, { role: "user", text: `Process Master List: ${file.name}` }]); setLoading(true);
    try { const result = await importMasterListFile(file); setMessages((current) => [...current, { role: "agent", text: result.reply, changed: "Master List" }]); }
    catch (error) { setMessages((current) => [...current, { role: "agent", text: error.message }]); }
    finally { setLoading(false); event.target.value = ""; }
  }

  return <section className="chat-page">
    <div className="page-heading"><div><span className="eyebrow">YOUR INVENTORY COPILOT</span><h2>Talk to Stocky</h2><p>Update stock in plain language. Stocky keeps the numbers tidy.</p></div><button className="ghost-button" onClick={() => setMessages([])}><RotateCcw size={16} /> Clear chat</button></div>
    <div className="chat-layout">
      <div className="chat-panel">
        <div className="chat-panel-head"><span className="agent-avatar"><Bot size={19} /></span><div><strong>Stocky</strong><small><span className="status-dot" />Ready to help</small></div><Sparkles className="sparkle" size={18} /></div>
        <div className="messages">{messages.map((message, index) => <div className={`message-row ${message.role}`} key={`${message.text}-${index}`}><span className="message-avatar">{message.role === "agent" ? <Bot size={16} /> : <UserRound size={16} />}</span><div className="message-bubble">{message.text}{message.changed && <div className="update-chip"><CheckCircle2 size={14} />Inventory updated</div>}</div></div>)}{loading && <div className="message-row agent"><span className="message-avatar"><Bot size={16} /></span><div className="message-bubble typing">Stocky is thinking...</div></div>}<div ref={endRef} /></div>
        <div className="suggestions">{examples.map((example) => <button key={example} onClick={() => example === "Process Master List" ? navigate("/import") : setInput(example)}>{example}</button>)}</div>
        <form className="composer" onSubmit={submit}><input ref={masterFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={processMasterList} hidden /><button type="button" className="composer-import" onClick={() => masterFileRef.current?.click()} aria-label="Process Master List"><Plus size={18} /></button><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Tell Stocky what happened today..." aria-label="Message Stocky" /><button type="submit" aria-label="Send message"><ArrowUp size={19} /></button></form>
      </div>
      <aside className="chat-aside"><span className="eyebrow">TRY SAYING</span><h3>Natural language is enough.</h3><ul><li><b>Add</b> or bought 10 kg flour</li><li><b>Used</b> 500 g sugar today</li><li><b>How much</b> cooking oil is left?</li><li><b>Process</b> a Master List with the plus button</li><li><b>Clear</b> my chat history</li></ul><div className="note"><Sparkles size={16} /><span>Stocky reads the updated inventory, vendors, purchases, issues, and reports.</span></div></aside>
    </div>
  </section>;
}

export default Chat;