/* =====================================================================
 * Hoobot - Proprietary License
 * Copyright (c) 2023 Hoosat Oy. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are not permitted without prior written permission
 * from Hoosat Oy. Unauthorized reproduction, copying, or use of this
 * software, in whole or in part, is strictly prohibited. All
 * modifications in source or binary must be submitted to Hoosat Oy in source format.
 *
 * THIS SOFTWARE IS PROVIDED BY HOOSAT OY "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL HOOSAT OY BE LIABLE FOR ANY DIRECT,
 * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
 * STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
 * OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * The user of this software uses it at their own risk. Hoosat Oy shall
 * not be liable for any losses, damages, or liabilities arising from
 * the use of this software.
 * ===================================================================== */

import { SlashCommandBuilder } from "discord.js";
import fs from "fs";
import { Balance, getCurrentBalances } from "../../Hoobot/Exchanges/Balances";
import { Exchange, getExchangeByName } from "../../Hoobot/Exchanges/Exchange";
import { ConfigOptions } from "../../Hoobot/Utilities/Args";

export default {
  builder: new SlashCommandBuilder()
    .setName("roi")
    .setDescription("Calculates ROI since first recorded balance.")
    .addStringOption((option) =>
      option.setName("exchange").setDescription("The name of exchange to check").setRequired(true)
    ),
  execute: async (
    interaction: { options: any; deferReply: () => Promise<unknown>; editReply: (arg0: string) => Promise<unknown>; reply: (arg0: string) => any },
    exchanges: Exchange[],
    options: ConfigOptions
  ) => {
    await interaction.deferReply();
    const exchangeName = interaction.options.getString("exchange");
    if (exchangeName !== null) {
      const exchangeByName = getExchangeByName(exchangeName, exchanges, options);
      if (exchangeByName !== undefined) {
        const currentBalances = await getCurrentBalances(exchangeByName);
        if (!fs.existsSync(`./logs/balances-${exchangeName}.json`)) {
          await interaction.editReply(
            `There are no stored balances in /logs/balances-${exchangeName}.json file yet. Investigate!`
          );
        } else {
          let storedBalances: unknown;
          try {
            storedBalances = JSON.parse(fs.readFileSync(`./logs/balances-${exchangeName}.json`, "utf-8") || "[]");
          } catch {
            await interaction.editReply(`Invalid JSON in /logs/balances-${exchangeName}.json.`);
            return;
          }
          if (!Array.isArray(storedBalances) || storedBalances.length === 0) {
            await interaction.editReply(`No stored balances in /logs/balances-${exchangeName}.json yet.`);
            return;
          }
          const firstEntry = storedBalances[0];
          const firstKey = Object.keys(firstEntry)[0];
          const firstBalances = firstEntry?.[firstKey] as Record<string, { crypto: number; usdt: number }> | undefined;
          if (!firstBalances) {
            await interaction.editReply(`Invalid balance format in /logs/balances-${exchangeName}.json.`);
            return;
          }
          const totalCurrentFiat = Object.values(currentBalances).reduce((acc, cur) => acc + cur.usdt, 0);
          const totalFirstFiat = Object.values(firstBalances).reduce((acc, cur) => acc + cur.usdt, 0);
          if (totalFirstFiat <= 0) {
            await interaction.editReply("Initial balance is zero; cannot compute ROI.");
            return;
          }
          const diff = totalCurrentFiat - totalFirstFiat;
          const roi = ((totalCurrentFiat - totalFirstFiat) / totalFirstFiat) * 100;
          const totalFiatBalances = storedBalances.map((entry: any) => {
            const balances = entry[Object.keys(entry)[0]] as Record<string, { crypto: number; usdt: number }>;
            return Object.values(balances).reduce((acc, balance) => acc + balance.usdt, 0);
          });
          const validFiatBalances = totalFiatBalances.filter(
            (balance: number) => typeof balance === "number" && !isNaN(balance)
          );
          const maxFiat = validFiatBalances.length > 0 ? Math.max(...validFiatBalances) : totalFirstFiat;
          const maxDiff = maxFiat - totalFirstFiat;
          const maxRoi = ((maxFiat - totalFirstFiat) / totalFirstFiat) * 100;

          let msg = "```";
          msg += `Initial Balance: ${totalFirstFiat.toFixed(2)} USDT\r\n\r\n`;
          msg += `Current Balance: ${totalCurrentFiat.toFixed(2)} USDT\r\nCurrent Difference: ${diff.toFixed(
            2
          )} USDT\r\nCurrent ROI: ${roi.toFixed(2)} %\r\n\r\n`;
          msg += `Max Balance: ${maxFiat.toFixed(2)} USDT\r\nMax Difference: ${maxDiff.toFixed(
            2
          )} USDT\r\nMax ROI: ${maxRoi.toFixed(2)} %\r\n\r\n`;
          msg += "```";
          await interaction.editReply(msg);
        }
      } else {
        await interaction.editReply(`Sorry exchange does not exist or has not been implemented.`);
      }
    } else {
      await interaction.editReply("Please provide a valid exchange name to check.");
    }
  },
};
