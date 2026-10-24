// Section 4's diagram as an SVG: browsers and the phone talk to SpacetimeDB
// directly; the worker holds the keys and does the slow work.
export function ArchitectureDiagram() {
  const box = (x: number, y: number, w: number, h: number, title: string, lines: string[], stroke = "#22d3ee") => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill="rgba(15,22,40,0.85)" stroke={stroke} strokeOpacity={0.55} />
      <text x={x + 12} y={y + 22} fill="#e8edf2" fontSize={13} fontWeight={700}>{title}</text>
      {lines.map((l, i) => <text key={i} x={x + 12} y={y + 42 + i * 16} fill="#8b9aab" fontSize={11}>{l}</text>)}
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number, label: string, color = "#22d3ee") => (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.5} markerEnd="url(#arr)" strokeDasharray="5 4" />
      <text x={(x1 + x2) / 2 + 6} y={(y1 + y2) / 2 - 6} fill="#8b9aab" fontSize={10}>{label}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 980 360" className="h-auto w-full" role="img" aria-label="Architecture diagram">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#22d3ee" /></marker>
      </defs>
      {box(20, 20, 220, 92, "Browser (Next.js)", ["/world /business /lab /system", "subscribes to tables, calls reducers"])}
      {box(20, 134, 220, 92, "Phone (/claim/[id])", ["records the claim video", "uploads to the worker, watches rows"])}
      {box(20, 248, 220, 92, "Judge's laptop (/shop)", ["joins as a shopper agent", "buy, fast-forward, request refund"])}
      {box(370, 92, 260, 176, "SpacetimeDB module", ["the only database", "tick: scheduled reducer, 10,000 agents", "credit, region stats, patterns", "segregation of duties in reducers", "private: agent_truth, refund_intent", "views: my_agent"], "#34d399")}
      {box(740, 20, 220, 120, "Worker (Node, laptop)", ["privileged worker + poster identities", "ffmpeg frames, dHash reuse check", "detectors every 5 days", "credential signing (Ed25519)"], "#fbbf24")}
      {box(740, 170, 220, 76, "CREAO (3 saved agents)", ["Evidence Analyst · Investigator", "Pattern Analyst · API Trigger"], "#a78bfa")}
      {box(740, 264, 220, 76, "Factory Droid SDK", ["Detector Lab sessions", "fenced to detectors/candidates"], "#f472b6")}
      {arrow(240, 66, 370, 140, "subscribe / reducers")}
      {arrow(240, 180, 370, 180, "subscribe")}
      {arrow(240, 294, 370, 230, "reducers")}
      {arrow(630, 160, 740, 90, "privileged reducers")}
      {arrow(860, 140, 860, 170, "runs + poll", "#a78bfa")}
      {arrow(860, 246, 860, 264, "jobs", "#f472b6")}
      {arrow(240, 160, 740, 60, "video upload (HTTP)", "#fbbf24")}
    </svg>
  );
}
