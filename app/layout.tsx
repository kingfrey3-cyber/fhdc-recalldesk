import './globals.css';
import AppShell from './ui/AppShell';

export const metadata = {
  title: 'FHDC RecallDesk',
  description: 'FHDC patient recall and staff payment management system',
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/fhdc-logo.png'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
