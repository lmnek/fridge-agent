/**
 * "What shops are nearby?": a map of the flat with the nearest store of each chain, no list. From the bridge's
 * `nearby` event (show_nearby, bridge/show.py), leaves on its own like the product card.
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { BusEvent } from "../stage/bus";
import "./product.css";

type Shop = { name: string; distance_m: number; lat: number; lon: number };

const dist = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} km`);
const walk = (m: number) => Math.max(1, Math.round(m / 80));

export function NearbyCard({ ev }: { ev: BusEvent }) {
  const box = useRef<HTMLDivElement>(null);
  const home = ev.home as { lat: number; lon: number };
  const shops = (ev.shops as Shop[]) ?? [];
  const nearest = shops[0];

  useEffect(() => {
    if (!box.current) return;
    const map = L.map(box.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    map.attributionControl.setPrefix(false);

    L.marker([home.lat, home.lon], {
      icon: L.divIcon({ className: "nb-home", html: "<span></span>", iconSize: [22, 22] }),
      interactive: false,
    }).addTo(map);
    for (const s of shops) {
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({
          className: s.lon < home.lon - 0.002 ? "nb-shop nb-left" : "nb-shop", // west of home: label on the left
          html: `<span class="nb-dot"></span><span class="nb-label">${s.name}<em>${dist(s.distance_m)}</em></span>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
        interactive: false,
      }).addTo(map);
    }
    const bounds = L.latLngBounds([[home.lat, home.lon], ...shops.map((s) => [s.lat, s.lon] as [number, number])]);
    map.fitBounds(bounds, { padding: [34, 34] });
    return () => {
      map.remove();
    };
  }, [home.lat, home.lon, shops]);

  return (
    <motion.article
      className="pc nb"
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
    >
      <div className="nb-map" ref={box} />
      <div className="pc-body">
        <h2 className="pc-item">Shops nearby</h2>
        {nearest ? (
          <p className="nb-line">
            {nearest.name} is a {walk(nearest.distance_m)}-minute walk. Rohlík delivers within the hour.
          </p>
        ) : null}
      </div>
    </motion.article>
  );
}
