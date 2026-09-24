# Hoobot — laajennettu dokumentaatio ja muutosloki

Tämä tiedosto on **täydennys** projektin mahdolliseen juuren `README.md`-tiedostoon: alkuperäinen README jätetään koskematta; tässä on kuvaus uudemmista ominaisuuksista ja **koottu lista muutoksista** (kehityskeskustelun ja tämän haaran koodiin tehtyjen toimien perusteella).

**Hoobot** (v2.x, `package.json`) on reaktiivinen algoritminen kryptokauppaohjelma (Binance, indikaattorit, simulaatio, web-UI).

---

## Pikaohje

- `npm run build` — tuotantokäännös + frontendin kopiointi `build/Frontend/`
- `npm run dev` — kehitysbuild + `build-dev/`
- `npm test` — Jest (jos testejä on määritelty)

---

## Uudet / päivitetyt ominaisuudet (tiivis kuvaus)

### Simulaatio → live -yhdistäminen

- **`simPatchMergeAllowPaths`** ja **`simPreservePathsOnLiveMerge`**: juuritason piste-notaatio (`Args.ts` / `ConfigOptions`). Rajaa mitä PATCH saa muuttaa ja mitä säilytetään livestä yhdistettäessä.
- **`mergeIncomingSymbolPreserveLiveRuntime`** (`src/index.ts`): syvä yhdistäminen (`deepMergeConfig`); säilyttää mm. `timeframes`, `minimumBuy`, `minimumSell`, `minimumVolume`, kun PATCH ei sisällä niitä (grid/sim-siirto).
- **`readSimToLiveMergePolicy`** ja käyttö apply-summary / copy-symbol -poluissa.

### Binance-saldot (`balanceData error`)

- **`createBinanceBalanceDataErrorLogBridge`** (`src/Hoobot/Exchanges/Balances.ts`): kun user-data stream raportoi `balanceData error`, käynnistetään throttled REST-saldon päivitys (`exchangeOptions.balances`).
- **`startBinance`** (`src/index.ts`) välittää `log`-callbackin tähän siltaan.

### Kynttilävirta

- **`listenForCandlesticks`** (`src/Hoobot/Exchanges/Candlesticks.ts`): jos `intervals` ei ole kelvollinen taulukko, ei kaaduta `intervals is not iterable` -virheeseen; virhe käsitellään hallitusti.

### Grid-simulaation uudelleenkäyttö

- **`tryLoadPriorSuccessfulVariantsFromPersistedSummaries`** (`src/Hoobot/Simulation/runSimGridCore.ts`): lukee `simulation/grid-progress-summary.json` ja tarvittaessa `grid-last-summary.json`; täyttää onnistuneet variantit välimuistiin, jotta jo lasketut variantit voidaan ohittaa.

### TypeScript / merge

- **`mergeIncomingSymbolPreserveLiveRuntime`**: `SymbolOptions`-yhdistämisessä käytetään apuria (`existingAsRecord` / `cloneJsonValue`), jotta vältetään TS2352-tyyppiset väärät castit.

### Take profit (myynti / osto)

- **`getTakeProfitConfigForNext`** (`src/Hoobot/Indicators/Profit.ts`): **`takeProfitBuy`** käytössä vain kun **`enabled === true`**; muuten sama **`takeProfit`** kuin myynnissä.
- **Kaksi TP-laukaisupolkua** (kun `takeProfit.enabled`):
  - **Klassinen**: `unrealized > minimum` ja alle huipun ja alle lasketun TP-viivan (`currentMax - drop`, pohjalla `minimum`).
  - **Pudotuspolku**: `drop > 0`, pudotus huipusta ≥ `drop`, `unrealized < currentMax`, ja unrealized pysyy plussalla **`dropMinUnrealized`**-säännön mukaan:
    - kenttä puuttuu → oletus **0,01 %**;
    - **`0`** → riittää **`unrealized > 0`**;
    - positiivinen arvo → `unrealized >=` tuo arvo.
- Konfiguraatio: **`takeProfit.dropMinUnrealized`** ja **`takeProfitBuy.dropMinUnrealized`** (`Args.ts`).
- UI: kentät ja tallennus `src/Frontend/index.html` (algorithmic + HiLow Take Profit -taulukot, Take Profit Buy).

