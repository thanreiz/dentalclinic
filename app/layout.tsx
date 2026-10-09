import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: process.env.CLINIC_NAME ?? 'G4 Dental Clinic', template: `%s · ${process.env.CLINIC_NAME ?? 'G4 Dental Clinic'}` },
  description: 'Appointment scheduling and attendance tracking for a small dental clinic',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
