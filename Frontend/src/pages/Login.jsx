import { ArrowRight, Bot, LockKeyhole, UserRound } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../lib/api";

function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(event) { event.preventDefault(); setError(""); try { const result = await login(username, password); navigate(result.needsImport ? "/import" : "/"); } catch (loginError) { setError(loginError.message); } }
  return <main className="login-page"><div className="login-art"><div className="login-mark"><Bot size={32} /></div><span className="eyebrow">STOCKMATE AI</span><h1>Inventory that<br /><em>keeps up.</em></h1><p>One calm place to track what comes in, what goes out, and what needs your attention.</p></div><form className="login-card" onSubmit={submit}><div className="login-card-head"><span className="brand-mark"><Bot size={20} /></span><div><strong>Welcome back</strong><small>Sign in to your workspace</small></div></div><label><span><UserRound size={15} />Username</span><input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} placeholder="psr@321" /></label><label><span><LockKeyhole size={15} />Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /></label>{error && <small className="login-error">{error}</small>}<button className="primary-button" type="submit">Enter workspace <ArrowRight size={17} /></button><small className="login-note">Sign in to upload your inventory workbook.</small></form></main>;
}

export default Login;