### Algoritmisen tilan bugikorjaukset (Profit / Trades)

- Profit: `currentMax`-päivityksen ylikirjoitus, SHORT + BOTH -haara, yms. (ks. koodihistoria).
- Trades: kuollut koodi / `minimumSell`–`minimumBuy` -mutaatiot korjattu niin, ettei asetuksia pysyvästi vääristetä.

### Web-UI — Krypto-sivu

- Oletusvaluutta **EUR** (USD toisena).
- **Laskurit** KAS / RXD / ALEO: määrä × spot (CryptoCompare), sama valuutta kuin valinta; hinnat cachetetaan USD+EUR per symboli.

---

## Tiedostot (pääviitteet)

| Aihe | Tiedosto(t) |
|------|----------------|
| Merge / sim→live | `src/index.ts`, `src/Hoobot/Simulation/runSimGridCore.ts`, `src/Hoobot/Utilities/Args.ts` |
| Binance saldo-silta | `src/Hoobot/Exchanges/Balances.ts`, `src/index.ts` |
| Kynttilät | `src/Hoobot/Exchanges/Candlesticks.ts` |
| TP-logiikka | `src/Hoobot/Indicators/Profit.ts` |
| Frontend | `src/Frontend/index.html` |

---

## Koottu muutoslista (changelog)

Alla **yksi lista** kaikista tässä kehityssarjassa mainituista / toteutetuista muutoksista (ei välttämättä yksi git-commit per rivi).

1. **Candlesticks**: `listenForCandlesticks` — `intervals`-validointi; ei kaatumista “not iterable”.
2. **Sim → live merge**: `mergeIncomingSymbolPreserveLiveRuntime` säilyttää runtime-kenttiä (`timeframes`, `minimumBuy`, `minimumSell`, `minimumVolume`) kun PATCH ne jättää pois.
3. **Syvä merge**: `deepMergeConfig` käytössä symbolin yhdistämisessä.
4. **Sim→live politiikka**: juuritaso `simPatchMergeAllowPaths`, `simPreservePathsOnLiveMerge` (`Args.ts`); `readSimToLiveMergePolicy` ja käyttö apply-summary / copy-symbol -virroissa.
5. **Grid**: `tryLoadPriorSuccessfulVariantsFromPersistedSummaries` — aiempien onnistuneiden varianttien hyödyntäminen summary-JSONeista.
6. **Binance `balanceData error`**: `createBinanceBalanceDataErrorLogBridge` + kytkentä `startBinance`-logiin (throttled REST-saldopäivitys).
7. **TypeScript**: merge-apu `existingAsRecord` / `cloneJsonValue` TS2352-kiertoon `index.ts`:ssä.
8. **Take profit buy**: `getTakeProfitConfigForNext` käyttää `takeProfitBuy` vain kun `enabled === true`.
9. **Take profit pudotuspolku**: `shouldTakeProfitDrop` — TP pudotuksella huipusta silti plussalla (ei vaadi klassista `unrealized > minimum`).
10. **`dropMinUnrealized`**: oletus 0,01 %, `0` = vain `unrealized > 0`; kentät `takeProfit` ja `takeProfitBuy` (`Args.ts` + UI + tallennus).
11. **Profit / Trades bugfixit**: mm. `currentMax`-alustus, SHORT+BOTH, `minimumSell`/`minimumBuy` pysyvä mutaatio, redundantit tarkistukset (ks. aiemmat commitit).
12. **Frontend Krypto**: EUR oletus, KAS/RXD/ALEO-laskurit, `cryptoSpotPrices`, valuutan vaihto.
13. **Frontend HiLow**: sama “Drop path min unrealized” -rivi Take Profit -taulukkoon kuin algorithmic-moodissa.

---

## Huomio `README.md`:stä

Juurihakemistossa ei tällä hetkellä näy erillistä `README.md`-tiedostoa (tai se on muualla). Kun lisäät virallisen `README.md`:n, voit viitata tähän tiedostoon rivillä: *“Laajempi muutosloki: `readme2.md`.”*

---

*Päivitetty: kehityshaaran dokumentaatio / agentti.*
