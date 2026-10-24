import { LADDER } from "@/lib/product";

export function LadderTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="text-sm text-muted">
          <tr>
            <th className="py-2 pr-4 font-medium">Tier</th>
            <th className="py-2 pr-4 font-medium">Who</th>
            <th className="py-2 pr-4 font-medium">Lane</th>
            <th className="py-2 pr-4 font-medium">Cap</th>
            <th className="py-2 font-medium">What happens</th>
          </tr>
        </thead>
        <tbody>
          {LADDER.map((r) => (
            <tr key={`${r.tier}-${r.who}`} className="border-t border-line align-top">
              <td className="py-2 pr-4 font-semibold">{r.tier}</td>
              <td className="py-2 pr-4">{r.who}</td>
              <td className="py-2 pr-4 font-bold text-accent">{r.lane}</td>
              <td className="py-2 pr-4">{r.cap}</td>
              <td className="py-2">{r.happens}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
