"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import LogoutButton from './LogoutButton';

type AppRole = 'admin' | 'manager' | 'recall_staff' | 'verifier' | 'finance' | 'viewer';

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
};

const publicRoutes = ['/login', '/setup'];

const navItems: Array<{ href: string; label: string; roles?: AppRole[] }> = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/upload', label: 'Upload', roles: ['admin', 'manager'] },
  { href: '/calling', label: 'Calling List', roles: ['admin', 'manager', 'recall_staff', 'verifier'] },
  { href: '/payments', label: 'Payments', roles: ['admin', 'manager', 'finance'] },
  { href: '/account', label: 'Account' },
  { href: '/settings', label: 'Settings', roles: ['admin'] }
];

function isPublicPath(pathname: string) {
  return publicRoutes.some(route => pathname === route || pathname.startsWith(`${route}/`));
}

function canSee(item: { roles?: AppRole[] }, user: SessionUser | null) {
  if (!user) return false;
  if (!item.roles) return true;
  return item.roles.includes(user.role);
}

function Header({ user }: { user: SessionUser }) {
  const pathname = usePathname() || '/';
  const visibleItems = useMemo(() => navItems.filter(item => canSee(item, user)), [user]);

  return (
    <header className="topbar">
      <Link className="brand" href="/dashboard" aria-label="FHDC RecallDesk">
        <img src="/fhdc-logo.png" alt="Family Health Dental Clinic" className="brand-logo" />
        <div className="brand-text">
          <strong>RecallDesk</strong>
          <span>Patient Recall &amp; Pay Control</span>
        </div>
      </Link>

      <nav className="nav" aria-label="Main navigation">
        {visibleItems.map(item => (
          <Link key={item.href} href={item.href} className={pathname === item.href ? 'active' : ''}>{item.label}</Link>
        ))}
        <LogoutButton />
      </nav>
    </header>
  );
}

function CheckingAccess() {
  return (
    <main className="container">
      <div className="auth-check-card">
        <img src="/fhdc-logo.png" alt="Family Health Dental Clinic" className="auth-check-logo" />
        <h2>Checking your RecallDesk access...</h2>
        <p className="note">Please wait while the system confirms your sign-in.</p>
      </div>
    </main>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const publicMode = isPublicPath(pathname);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(!publicMode);

  useEffect(() => {
    let cancelled = false;

    if (publicMode) {
      // Public pages must remain clean: no internal tabs, no logout button, no /api/me call.
      setUser(null);
      setLoading(false);
      return () => { cancelled = true; };
    }

    async function loadUser() {
      setLoading(true);
      try {
        const res = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        const nextUser = data?.user || null;
        if (cancelled) return;
        setUser(nextUser);

        if (!nextUser) {
          router.replace('/login');
          return;
        }
      } catch {
        if (cancelled) return;
        setUser(null);
        router.replace('/login');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadUser();
    return () => { cancelled = true; };
  }, [pathname, publicMode, router]);

  if (publicMode) {
    return (
      <div className="auth-page-shell">
        <main className="container public-container">{children}</main>
      </div>
    );
  }

  if (loading || !user) {
    return (
      <div className="app-shell">
        <CheckingAccess />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Header user={user} />
      <main className="container">{children}</main>
    </div>
  );
}
