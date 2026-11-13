// D/E: a browser window playing the sped-up recording of the real Rohlík checkout (when the file exists), then
// "Order placed" and "Courier on the way". Start time = the newest DE stage event's ts, so the preview scrub works.
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { BusEvent } from "../bus";
import { CardFrame, czk, latest } from "./ui";
import "./CheckoutCard.css";

const VIDEO_SRC = "/demo/rohlik-checkout.mp4"; // recorded by a teammate; may be missing, then the steps below play
const SPEED = 3; // minimum playbackRate; a longer recording plays faster so it always ends before PLACED_AFTER_S
const PLACED_AFTER_S = 11; // the stepped checkout switches to "Checkout complete" after this long
const VIDEO_CAP_S = 13; // the recording switches when it ends, or at the latest after this long (F starts at +15 s)

// HACK(demo): stand-in for the screen recording when the video is missing: the checkout steps, advancing on a timer.
const STEP_S = 2.6;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const rowIn = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 260, damping: 30 } } };
const tickIn = { hidden: { pathLength: 0 }, show: { pathLength: 1, transition: { duration: 0.5, delay: 0.2 } } };

// The recording exists only if the server answers with a real video (Vite answers a missing file with index.html).
function useVideoExists(src: string) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch(src, { method: "HEAD" })
      .then((r) => live && setOk(r.ok && (r.headers.get("content-type") ?? "").startsWith("video/")))
      .catch(() => live && setOk(false));
    return () => {
      live = false;
    };
  }, [src]);
  return [ok, setOk] as const;
}

const Tick = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function CheckoutCard({ events }: { events: BusEvent[] }) {
  const start = latest(events, "stage", (e) => e.beat === "DE")?.ts ?? Date.now();
  const [now, setNow] = useState(Date.now());
  const [videoOk, setVideoOk] = useVideoExists(VIDEO_SRC);
  const [rate, setRate] = useState(SPEED);
  const [vt, setVt] = useState(0); // the recording's own clock, in its seconds
  const [ended, setEnded] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.max(0, (now - start) / 1000);
  const placed = videoOk ? ended || elapsed >= VIDEO_CAP_S : elapsed >= PLACED_AFTER_S;

  // The receipt: what is being bought, from the newest cart.
  const cart = latest(events, "cart");
  const lines: any[] = cart?.items ?? cart?.cart ?? [];
  const total = Number(cart?.total_czk ?? lines.reduce((s, r) => s + Number(r.qty ?? r.quantity ?? 1) * Number(r.price_czk ?? r.price ?? 0), 0));
  const pcs = lines.reduce((s, r) => s + Number(r.qty ?? r.quantity ?? 1), 0);

  const steps = [
    { name: "Cart", value: lines.length ? `${lines.length} products` : "Ready" },
    { name: "Delivery", value: "Today, within the hour" },
    { name: "Payment", value: "Saved card" },
    { name: "Order", value: lines.length ? czk(total) : "Confirm" },
  ];
  const step = Math.min(steps.length - 1, Math.floor(elapsed / STEP_S));

  const onMeta = (v: HTMLVideoElement) => {
    // Fit the whole recording into the beat: at least ×SPEED, faster if it is long.
    const r = Math.max(SPEED, Math.ceil(v.duration / (VIDEO_CAP_S - 1)));
    v.playbackRate = r;
    setRate(r);
  };

  return (
    <CardFrame icon="DE" kicker="Rohlík checkout" title={placed ? "Checkout complete" : "Checking out"} live={!placed}>
      <AnimatePresence mode="wait">
        {!placed ? (
          <motion.div key="browser" className="ck-checkout-wrap" exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}>
            <div className="ck-checkout-browser">
              <div className="ck-checkout-bar">
                <span className="ck-checkout-ctl" />
                <span className="ck-checkout-ctl" />
                <span className="ck-checkout-ctl" />
                <div className="ck-checkout-url">
                  <svg viewBox="0 0 16 16" className="ck-checkout-lock" aria-hidden>
                    <rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor" />
                    <path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                  <span>
                    rohlik.cz<span className="ck-checkout-path">/checkout</span>
                  </span>
                </div>
              </div>
              <div className="ck-checkout-load">
                <i style={{ width: videoOk ? `${Math.min(100, (vt / (video.current?.duration || 1)) * 100)}%` : `${((step + 1) / steps.length) * 100}%` }} />
              </div>
              <div className="ck-checkout-view">
                {videoOk ? (
                  <video
                    ref={video}
                    className="ck-checkout-video"
                    src={VIDEO_SRC}
                    autoPlay
                    muted
                    playsInline
                    onLoadedMetadata={(e) => onMeta(e.currentTarget)}
                    onTimeUpdate={(e) => setVt(e.currentTarget.currentTime)}
                    onError={() => setVideoOk(false)}
                    onEnded={() => setEnded(true)}
                  />
                ) : (
                  // HACK(demo): no recording, so the checkout steps tick through on a timer.
                  <ol className="ck-checkout-steps">
                    {steps.map((s, i) => (
                      <li key={s.name} className={i < step ? "is-done" : i === step ? "is-active" : ""}>
                        <span className="ck-checkout-mark">{i < step && <Tick className="ck-checkout-mark-tick" />}</span>
                        <span className="ck-checkout-step-name">{s.name}</span>
                        <span className="ck-checkout-step-value ck-num">{s.value}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
            <div className="ck-checkout-ff">
              <span className="ck-checkout-ff-speed">
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M3 6l8 6-8 6zM12 6l8 6-8 6z" fill="currentColor" />
                </svg>
                Fast forward ×{videoOk ? rate : SPEED}
              </span>
              <span className="ck-checkout-ff-clock ck-num">{mmss(videoOk ? vt : elapsed * SPEED)}</span>
            </div>
          </motion.div>
        ) : (
          <motion.div key="done" className="ck-checkout-done" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.5 } } }} initial="hidden" animate="show">
            {lines.length > 0 && (
              <motion.div className="ck-checkout-receipt" variants={rowIn}>
                <span className="ck-checkout-receipt-total ck-num">{czk(total)}</span>
                <span className="ck-checkout-receipt-note">
                  {lines.length} products, {pcs} pcs
                  <br />
                  paid in Rohlík
                </span>
              </motion.div>
            )}
            {[
              { t: "Order placed", s: "Confirmed by Rohlík" },
              { t: "Courier on the way", s: "Arriving within the hour" },
            ].map((r) => (
              <motion.div key={r.t} className="ck-checkout-row" variants={rowIn}>
                <svg viewBox="0 0 24 24" className="ck-checkout-tick" aria-hidden>
                  <motion.path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" variants={tickIn} />
                </svg>
                <div>
                  <p className="ck-checkout-row-t">{r.t}</p>
                  <p className="ck-checkout-row-s">{r.s}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </CardFrame>
  );
}
