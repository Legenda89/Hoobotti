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

import { SlashCommandBuilder } from 'discord.js';

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min);
}

export default {
  builder: new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll a number x times between y and z values")
    .addNumberOption(option => 
      option.setName('amount')
      .setDescription('How many times to roll')
      .setRequired(true))
    .addNumberOption(option => 
      option.setName('min')
      .setDescription('Minimum value for roll')
      .setRequired(true))
    .addNumberOption(option => 
      option.setName('max')
      .setDescription('Maximum value for roll')
      .setRequired(true)),
  execute: async (interaction: { options: any, reply: (arg0: string) => any; }) => {
    let amount = interaction.options.getNumber('amount')
    const min = interaction.options.getNumber('min')
    const max = interaction.options.getNumber('max')
    if(amount === 0) {
      amount = 1
    }
    const rolls: number[] = [];
    for(let x = 0; x < amount; x++) {
      rolls.push(getRandomNumber(min, max))
    }
    await interaction.reply(`You rolled: ${rolls.toString()}`);
  }
}