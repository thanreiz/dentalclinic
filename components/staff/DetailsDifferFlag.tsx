import { AlertIcon } from '@/components/ui/icons';
import { cx } from '@/components/ui/cx';

/**
 * SECURITY-REVIEW M2: warning shown when an online request matched an existing patient by contact
 * number but the typed name/email/birthdate differed (flag line at the start of patient_note,
 * see lib/patient-note.ts). The record itself was not changed.
 */
export function DetailsDifferFlag({ flag, className }: { flag: string; className?: string }) {
  // "[Details differ from patient record: name "…", …. Verify before confirming.]" -> inner text.
  const text = flag.replace(/^\[/, '').replace(/\]$/, '');
  return (
    <p
      role="note"
      className={cx(
        'flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 ring-1 ring-amber-300',
        className,
      )}
    >
      <AlertIcon className="mt-0.5 size-4 shrink-0 text-amber-700" />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}
