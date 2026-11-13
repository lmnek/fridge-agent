import { lazy, Suspense } from "react";
import { NavRail, MobileDock } from "./components/shell/Nav";
import { AiButton } from "./components/shell/AiButton";
import { DoorLight, Toasts } from "./components/shell/Ambient";
import { useRoute } from "./store/route";
import { HomeView } from "./features/home/HomeView";
import { InventoryView } from "./features/inventory/InventoryView";
import { ChatSheet } from "./features/chat/ChatSheet";
import { CallLayer } from "./features/call/CallLayer";
import { ScanSheet } from "./features/inventory/ScanSheet";

// méně používané stránky se načtou až při otevření
const CamerasView = lazy(() => import("./features/cameras/CamerasView").then((m) => ({ default: m.CamerasView })));
const ShoppingView = lazy(() => import("./features/shopping/ShoppingView").then((m) => ({ default: m.ShoppingView })));
const FoodView = lazy(() => import("./features/food/FoodView").then((m) => ({ default: m.FoodView })));
const AnalyticsView = lazy(() => import("./features/analytics/AnalyticsView").then((m) => ({ default: m.AnalyticsView })));
const SettingsView = lazy(() => import("./features/settings/SettingsView").then((m) => ({ default: m.SettingsView })));

function View() {
  const route = useRoute((s) => s.route);
  switch (route) {
    case "lednice":
      return <InventoryView />;
    case "kamery":
      return <CamerasView />;
    case "nakup":
      return <ShoppingView />;
    case "jidlo":
      return <FoodView />;
    case "prehled":
      return <AnalyticsView />;
    case "nastaveni":
      return <SettingsView />;
    default:
      return <HomeView />;
  }
}

export function App() {
  const route = useRoute((s) => s.route);
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[80] focus:rounded-full focus:bg-frost focus:px-4 focus:py-2 focus:text-ink"
      >
        Přeskočit na obsah
      </a>
      <DoorLight />
      <NavRail />
      <main
        id="main"
        key={route}
        className="relative mx-auto min-h-dvh w-full max-w-[1600px] px-4 pt-[calc(16px+var(--safe-t))] pb-[calc(120px+var(--safe-b))] sm:px-6 lg:pr-8 lg:pb-36 lg:pl-[124px]"
      >
        <Suspense fallback={<div className="h-[60vh]" aria-busy="true" />}>
          <View />
        </Suspense>
      </main>
      {/* Frida dole uprostřed (desktop) */}
      <div className="pointer-events-none fixed bottom-5 left-[calc(50%+46px)] z-30 hidden -translate-x-1/2 lg:block">
        <div className="pointer-events-auto">
          <AiButton />
        </div>
      </div>
      <MobileDock />
      <ChatSheet />
      <ScanSheet />
      <CallLayer />
      <Toasts />
    </>
  );
}
