import { useEffect, useState } from "react";

/** Stays max(4 s, chars / 15 per s) after the text last changed (still streaming = never), then fades over 400 ms. */
export function KCaption({ text }: { text: string }) {
  const [faded, setFaded] = useState(false);
  useEffect(() => {
    setFaded(false);
    if (!text) return;
    const t = setTimeout(() => setFaded(true), Math.max(4000, (text.length / 15) * 1000));
    return () => clearTimeout(t);
  }, [text]);
  if (!text) return null;
  return (
    <div className="k-caption" data-faded={faded}>
      <p>{text}</p>
    </div>
  );
}
