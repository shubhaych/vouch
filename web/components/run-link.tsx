// An "Open run" link goes next to every AI verdict. No URL yet means the run
// has no share link (confirm where CREAO shows it), so we say so instead of linking nowhere.
export function RunLink({ url }: { url?: string | null }) {
  if (!url) return <span className="text-sm text-muted">No run link yet</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-accent underline underline-offset-2">
      Open CREAO run
    </a>
  );
}
