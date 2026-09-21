import { Building2, CheckCircle2, Mail, ShieldCheck, UserRound } from "lucide-react";
import "./Profile.css";

function Profile() {
  return <section className="profile-page"><div className="page-heading"><div><span className="eyebrow">WORKSPACE IDENTITY</span><h2>Profile</h2><p>Your StockMate operator profile and workspace access.</p></div><span className="profile-status"><CheckCircle2 size={15} /> Active account</span></div><div className="profile-grid"><div className="profile-card profile-summary"><div className="profile-large-avatar">A</div><h3>Admin</h3><p>Hotel inventory operator</p><span className="profile-tag"><ShieldCheck size={14} /> Workspace owner</span></div><div className="profile-card profile-details"><label><UserRound size={16} /><span>Username<strong>psr@321</strong></span></label><label><Mail size={16} /><span>Account access<strong>Private workspace</strong></span></label><label><Building2 size={16} /><span>Workspace<strong>Hotel Vaishnavi Grand</strong></span></label><div className="profile-note">Stocky uses this profile to keep inventory changes and history tied to your workspace.</div></div></div></section>;
}

export default Profile;