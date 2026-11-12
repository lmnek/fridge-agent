# Kamera: Reolink Home Hub + 2× Argus Series B310

Stav rešerše: 13. 11. 2026. Značky zdrojů: **[Off]** Reolink, **[HA]** dokumentace Home Assistantu, **[Lib]** zdrojový kód `reolink_aio` 0.23.0, **[Výp]** vlastní výpočet, **[?]** neověřeno.

## Tři věci, které rozhodnou, jestli to bude fungovat

1. **Hub přidej do aplikace Reolink jako „Local device“.** Když je přidaný jako „Account device“, lokální přihlášení jménem a heslem nefunguje a nepojede ani `reolink_aio`, ani `api.cgi`. Oprava: Device Settings → Advanced → Restore a znovu přidat lokálně. [HA](https://www.home-assistant.io/integrations/reolink/)
2. **B310 potřebuje aktualizovat firmware, než ho hub vezme.** Reolink ho vede jako „Released, upgradable“, hardware `BIPC_NT1BNO23MPW3C10H`. [Off](https://support.reolink.com/hc/en-us/articles/32379509281561-Reolink-Home-Hub-Compatibility/)
3. **Datum spotřeby z kamery v lednici skoro nepřečteš.** Při 40 cm a záběru 88° vychází asi 3 px na milimetr, takže 2,5 mm vysoké datum má 7 až 8 pixelů. [Výp] Rozpoznat potraviny jde, číst data spíš ne. Frida proto umí **naskenovat datum mobilem** (tlačítko „Skenovat datum“ v aplikaci) a z kamery data jen odhaduje.

## Co je B310

| Parametr | Hodnota |
|---|---|
| Obraz | 2304×1296 (3 MP), 10 až 15 fps, hlavní a vedlejší stream |
| Objektiv | 4 mm F2.0, pevný, 88° vodorovně |
| Wi-Fi | **jen 2,4 GHz** |
| Baterie | 6000 mAh, USB-C, „asi 3 měsíce“ na nabití |
| PIR | do 10 m, 100° |
| Noc | 6× IR 850 nm, 2× bílý reflektor |
| Prostředí | −10 až 55 °C, vlhkost 20 až 85 %, IP65 |

Zdroj: [produktová stránka](https://reolink.com/product/argus-series-b310/). Kamera **spí**. Sama o sobě nemá RTSP, ONVIF ani HTTP, probouzí ji PIR nebo vzdálený požadavek. Tyhle protokoly dostane jen přes Home Hub. [Off](https://support.reolink.com/articles/360004441753-Can-Reolink-Battery-Powered-Cameras-Work-with-3rd-Party-Software/)

Home Hub 1 zvládne až 8 kamer, má Ethernet a pro kamery si dělá vlastní Wi-Fi síť. [Off](https://reolink.com/product/reolink-home-hub/)

## Co hub nabízí a jak to zapnout

- Home Huby poskytují CGI, RTSP a ONVIF pro připojené kamery. [Off](https://support.reolink.com/hc/en-us/articles/900000617826-Which-Reolink-Products-Support-CGI-RTSP-ONVIF)
- Porty se zapínají **v nastavení hubu**, ne kamery: aplikace → zařízení → More Features → Advanced Network Settings → Server Settings. [Off](https://support.reolink.com/hc/en-us/articles/900000621783-How-to-Set-up-Reolink-Ports-Settings/)
- Porty: HTTP 80, HTTPS 443, RTSP 554, RTMP 1935, ONVIF 8000, Baichuan 9000.
- Kanály jsou číslované od nuly (API, Snap, FLV). V RTSP adrese je `NN = kanál + 1`. Kanály můžou mít mezery, proto Frida mapuje kamery přes `GetChannelstatus`.

```text
GET  https://HUB/cgi-bin/api.cgi?cmd=GetChannelstatus&user=U&password=P
GET  https://HUB/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=NAHODNE&user=U&password=P
POST https://HUB/cgi-bin/api.cgi?cmd=Login   [{"cmd":"Login","action":0,"param":{"User":{"userName":U,"password":P}}}]
     -> value.Token.name, value.Token.leaseTime, dál &token=NAME
rtsp://U:P@HUB:554/Preview_01_sub          # kanál 0, vedlejší stream (vždy H.264)
http://HUB/flv?port=1935&app=bcs&stream=channel0_main.bcs&user=U&password=P
```

Oficiální PDF „Camera API User Guide V8“ už na původních odkazech není (404). Nejlepší živá reference je zdrojový kód [`reolink_aio`](https://github.com/starkillerOG/reolink_aio).

## Události (otevření dveří, pohyb)

| Metoda | Funguje pro bateriovou kameru přes hub? |
|---|---|
| TCP push (Baichuan, port 9000) | **Ano**, používá ho Home Assistant. Nejmenší zpoždění. |
| Dotazování `GetMdState` / `GetAiState` | Ano a **neprobouzí kameru**. |
| ONVIF PullPoint | Neověřeno. |
| Webhook | Jen u kamery připojené přímo, bez hubu. |

Frida používá `reolink_aio` (`uv sync --extra reolink`) a TCP push. Když knihovna chybí, spadne na dotazování `GetMdState` přes HTTP API.

## Baterie a živý přenos

- Každý snímek nebo stream kameru probudí. Snímek ji drží vzhůru 10 až 30 s, živý náhled po celou dobu. [HA]
- Náhled trvá **maximálně 5 minut**, pak kamera usne a RTSP spadne. Timeout RTSP nastav aspoň na 20 s. [Off]
- Hub kamery vzhůru nedrží. Zařízení Reolink mají omezený počet současných spojení a dva klienti ze stejné IP se můžou navzájem odpojovat. Proto Frida bere snímky jen při události a živý náhled pouští jen na vyžádání (max. `FRIDA_LIVE_VIEW_MAX_SECONDS`, výchozí 240 s).

## Živý náhled přes go2rtc

go2rtc u Reolinku nedoporučuje RTSP a radí RTMP nebo HTTP-FLV. [go2rtc](https://github.com/AlexxIT/go2rtc/blob/master/internal/streams/README.md) Konfigurace je v `infra/go2rtc.yaml`:

```yaml
streams:
  fridge_cam0:
    - http://HUB/flv?port=1935&app=bcs&stream=channel0_main.bcs&user=U&password=P
    - rtsp://U:P@HUB/Preview_01_sub#timeout=30
```

Volbu `preload` u bateriových kamer **nezapínej**. Zkušenost s go2rtc přímo na kanálu Home Hubu jsem nenašel. [?]

## Umístění v lednici

Většinou inženýrská úvaha, přímých zkušeností je málo.

- **Teplota:** lednice kolem 4 °C je ve specifikaci, mrazák (−18 °C) ne. Li-ion baterie v chladu ztrácí kapacitu a nemá se nabíjet studená. Frida hlídá `battery_percentage`.
- **Wi-Fi:** kamera umí jen 2,4 GHz a zavřená ocelová lednice signál silně tlumí. Hub dej co nejblíž k lednici. Komerční FridgeCam od Smarteru chce signál aspoň −60 dBm a snímá **při zavírání dveří**. [Smarter](https://smarterhelp.zendesk.com/hc/en-us/articles/360001326669-Some-of-my-images-are-not-coming-through)
- **Spouštěč:** PIR přes dveře nevidí, ale teplá ruka proti studeným policím je silný signál. Spolehlivější je dveřní kontakt (Zigbee apod.). Frida má endpoint `POST /api/camera/trigger` pro externí senzor.
- **Montáž:** Smarter dává kameru doprostřed dveří, směrem do lednice, a snímá při úhlu dveří kolem 45°. [Smarter](https://smarterhelp.zendesk.com/hc/en-us/articles/360012216899)
- **Světlo:** barvy jsou jen při otevřených dveřích. Za tmy jede IR (černobíle) s odlesky od obalů.
- **Kondenzace:** vlhkost v lednici může přesáhnout specifikaci. Plochý USB-C kabel skrz těsnění dveří ušetří vyndávání kamery kvůli nabíjení.

**Doporučení pro Fridu:** kamera 1 („Police“) nahoře na dveřích nebo na horní polici, natočená do lednice. Kamera 2 („Dveře“) na protější stěně kuchyně nebo nahoře v rámu, aby viděla police ve dveřích při otevření. Snímá se, dokud jsou dveře otevřené a svítí světlo. Pokud Wi-Fi v zavřené lednici nevydrží, dej obě kamery ven, natočené do otevřené lednice.

## Test samostatně

```bash
cd backend
uv sync --extra reolink
FRIDA_REOLINK_HOST=192.168.1.50 FRIDA_REOLINK_PASSWORD=... uv run frida camera-info
FRIDA_REOLINK_HOST=192.168.1.50 FRIDA_REOLINK_PASSWORD=... uv run frida snapshot --channel 0 --out snimek.jpg
```

## Neověřeno

- Verze firmwaru hubu, od které mají bateriové kamery CGI a RTSP.
- ONVIF události pro bateriové kanály na hubu.
- Latence `Snap` pro B310 přes hub.
- Limity hubu na počet streamů a požadavků.
- Wi-Fi přes zavřenou lednici, mlžení objektivu a minimální zaostřovací vzdálenost B310.
