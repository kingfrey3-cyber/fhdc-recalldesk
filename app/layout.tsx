import './globals.css';
import Link from 'next/link';
import LogoutButton from './ui/LogoutButton';

export const metadata = {
  title: 'FHDC RecallDesk',
  description: 'FHDC patient recall and staff payment management system'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <div className="app-shell">
          <header className="topbar">
            <Link className="brand" href="/dashboard" aria-label="FHDC RecallDesk dashboard">
              <img src="/fhdc-logo.png" alt="Family Health Dental Clinic" className="brand-logo" />
              <div className="brand-text">
                <strong>RecallDesk</strong>
                <span>Patient Recall & Pay Control</span>
              </div>
            </Link>
            <nav className="nav">
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/upload">Upload</Link>
              <Link href="/calling">Calling List</Link>
              <Link href="/payments">Payments</Link>
              <Link href="/account">Account</Link>
              <Link href="/settings">Settings</Link>
              <LogoutButton />
            </nav>
          </header>
          <main className="container">{children}</main>
        </div>
      </body>
    </html>
  );
}
