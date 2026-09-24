# Hoobot — roadmap-automaatio (agentin ohje)

Toteuta **yhden** pending-kohdan kerrallaan. Älä commitoi ellei käyttäjä pyydä.

## 1. Lue lähteet

1. `hoobot-roadmap.json` — valitse `pending`-listan **pienin priority**
2. Aja `node scripts/hoobot-next-feature.cjs` — vahvista kohde
3. Tutustu muutoksen kohdealueeseen (`src/Hoobot/...`) ennen koodia

## 2. Toteuta

| Alue | Tiedostot |
|------|-----------|
| Kaupankäynti / orderit | `src/Hoobot/Exchanges/Trades.ts`, `src/Hoobot/Trading/liveOrderExecution.ts` |
| Asetukset | `src/Hoobot/Utilities/Args.ts`, `settings/hoobot-options.json.example` |
| UI | `src/Frontend/index.html` |
| Testit | vastaavat `*.test.ts` samassa kansiossa |
| Grid / sim | `src/Hoobot/Modes/Grid.ts`, `src/Hoobot/Simulation/` |

**Älä** commitoi `settings/hoobot-options.json` (API-avaimet). Päivitä `.example` kun rakenne muuttuu.

## 3. Valmis työ

1. Aja `npm test` ja `npm run build` — korjaa virheet
2. Siirrä kohde `pending` → `completed` tiedostossa `hoobot-roadmap.json` (lisää `completedAt`)
3. Jos roadmap tyhjenee, lisää 1–2 järkevää uutta pending-kohdetta
4. Kerro lyhyesti: mitä teit, mitä testattiin, mikä on seuraava kohde

## 4. Rajat

- Pidä diff pienenä — yksi roadmap-kohde per ajo
- Noudata olemassa olevia konventioita (TypeScript, jest, webpack)
- Live-muutokset: älä riko sim/live-erottelua (`simModeHelpers.ts`)
- Ei turhia refaktorointeja sivutehtävinä
