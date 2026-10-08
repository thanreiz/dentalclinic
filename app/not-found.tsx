import { ButtonLink } from '@/components/ui/Button';
import { ToothIcon } from '@/components/ui/icons';

export default function NotFound() {
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center px-4 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-brand-50 text-brand-700">
        <ToothIcon className="size-7" />
      </span>
      <p className="mt-4 text-sm font-semibold text-brand-800">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-600">The page or record you are looking for does not exist or was removed.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <ButtonLink href="/dashboard" variant="primary">
          Go to dashboard
        </ButtonLink>
        <ButtonLink href="/book">Book an appointment</ButtonLink>
      </div>
    </main>
  );
}
