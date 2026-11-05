import type { Metadata } from 'next';
import { DM_Sans } from 'next/font/google';
import './globals.css';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap' });

export const metadata: Metadata = {
  title: { default: process.env.CLINIC_NAME ?? 'Molar & Co.', template: `%s · ${process.env.CLINIC_NAME ?? 'Molar & Co.'}` },
  description: 'Appointment scheduling and attendance tracking for a small dental clinic',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
