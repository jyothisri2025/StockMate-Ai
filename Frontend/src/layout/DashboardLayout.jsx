import { NavLink, Outlet, Link } from "react-router-dom";
import { motion } from "motion/react";
import { Bot, Boxes, CircleHelp, History as HistoryIcon, LayoutDashboard, Menu, Settings, X } from "lucide-react";
import { useState } from "react";

function DashboardLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigation = [
    { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
    { to: "/chat", label: "Talk to Stocky", icon: Bot },
    { to: "/inventory", label: "Inventory", icon: Boxes },
    { to: "/history", label: "History", icon: HistoryIcon },
    { to: "/settings", label: "Settings", icon: Settings },
    { to: "/help", label: "Help", icon: CircleHelp }
  ];
  return (
    <div className="dashboard-layout">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand"><span className="brand-mark"><Bot size={20} /></span><span>StockMate <b>AI</b></span></div>
        <Link className="profile" to="/profile" onClick={() => setMenuOpen(false)}><span className="avatar">A</span><span><strong>Admin</strong><small>Workspace owner</small></span></Link>
        <nav>{navigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)}><Icon size={18} />{label}</NavLink>)}</nav>
        <div className="sidebar-foot"><span className="status-dot" />Agent online<span className="version">v1.0</span></div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
          <div><span className="eyebrow">INVENTORY OPERATIONS</span><h1>StockMate <em>AI</em></h1></div>
          <div className="topbar-date">Today<br /><strong>{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong></div>
        </header>
        <motion.div className="page-content" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}><Outlet /></motion.div>
      </main>
    </div>
  );
}

export default DashboardLayout;