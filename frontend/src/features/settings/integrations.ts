/** Popisky integrací a krátký návod, jak je připojit naostro (podle docs/integrace a backend/frida/config.py). */
export interface IntegrationInfo {
  key: string;
  label: string;
  note: string;
}

export const INTEGRATIONS: IntegrationInfo[] = [
  {
    key: "agent",
    label: "Mozek Fridy",
    note: "Naostro odpovídá Claude. Stačí doplnit ANTHROPIC_API_KEY do backend/.env, bez klíče mluví ukázkový skriptovaný mozek.",
  },
  {
    key: "vision",
    label: "Rozpoznávání v lednici",
    note: "FRIDA_VISION_PROVIDER=claude posílá snímky Claudovi, local nebo cascade rozpoznává doma bez cloudu (docs/integrace/lokalni-vision.md).",
  },
  {
    key: "camera",
    label: "Kamery Reolink",
    note: "Vyplň FRIDA_REOLINK_HOST a FRIDA_REOLINK_PASSWORD. Home Hub musí být v aplikaci Reolink přidaný jako Local device.",
  },
  {
    key: "rohlik",
    label: "Rohlík",
    note: "Košík přes oficiální MCP server: FRIDA_ROHLIK_MCP_URL=https://mcp.rohlik.cz/mcp a přihlášení. Objednávku vždycky potvrdíš v Rohlíku.",
  },
  {
    key: "voice",
    label: "Telefonní hovory",
    note: "Twilio ConversationRelay: FRIDA_TWILIO_ACCOUNT_SID, FRIDA_TWILIO_AUTH_TOKEN, FRIDA_TWILIO_FROM_NUMBER a tvoje číslo ve FRIDA_USER_PHONE. Bez nich hovor přijmeš tady v aplikaci.",
  },
  {
    key: "deals",
    label: "Akce v obchodech",
    note: "FRIDA_DEALS_LIVE=true začne číst akce z akcniceny.cz (kupi.cz jde přidat přes FRIDA_DEALS_SOURCES). Jinak jsou ceny ukázkové.",
  },
  {
    key: "geo",
    label: "Obchody v okolí",
    note: "FRIDA_GEO_LIVE=true hledá obchody kolem tvé polohy v OpenStreetMap a dohledá adresu.",
  },
  {
    key: "delivery",
    label: "Rozvoz jídla",
    note: "Odkazy vedou do Woltu a foodory. FRIDA_DELIVERY_LIVE=true schová ukázkové podniky a nechá jen odkazy.",
  },
  {
    key: "barcode",
    label: "Čárové kódy",
    note: "FRIDA_BARCODE_LIVE=true dohledává EAN v databázi Open Food Facts.",
  },
];

const DETAIL: Record<string, string> = {
  claude: "Claude",
  local: "lokální modely",
  cascade: "kaskáda: doma, pak Claude",
  live: "",
};

export function modeDetail(mode: string | undefined): string {
  if (!mode) return "";
  return DETAIL[mode] ?? mode;
}
