import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchIcon } from '@/components/ui/icons';

export default function StaffNotFound() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <EmptyState
        icon={<SearchIcon />}
        title="Not found"
        description="That record does not exist or was removed. Check the link or search again."
        action={
          <ButtonLink href="/dashboard" variant="primary">
            Back to dashboard
          </ButtonLink>
        }
      />
    </div>
  );
}
