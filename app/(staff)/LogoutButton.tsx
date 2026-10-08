'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { LogoutIcon } from '@/components/ui/icons';

export default function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      onClick={async () => {
        setPending(true);
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        router.replace('/login');
        router.refresh();
      }}
    >
      {!pending && <LogoutIcon className="size-4" />}
      Log out
    </Button>
  );
}
