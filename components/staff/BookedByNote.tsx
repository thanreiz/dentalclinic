import { cx } from '@/components/ui/cx';

/** Request made by someone other than the patient (public form "Someone else"): who booked it. */
export function BookedByNote({ bookedBy, className }: { bookedBy: string; className?: string }) {
  return (
    <p className={cx('rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-950 ring-1 ring-sky-200', className)}>
      <span className="font-medium">Booked for this patient by: </span>
      <span className="break-words">{bookedBy}</span>
    </p>
  );
}
