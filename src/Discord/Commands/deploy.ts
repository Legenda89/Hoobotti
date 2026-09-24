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

import { REST, RESTPostAPIChatInputApplicationCommandsJSONBody, Routes } from 'discord.js';
import { DiscordOptions } from "../../Hoobot/Utilities/Args";
import { logToFile } from '../../Hoobot/Utilities/LogToFile';

// const token = process.env.DISCORD_BOT_TOKEN;
// const clientId = process.env.DISCORD_APPLICATION_ID;
// const guildId = process.env.DISCORD_SERVER_ID;

export const deployCommands = async (
  commands: RESTPostAPIChatInputApplicationCommandsJSONBody[],
  discord: DiscordOptions | undefined
) => {
  if (!discord?.token) {
    console.log("Discord: token not set, skipping command deploy.");
    return;
  }
  if (!discord.applicationId) {
    console.log("Discord: applicationId not set, skipping command deploy.");
    return;
  }
  if (!discord.serverId) {
    console.log("Discord: serverId not set, skipping command deploy.");
    return;
  }
  const rest = new REST({ version: "10" }).setToken(discord.token);
  try {
    console.log(`Discord: refreshing ${commands.length} (/) commands.`);
    await rest.put(
      Routes.applicationGuildCommands(discord.applicationId, discord.serverId),
      { body: commands }
    );
    console.log("Discord: application (/) commands reloaded.");
  } catch (error) {
    logToFile("./logs/error.log", JSON.stringify(error, null, 4));
    console.error("Discord deploy error:", error);
  }
};