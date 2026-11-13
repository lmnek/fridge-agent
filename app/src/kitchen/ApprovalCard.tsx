/** The human's yes before anything touches money: a Rohlík tool call or the order itself (moved from App.tsx). */

interface CartLine {
  name: string;
  qty?: number;
  price_czk?: number;
}
export type Approval =
  | { kind: "order"; id: string; items: CartLine[]; total: number }
  | { kind: "mcp"; id: string; name: string; args: string };

export function ApprovalCard({ approval, onDecide }: { approval: Approval; onDecide: (ok: boolean) => void }) {
  if (approval.kind === "mcp") {
    return (
      <div className="card">
        <h3>Rohlík needs your yes</h3>
        <p className="card-lead">Coldex wants to run {approval.name.replaceAll("_", " ")}.</p>
        <pre className="args">{prettyArgs(approval.args)}</pre>
        <div className="actions">
          <button type="button" className="primary" onClick={() => onDecide(true)}>
            Allow
          </button>
          <button type="button" onClick={() => onDecide(false)}>
            Not now
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="card">
      <h3>Order from Rohlík</h3>
      <ul className="lines">
        {approval.items.map((l, i) => (
          <li key={i}>
            <span>
              {l.name}
              {l.qty && l.qty !== 1 ? ` × ${l.qty}` : ""}
            </span>
            {l.price_czk ? <span className="num">{Math.round(l.price_czk * (l.qty ?? 1))} Kč</span> : null}
          </li>
        ))}
      </ul>
      <p className="total">
        <span>Total</span>
        <span className="num">{approval.total} Kč</span>
      </p>
      <div className="actions">
        <button type="button" className="primary" onClick={() => onDecide(true)}>
          Place order
        </button>
        <button type="button" onClick={() => onDecide(false)}>
          Not now
        </button>
      </div>
    </div>
  );
}

function prettyArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2).slice(0, 600);
  } catch {
    return args.slice(0, 600);
  }
}
