# Hoobot Configuration Guide

Welcome to the definitive guide for setting up and customizing Hoobot, your companion for navigating the dynamic world of cryptocurrency trading. This manual is designed to streamline the process, ensuring you're up and running with Hoobot swiftly and effectively. Let's embark on this journey together.

**Crypto trading** involves buying and selling cryptocurrencies with the aim of making a profit. Traders analyze market trends,
price charts, and various technical indicators to make informed decisions about when to buy or sell a particular cryptocurrency.
Binance provides a user-friendly interface and robust trading tools that allow both beginners and experienced traders to engage
in crypto trading.

## Crypto Exchanges

### Binance

[Binance.com](https://www.binance.com/en/activity/referral-entry/CPA/together?ref=CPA_00QH6HTWLZ) is one of the world's leading cryptocurrency exchanges, offering a platform for users to buy,
sell, and trade various cryptocurrencies. It provides a wide range of services, including spot trading, futures trading, staking,
savings accounts, and more.

### Xeggex

[Xeggex.com](https://xeggex.com) strives to provide its users with the best trading experience and give small and medium market cap assets a reliable trading hub. Our goal is to maintain a fast and user friendly system while also concentrating on security to keep users, data, and assets safe. Security of our users' data & assets is always our top priority and we are focused on building an easy to use digital asset trading platform for everyone to enjoy.

## How to use Hoobot

Hoobot has been programmed with Typescript on top of Node. So the requirements are node version manager (nvm), node package manager (npm) and at least Node version 18.17.0.

## Installation

### Step 1: Download Hoobot

Begin by acquiring the latest version of Hoobot. Ensure the download is from a reputable source to avoid any security risks. Look for the file named `hoobot-latest.zip`.

### Step 2: Extract Hoobot

Once downloaded, locate the `hoobot-latest.zip` file and extract its contents. You can choose any preferred location on your device to store the Hoobot files. This location will be your working directory for Hoobot operations.

### Step 3: Install Dependencies

Dependencies are essential components that Hoobot needs to function correctly. Follow these steps tailored to your operating system:

1. **Windows Users:**

   - Navigate to the Hoobot folder in your terminal.
   - Execute the `windows.bat` file by typing `windows.bat` and pressing Enter.

2. **macOS Users:**

   - Open the terminal and change your directory to the Hoobot folder.
   - Run the command `sh osx.sh` to install the necessary dependencies.

3. **Linux Users:**
   - In the terminal, navigate to the Hoobot folder.
   - Type `sh linux.sh` and press Enter to begin the dependency installation process.

### Configuration Files

#### `settings/hoobot-options.json`

Configuring Hoobot is a critical step to tailor its functionality to your trading preferences and security requirements.

Hoobot uses a JSON file named `hoobot-options.json` for its configuration settings. Initially, this file is named `hoobot-options.json.example` and needs to be renamed and edited. It has example configuration for running the bot.

- Locate `settings/hoobot-options.json.example` in the Hoobot folder.
- Rename this file to `hoobot-options.json`.

This file contains the settings for live trading. It includes configurations for exchanges, trading strategies, and various other options.
There is also `settigns/hoobot-options-simulation.json.example` which used for simulation. Simulation requires Binance api keys as it uses historical data from Binance.

##### `ConfigOptions`

- **debug**: (boolean) Enables or disables debug mode.
- **startTime**: (string) Specifies the start time for the bot.
- **exchanges**: (ExchangeOptions[]) An array of exchange configurations.
- **license**: (string) The license key for Hoobot.
- **simulate**: (boolean) Indicates whether the bot is in simulation mode.
- **discord**: (DiscordOptions) Configuration for Discord notifications.

##### `ExchangeOptions`

- **name**: (string) The name of the exchange.
- **key**: (string) API key for the exchange.
- **secret**: (string) API secret for the exchange.
- **mode**: (BotMode) The trading mode (algorithmic, hilow, grid).
- **forceStopOnDisconnect**: (boolean) some exchanges have hard time with reconnecting, this allows you to stop the process on disconnect.
- **console**: (string) Console logging options.
- **openOrders**: (OpenOrders) Open orders on the exchange.
- **balances**: (Balances) Account balances.
- **tradeHistory**: (TradeHistory) Trade history on the exchange.
- **orderbooks**: (Orderbooks) Order book data.
- **symbols**: (SymbolOptions[]) Array of symbol-specific trading options.

##### `SymbolOptions`

- **noPreviousTradeCheck**: (boolean) If true, skips checks for previous trades.
- **minimumTimeSinceLastTrade**: (number) Minimum time since the last trade.
- **name**: (string) The trading symbol name.
- **timeframes**: (CandlestickInterval[]) Timeframes for candlestick data.
- **agreement**: (number) Agreement percentage for indicators.
- **source**: (string) Data source for indicators (close, high, low).
- **consecutiveDirection**: (string) Trade direction (SELL, BUY).
- **consecutiveQuantity**: (number) Amount in quote for the consecutive sell/buy orders.
- **periodicDirection**: (string) Trade direction (SELL, BUY).
- **periodicQuantity**: (number) Amount in quote for the consecutive sell/buy orders.
- **periodicInterval**: (number) Interval in seconds, how often to do place a trade.
- **trend**: (object) Trend detection settings.
  - **current**: (string) The current trend direction (e.g., "up", "down").
  - **enabled**: (boolean) Enables or disables trend detection.
  - **timeframe**: (CandlestickInterval) The timeframe for trend analysis.
  - **ema**: (object) Exponential Moving Averages settings with short and long periods.
    - **short**: (number) Short period EMA.
    - **long**: (number) Long period EMA.
- **profit**: (object) Profit settings.
  - **enabled**: (boolean) Enables or disables profit settings.
  - **minimumSell**: (number) Minimum profit margin for sell trades.
  - **minimumBuy**: (number) Minimum profit margin for buy trades.
- **price**: (object) Price limits for trades.
  - **enabled**: (boolean) Enables or disables price limits.
  - **maximumSell**: (number) Maximum price for sell trades.
  - **minimumSell**: (number) Minimum price for sell trades.
  - **maximumBuy**: (number) Maximum price for buy trades.
  - **minimumBuy**: (number) Minimum price for buy trades.
- **growingMax**: (object) Growing max settings for buy/sell.
  - **buy**: (number) Maximum amount (quote) for buy trades. (Note starting balance for simulation)
  - **sell**: (number) Maximum amount (base) for sell trades.
- **closePercentage**: (number) Close percentage for trades.
- **maximumAgeOfOrder**: (number) Maximum age of an order in seconds.
- **liveOrderExecution**: (object) Live Binance order type per side. **Ignored in simulation** (sim fills instantly at candle price). Grid mode always uses `limit`.
  - **buy**: (`limit` | `aggressiveLimit` | `market`) Buy order type. Default without config: `aggressiveLimit` for entry/stop-loss, `limit` for take-profit re-buy and grid.
  - **sell**: (`limit` | `aggressiveLimit` | `market`) Sell order type. Default: `limit`.
- **tradeFeePercentage**: (number) Trade fee percentage.
- **stopLoss**: (object) Stop loss settings.
  - **enabled**: (boolean) Enables or disables stop loss.
  - **stopTrading**: (boolean) If true, stops trading upon hitting the stop loss.
  - **pnl**: (number) The profit and loss threshold to trigger the stop loss.
  - **agingPerHour**: (number) Aging factor per hour to adjust the stop loss threshold.
  - **hit**: (boolean) Indicates if the stop loss has been hit.
- **takeProfit**: (object) Take profit settings.
  - **enabled**: (boolean) Enables or disables take profit.
  - **limit**: (number) The profit limit to trigger the take profit.
  - **minimum**: (number) Minimum profit target to initiate take profit.
  - **drop**: (number) Profit drop threshold to trigger take profit.
  - **current**: (number) Current profit level.
- **gridOrderSize**: (number) Grid order size in quote. [Grid Mode]
- **gridLevels**: (number) Number of grid levels. [Grid Mode]
- **gridRange**: (object) Grid range (upper, lower). [Grid Mode]
  - **upper**: (number) Upper percentage limit of the grid range above current price.
  - **lower**: (number) Lower percentage limit of the grid range below current price.
- **indicators**: (object) Various indicators and their settings. [Algorithmic Mode]
  - **sma**: (object) Simple Moving Average settings.
    - **enabled**: (boolean) Enables or disables SMA.
    - **length**: (number) Length of the SMA period.
    - **weight**: (number) Weight of the SMA in trading decisions.
  - **ema**: (object) Exponential Moving Average settings.
    - **enabled**: (boolean) Enables or disables EMA.
    - **short**: (number) Short period EMA.
    - **long**: (number) Long period EMA.
    - **weight**: (number) Weight of the EMA in trading decisions.
  - **macd**: (object) Moving Average Convergence Divergence settings.
    - **enabled**: (boolean) Enables or disables MACD.
    - **fast**: (number) Fast period.
    - **slow**: (number) Slow period.
    - **signal**: (number) Signal period.
    - **weight**: (number) Weight of the MACD in trading decisions.
  - **rsi**: (object) Relative Strength Index settings.
    - **enabled**: (boolean) Enables or disables RSI.
    - **length**: (number) Length of the RSI period.
    - **smoothing**: (object) Smoothing settings.
      - **type**: (string) Type of smoothing (EMA or SMA).
      - **length**: (number) Length of the smoothing period.
    - **history**: (number) History length for RSI.
    - **tresholds**: (object) Thresholds for overbought and oversold levels.
      - **overbought**: (number) Overbought threshold.
      - **oversold**: (number) Oversold threshold.
    - **weight**: (number) Weight of the RSI in trading decisions.
  - **atr**: (object) Average True Range settings.
    - **enabled**: (boolean) Enables or disables ATR.
    - **length**: (number) Length of the ATR period.
  - **obv**: (object) On -Balance Volume settings.
    - **enabled**: (boolean) Enables or disables OBV.
    - **length**: (number) Length of the OBV period.
    - **weight**: (number) Weight of the OBV in trading decisions.
  - **cmf**: (object) Chaikin Money Flow settings.
    - **enabled**: (boolean) Enables or disables CMF.
    - **length**: (number) Length of the CMF period.
    - **history**: (number) History length for CMF.
    - **tresholds**: (object) Thresholds for overbought and oversold levels.
      - **overbought**: (number) Overbought threshold.
      - **oversold**: (number) Oversold threshold.
    - **weight**: (number) Weight of the CMF in trading decisions.
  - **bb**: (object) Bollinger Bands settings.
    - **enabled**: (boolean) Enables or disables Bollinger Bands.
    - **length**: (number) Length of the Bollinger Bands period.
    - **multiplier**: (number) Multiplier for the Bollinger Bands.
    - **average**: (string) Type of average (SMA or EMA).
    - **history**: (number) History length for Bollinger Bands.
    - **weight**: (number) Weight of the Bollinger Bands in trading decisions.
  - **so**: (object) Stochastic Oscillator settings.
    - **enabled**: (boolean) Enables or disables Stochastic Oscillator.
    - **kPeriod**: (number) K period.
    - **dPeriod**: (number) D period.
    - **smoothing**: (number) Smoothing period.
    - **tresholds**: (object) Thresholds for overbought and oversold levels.
      - **overbought**: (number) Overbought threshold.
      - **oversold**: (number) Oversold threshold.
    - **weight**: (number) Weight of the Stochastic Oscillator in trading decisions.
  - **srsi**: (object) Stochastic RSI settings.
    - **enabled**: (boolean) Enables or disables Stochastic RSI.
    - **rsiLength**: (number) Length of the RSI period.
    - **stochLength**: (number) Length of the Stochastic period.
    - **kPeriod**: (number) K period.
    - **dPeriod**: (number) D period.
    - **smoothK**: (number) Smoothing period for K.
    - **smoothD**: (number) Smoothing period for D.
    - **history**: (number) History length for Stochastic RSI.
    - **tresholds**: (object) Thresholds for overbought and oversold levels.
      - **overbought**: (number) Overbought threshold.
      - **oversold**: (number) Oversold threshold.
    - **weight**: (number) Weight of the Stochastic RSI in trading decisions.
  - **dmi**: (object) Directional Movement settings.
    - **enabled**: (boolean) Enables or disables Directional Movement.
    - **dmiLength**: (number) DMI length, default 14.
    - **adxSmoothing**: (number) ADX Smoothing, default 14.
    - **weight**: (number) Weight of the Directional Movement in trading decisions.
  - **OpenAI**: (object) OpenAI model settings.
    - **enabled**: (boolean) Enables or disables OpenAI integration.
    - **key**: (string) Your OpenAI API key.
    - **model**: (string) The OpenAI model to use (e.g., "gpt-4").
    - **history**: (string) History setting for the model (e.g., "full").
    - **overwrite**: (boolean) Determines if the model's predictions overwrite existing data.

##### `DiscordOptions`

- **enabled**: (boolean) Enables or disables Discord notifications.
- **token**: (string) Discord bot token.
- **applicationId**: (string) Discord application ID.
- **serverId**: (string) Discord server ID.
- **channelId**: (string) Discord channel ID.

#### Example configurations for modes

##### Algorithmic Scalping

```json
{
  "debug": true,
  "startTime": "1698789600",
  "license": "",
  "discord": {
    "enabled": false,
    "token": "4",
    "applicationId": "",
    "serverId": "",
    "channelId": ""
  },
  "exchanges": [
    {
      "name": "xeggex",
      "key": "",
      "secret": "",
      "mode": "consecutive",
      "console": "update",
      "symbols": [
        {
          "name": "HTN/USDT",
          "timeframes": ["5m"],
          "agreement": 75,
          "source": "close",
          "trend": {
            "enabled": true,
            "timeframe": "1d",
            "ema": {
              "short": 8,
              "long": 26
            }
          },
          "profit": {
            "enabled": true,
            "minimumSell": 0.15,
            "minimumBuy": 0
          },
          "growingMax": {
            "buy": 100,
            "sell": 0
          },
          "closePercentage": 0.25,
          "maximumAgeOfOrder": 60,
          "tradeFeePercentage": 0.1,
          "stopLoss": {
            "enabled": true,
            "stopTrading": false,
            "pnl": -20,
            "agingPerHour": 0.01
          },
          "takeProfit": {
            "enabled": true,
            "limit": 0.125,
            "minimum": 1.5,
            "drop": 0.05
          },
          "indicators": {
            "macd": {
              "enabled": true,
              "fast": 5,
              "slow": 15,
              "signal": 6,
              "weight": 1
            }
          }
        }
      ]
    },
```

##### Grid

```json
{
  "debug": true,
  "startTime": "1698789600",
  "license": "",
  "discord": {
    "enabled": false,
    "token": "4",
    "applicationId": "",
    "serverId": "",
    "channelId": ""
  },
  "exchanges": [
    {
      "name": "xeggex",
      "key": "",
      "secret": "",
      "mode": "consecutive",
      "console": "update",
      "symbols": [
        {
          "name": "HTN/USDT",
          "timeframes": ["5m"],
          "agreement": 75,
          "source": "close",
          "gridOrderSize": 100000,
          "gridDensity": "concentrated",
          "gridLevels": 10,
          "gridRange": {
            "upper": 5,
            "lower": 5
          }
        }
      ]
    },
```

##### Consectutive

```json
{
  "debug": true,
  "startTime": "1698789600",
  "license": "",
  "discord": {
    "enabled": false,
    "token": "4",
    "applicationId": "",
    "serverId": "",
    "channelId": ""
  },
  "exchanges": [
    {
      "name": "xeggex",
      "key": "",
      "secret": "",
      "mode": "consecutive",
      "console": "update",
      "symbols": [
        {
          "name": "HTN/USDT",
          "timeframes": ["5m"],
          "agreement": 75,
          "source": "close",
          "consecutiveQuantity": 100000,
          "consecutiveDirection": "BUY",
          "indicators": {
            "srsi": {
              "enabled": true,
              "rsiLength": 14,
              "stochLength": 14,
              "kPeriod": 14,
              "dPeriod": 1,
              "smoothK": 3,
              "smoothD": 3,
              "history": 5,
              "tresholds": {
                "overbought": 80,
                "oversold": 20
              },
              "weight": 1
            }
          }
        }
      ]
    },
```

#### `settings/hoobot-options-simulate.json`

This file is similar to `settings/hoobot-options.json` but is used for simulation mode. The simulation mode mimics trading without actual transactions, and it is only supported for Binance. This allows users to test strategies without risking real funds.

### Simulation Mode

To enable simulation mode, set the `simulate` parameter to `true` in the `.env` file or run `npm run simualte`. The bot will then use the settings from `settings/hoobot-options-simulate.json`.

Ensure that your `settings/hoobot-options-simulate.json` includes the same structure as `settings/hoobot-options.json` but tailored for simulation. Specifically, verify that the exchange name is set to "Binance" and configure the necessary parameters accordingly. Currently only `algorithmic` mode is supported in simulation.

**Live vs simulation orders:** Simulation does not send real Binance orders. Trades are filled immediately at the replay candle price (with spread/fees modeled in code). The `liveOrderExecution` symbol option applies only to **live** trading (`simulate: false`). In live mode, `limit` waits at bid/ask, `aggressiveLimit` prices at ask for faster entry, and `market` fills immediately. Grid mode always places limit orders regardless of `liveOrderExecution`.

```json
{
  "debug": true,
  "startTime": "2024-01-01T00:00:00Z",
  "exchanges": [
    {
      "name": "Binance",
      "key": "your-binance-api-key",
      "secret": "your-binance-api-secret",
      "mode": "algorithmic",
      "console": "log",
      "openOrders": {},
      "balances": {},
      "tradeHistory": {},
      "orderbooks": {},
      "symbols": [
        {
          "name": "BTCUSDT",
          "timeframes": ["1m", "5m", "15m"],
          "agreement": 75,
          "source": "close",
          "trend": {
            "current": "up",
            "enabled": true,
            "timeframe": "1h",
            "ema": {
              "short": 12,
              "long": 26
            }
          },
          "profit": {
            "enabled": true,
            "minimumSell": 1.5,
            "minimumBuy": 1.5
          }
        }
      ]
    }
  ],
  "license": "your-license-key",
  "simulate": true,
  "discord": {
    "enabled": false
  }
}
```

### Starting Hoobot

With your configurations set, it's time to launch Hoobot:

- Open a terminal and navigate to the Hoobot directory.
- Execute the command `npm run start` to initialize Hoobot.
- Hoobot will be ran with PM2 Node process manager to keep it up and running in case of unknown crashes.

To run the simulation:

- Open a terminal and navigate to the Hoobot directory.
- Execute the command `npm run simulate` to initialize Hoobot simulation.
- Remember that the simulaton works with only with Binance data and growingMax.buy must be set for starting balance.

### Shutdown Hoobot

With your Hoobot running and you want to change settings and reboot it or stop running it:

- Open a terminal and navigate to the Hoobot directory.
- Execute the command `npm run stop` to stop Hoobot from being run on PM2.

When rebooting, you can now run `npm run start` again.

### Updating Hoobot

You can update Hoobot by running `windows.bat`, `linux.sh`, `osx.sh` again in the hoobot folder. It will check that dependancies exist and downloads always latest Hoobot for you.

**Note:** Ensure that any symbols you intend to trade with have been actively traded (at least two trades) before employing Hoobot. Be cautious that certain exchanges like Xeggex and NonKYC may experience instability.

Through this guide, you're now equipped to install and configure Hoobot with precision. Enjoy your trading journey, knowing that Hoobot is configured to your exact specifications.

### force.json

Force.json is a file where you can force allow negative trade for one trade as in force skip holding until positive trade. For example if your bot sells too quickly and it needs to buy with negative trade. Then you can flip the switch in the json for the symbol. The skip value will be automatically changed back to false after the negative trade.

```
{
  "BNBUSDT": {
    "skip": true
  },
  "ETHTUSD": {
    "skip": false
  }
}
```

### Simulation

You can run simulations with command `npm run simulate`, simulations currently support symbols available from Binance and you can adjust simulation configuration from file `hoobot-options-simulate.json`. The simulate file has same format as `hoobot-options.json` but exists only to seperate simulation options from Hoobot live options.

At the end of simulation you get results like this:

```
{
    "Starting balance": "20.00",
    "Final Balance": "2870.05",
    "ROI": "142.50",
    "BTC/USDT trades": 4037,
    "BTC/USDT stop losses": 96,
    "BTC/USDT take profits": 246,
    "BTC/USDT sells": 1745,
    "BTC/USDT buys": 1949
}

```

## Funds low?

Try bitcoin faucets like [freebitcoin](https://freebitco.in/?r=36740494), there you can win $200 worth of bitcoin every hour.

## Tax Reporting

For tax reporting purposes, we recommend using Koinly, a tool that helps with cryptocurrency tax reports. You can find more information
about Koinly and sign up through the following link: [Koinly - Cryptocurrency Tax Software](https://koinly.io/?via=66701C69&utm_source=friend)

## Note

Please note that this software is provided under the Hoobot - Proprietary License, and any unauthorized use, reproduction,
or modification is strictly prohibited. By using this software, you agree to be bound by the terms of the license.

The user of this software assumes all risks and responsibilities associated with its use. Hoosat Oy shall not be liable for any losses,
damages, or liabilities arising from the use of this software.

## LICENSE

Hoobot - Proprietary License
Copyright (c) 2023 Hoosat Oy. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are not permitted without prior written permission
from Hoosat Oy. Unauthorized reproduction, copying, or use of this software, in whole or in part, is strictly prohibited. All
modifications in source or binary must be submitted to Hoosat Oy in source format.

THIS SOFTWARE IS PROVIDED BY HOOSAT OY "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE, ARE DISCLAIMED. IN NO EVENT SHALL HOOSAT OY BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

The user of this software uses it at their own risk. Hoosat Oy shall not be liable for any losses, damages, or liabilities
arising from the use of this software.
