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

import { CacheType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { getCurrentBalances } from '../../Hoobot/Exchanges/Balances';
import { Exchange, getExchangeByName } from '../../Hoobot/Exchanges/Exchange';
import { ConfigOptions } from '../../Hoobot/Utilities/Args';

export interface balancesWithUSDT { 
  [symbol: string]: {
    amount: number,
    amountInUSDT: number,
  }; 
}

export interface result {
  [symbol: string]: string,
}

export default {
  builder: new SlashCommandBuilder()
    .setName("balances")
    .setDescription("Replices with exchange balances!")
    .addStringOption(option =>
      option.setName('exchange')
        .setDescription('The name of exchange to check')
        .setRequired(true)),
  execute: async (interaction: ChatInputCommandInteraction<CacheType>, exchanges: Exchange[], options: ConfigOptions) => {
    await interaction.deferReply();
    const exchangeName = interaction.options.getString('exchange'); 
    if (exchangeName !== null) {
      const exchangeByName = getExchangeByName(exchangeName, exchanges, options); 
      if(exchangeByName !== undefined) {
        const sortedBalances = await getCurrentBalances(exchangeByName);
        const resultBalances = Object.entries(sortedBalances).map(([symbol, data]) => `${data.crypto.toFixed(7)} ${symbol} = ${data.usdt.toFixed(2)} USDT`);
        await interaction.editReply(`${exchangeName} balances: \r\n${JSON.stringify(resultBalances, null, 4)}`);
      } else {
        await interaction.editReply(`Sorry exchange does not exist or has not been implemented.`);
      }
    } else {
      await interaction.editReply("Please provide a valid exchange name to check.");
    }
  }
}
