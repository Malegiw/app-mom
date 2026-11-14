import { useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { House, Mic, Plus, Settings } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Logo } from "./Logo";
import { NewMeetingDialog } from "./NewMeetingDialog";

const ICON = { size: 20, strokeWidth: 1.75, "aria-hidden": true } as const;

/** Sidebar on tablets and computers, a top bar with a bottom tab bar on phones. */
export function AppShell({ children }: { children: ReactNode }) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <Logo />
          <span className="brandText">
            Notula
            <small>by YMD</small>
          </span>
        </Link>
        <Button className="cta tone-orange" onClick={() => setCreating(true)}>
          <Plus {...ICON} />
          Rapat baru
        </Button>
        <nav className="nav" aria-label="Menu utama">
          <NavLink to="/" end className="navLink">
            <House {...ICON} />
            Rapat
          </NavLink>
          <NavLink to="/pengaturan" className="navLink">
            <Settings {...ICON} />
            Pengaturan
          </NavLink>
        </nav>
        <p className="sidebarFoot">Notula by YMD. Semua rapat tersimpan di perangkat ini.</p>
      </aside>

      <div className="main">
        <header className="topbar">
          <Link to="/" className="brand">
            <Logo size={28} />
            <span className="brandText">
              Notula
              <small>by YMD</small>
            </span>
          </Link>
        </header>
        {children}
      </div>

      <nav className="bottomNav" aria-label="Menu utama">
        <NavLink to="/" end className="bottomLink">
          <House {...ICON} />
          Rapat
        </NavLink>
        <button type="button" className="fab" onClick={() => setCreating(true)} aria-label="Rapat baru">
          <Mic size={24} strokeWidth={2} aria-hidden="true" />
        </button>
        <NavLink to="/pengaturan" className="bottomLink">
          <Settings {...ICON} />
          Pengaturan
        </NavLink>
      </nav>

      <NewMeetingDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
