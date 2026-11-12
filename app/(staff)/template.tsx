/**
 * Re-mounts on every navigation between staff pages, so each page fades in once (CSS only, no client JS).
 * router.refresh() from AutoRefresh keeps this node, so the 30 s refresh never replays it.
 */
export default function StaffTemplate({ children }: { children: React.ReactNode }) {
  return <div className="motion-fade">{children}</div>;
}
