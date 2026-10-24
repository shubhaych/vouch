export function PageHeader({ title, lede, aside }: { title: string; lede?: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {lede && <p className="mt-2 text-lg text-muted">{lede}</p>}
      </div>
      {aside}
    </div>
  );
}
