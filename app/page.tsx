import { redirect } from 'next/navigation';

/** `/` -> staff dashboard (middleware sends logged-out visitors to /login first). */
export default function Home() {
  redirect('/dashboard');
}
