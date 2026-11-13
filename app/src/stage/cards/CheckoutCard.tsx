// D/E: a minimal browser frame playing the (sped up) recording of the real Rohlík checkout, then
// "Order placed" and "Courier on the way". Start time = the newest DE stage event's ts, so the preview scrub works.
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { BusEvent } from "../bus";
import { CardFrame, latest } from "./ui";
import "./CheckoutCard.css";

const SPEED = 3; // playbackRate of the recording, and the "×N" shown in the indicator
const VIDEO_SRC = "/demo/checkout.mp4"; // lands later from a teammate
const PLACED_AFTER_S = 11; // switch to "Order placed" at the latest this long after the DE event

// HACK(demo): stand-in for the screen recording when the video is missing: the checkout steps, advancing on a timer.
const STEPS = [
  { name: "Cart", line: "Your cart" },
  { name: "Delivery slot", line: "Today, as soon as possible" },
  { name: "Payment", line: "Pay by card" },
  { name: "Order placed", line: "Thank you for your order" },
];
const STEP_S = 2.6;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const rowIn = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 260, damping: 30 } } };
const tickIn = { hidden: { pathLength: 0 }, show: { pathLength: 1, transition: { duration: 0.5, delay: 0.2 } } };

export default function CheckoutCard({ events }: { events: BusEvent[] }) {
  const start = latest(events, "stage", (e) => e.beat === "DE")?.ts ?? Date.now();
  const [now, setNow] = useState(Date.now());
  const [videoOk, setVideoOk] = useState(true);
  const [ended, setEnded] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (video.current) video.current.playbackRate = SPEED;
  }, [videoOk]);

  const elapsed = Math.max(0, (now - start) / 1000);
  const placed = ended || elapsed >= PLACED_AFTER_S;
  const step = Math.min(STEPS.length - 1, Math.floor(elapsed / STEP_S));

  return (
    <CardFrame
      kicker="Rohlík checkout"
      title={placed ? "Checkout complete" : "Checking out"}
      live={!placed}
    >
      <AnimatePresence mode="wait">
        {!placed ? (
          <motion.div key="browser" className="ck-checkout-wrap" exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}>
            <div className="ck-checkout-browser">
              <div className="ck-checkout-bar">
                <span className="ck-checkout-ctl" />
                <span className="ck-checkout-ctl" />
                <span className="ck-checkout-ctl" />
                <div className="ck-checkout-url">
                  <span className="ck-checkout-lock" />
                  rohlik.cz
                </div>
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
                    onLoadedMetadata={(e) => (e.currentTarget.playbackRate = SPEED)}
                    onError={() => setVideoOk(false)}
                    onEnded={() => setEnded(true)}
                  />
                ) : (
                  // HACK(demo): no recording, so a calm trail of the checkout steps.
                  <div className="ck-checkout-fake">
                    <p className="ck-checkout-fake-line">{STEPS[step].line}</p>
                    <ol className="ck-checkout-fake-steps">
                      {STEPS.map((s, i) => (
                        <li key={s.name} className={i < step ? "is-done" : i === step ? "is-active" : ""}>
                          <span className="ck-checkout-fake-mark" />
                          {s.name}
                        </li>
                      ))}
                    </ol>
                    <div className="ck-checkout-fake-bar">
                      <motion.i animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} transition={{ duration: 0.6, ease: "easeOut" }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="ck-checkout-ff">
              <span className="ck-checkout-ff-speed">Fast forward ×{SPEED}</span>
              <span className="ck-checkout-ff-clock">{mmss(elapsed * SPEED)}</span>
            </div>
          </motion.div>
        ) : (
          <motion.div key="done" className="ck-checkout-done" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.5 } } }} initial="hidden" animate="show">
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
