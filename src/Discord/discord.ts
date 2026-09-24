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

import {
  Client,
  GatewayIntentBits,
  Events,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  TextChannel,
  Interaction,
  CacheType,
  MessageFlags,
} from "discord.js";
import { SimpleShardingStrategy, type WebSocketManager as DiscordWsManager } from "@discordjs/ws";
import { deployCommands } from "./Commands/deploy";
import { ConfigOptions, DiscordOptions } from "../Hoobot/Utilities/Args";
import { Exchange } from "../Hoobot/Exchanges/Exchange";
import { logToFile } from "../Hoobot/Utilities/LogToFile";
import { isTransientNetworkError } from "../Hoobot/Utilities/networkErrors";

/** Discord Gateway WSS handshake (oletus 30 s → liian lyhyt hitaalla verkolla). */
const DISCORD_WS_HANDSHAKE_TIMEOUT_MS = 60_000;
const DISCORD_WS_HELLO_TIMEOUT_MS = 90_000;
const DISCORD_LOGIN_MAX_ATTEMPTS = 3;

const buildDiscordWsStrategy = (manager: DiscordWsManager) => {
  manager.options.handshakeTimeout = DISCORD_WS_HANDSHAKE_TIMEOUT_MS;
  manager.options.helloTimeout = DISCORD_WS_HELLO_TIMEOUT_MS;
  return new SimpleShardingStrategy(manager);
};

const delayMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const loginDiscordClient = async (client: Client, token: string, label: string): Promise<boolean> => {
  for (let attempt = 1; attempt <= DISCORD_LOGIN_MAX_ATTEMPTS; attempt++) {
    try {
      await client.login(token);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const retry = isTransientNetworkError(msg) && attempt < DISCORD_LOGIN_MAX_ATTEMPTS;
      if (retry) {
        const waitSec = attempt * 5;
        console.warn(
          `Discord (${label}) login timeout (yritys ${attempt}/${DISCORD_LOGIN_MAX_ATTEMPTS}), uudelleen ${waitSec}s…`
        );
        await delayMs(waitSec * 1000);
        continue;
      }
      console.error(
        `Discord (${label}) login failed (${msg}). Tarkista token, verkko/VPN ja että Discord Gateway (wss) on saavutettavissa.`
      );
      return false;
    }
  }
  return false;
};

const deployable: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
interface command {
  name: string;
  execute: any;
}
const commands: command[] = [];

// Import your commands.
// Push your command data as json to deployable commands.
// Push your command name and execute to commands.
import ping from "./Commands/ping";
deployable.push(ping.builder.toJSON());
commands.push({ name: ping.builder.name, execute: ping.execute });

import balance from "./Commands/Balance";
deployable.push(balance.builder.toJSON());
commands.push({ name: balance.builder.name, execute: balance.execute });

import upnl from "./Commands/UPNL";
deployable.push(upnl.builder.toJSON());
commands.push({ name: upnl.builder.name, execute: upnl.execute });

import pnl from "./Commands/PNL";
deployable.push(pnl.builder.toJSON());
commands.push({ name: pnl.builder.name, execute: pnl.execute });

import roi from "./Commands/ROI";
deployable.push(roi.builder.toJSON());
commands.push({ name: roi.builder.name, execute: roi.execute });

import lasttrades from "./Commands/LastTrades";
deployable.push(lasttrades.builder.toJSON());
commands.push({ name: lasttrades.builder.name, execute: lasttrades.execute });

import avatar from "./Commands/avatar";
deployable.push(avatar.builder.toJSON());
commands.push({ name: avatar.builder.name, execute: avatar.execute });

import server from "./Commands/server";
deployable.push(server.builder.toJSON());
commands.push({ name: server.builder.name, execute: server.execute });

import roll from "./Commands/Roll";
deployable.push(roll.builder.toJSON());
commands.push({ name: roll.builder.name, execute: roll.execute });

import fkick from "./Commands/fkick";
deployable.push(fkick.builder.toJSON());
commands.push({ name: fkick.builder.name, execute: fkick.execute });

const createDiscordClient = async (
  label: string,
  exchanges: Exchange[],
  options: ConfigOptions,
  discordConfig: DiscordOptions | undefined
): Promise<Client | undefined> => {
  if (!discordConfig?.token) {
    console.log(`Discord (${label}): token not set, skipping login.`);
    return undefined;
  }
  if (!discordConfig.applicationId) {
    console.log(`Discord (${label}): applicationId not set, skipping login.`);
    return undefined;
  }
  if (!discordConfig.serverId) {
    console.log(`Discord (${label}): serverId not set, skipping login.`);
    return undefined;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    ws: { buildStrategy: buildDiscordWsStrategy },
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`Discord (${label}): logged in as ${c.user.tag}`);
  });

  client.on(Events.ShardError, (error, shardId) => {
    const msg = error?.message ?? String(error);
    if (isTransientNetworkError(msg)) {
      console.warn(
        `Discord (${label}) shard ${shardId}: ${msg} — gateway yrittää uudelleen automaattisesti.`
      );
      return;
    }
    console.error(`Discord (${label}) shard ${shardId} error:`, error);
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction<CacheType>) => {
    try {
      if (interaction.isChatInputCommand()) {
        for (const command of commands) {
          if (command.name === interaction.commandName) {
            await command.execute(interaction, exchanges, options);
            break;
          }
        }
      }
    } catch (error) {
      logToFile("./logs/error.log", JSON.stringify(error, null, 4));
      console.error(`Discord (${label}) command error:`, error);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Komennon suoritus epäonnistui.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });

  client.on(Events.Error, (error: Error) => {
    if (isTransientNetworkError(error)) {
      console.warn(`Discord (${label}) client error (verkko): ${error.message}`);
      return;
    }
    console.error(`Discord (${label}) client error:`, error);
  });

  try {
    await deployCommands(deployable, discordConfig);
  } catch (error) {
    console.error(`Discord (${label}) command deploy failed:`, error);
    return undefined;
  }
  const loggedIn = await loginDiscordClient(client, discordConfig.token, label);
  if (!loggedIn) {
    try {
      client.destroy();
    } catch {
      // ignore
    }
    return undefined;
  }
  return client;
};

export const loginDiscord = async (exchanges: Exchange[], options: ConfigOptions): Promise<Client | undefined> => {
  if (process.env.SIMULATE === "true") {
    return undefined;
  }
  // Primary bot (uses options.discord)
  const primary = await createDiscordClient("primary", exchanges, options, options.discord);

  // Optional secondary bot (uses options.discordSecondary)
  if (options.discordSecondary?.enabled) {
    await createDiscordClient("secondary", exchanges, options, options.discordSecondary);
  }

  return primary;
};

// Function to send a message to a channel by its ID
export const sendMessageToChannel = async (client: Client | undefined, channelId: string | undefined, message: string) => {
  if (client === undefined) {
    console.error("Discord: client undefined, cannot send message.");
    return;
  }
  if (channelId === undefined || channelId === "") {
    console.error("Discord: channelId not set, cannot send message.");
    return;
  }
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel instanceof TextChannel) {
      await channel.send(message);
    } else {
      console.log(`Discord: channel ${channelId} not found or is not a text channel.`);
    }
  } catch (error) {
    logToFile("./logs/error.log", JSON.stringify(error, null, 4));
    console.error(`Discord: error sending message to channel ${channelId}:`, error);
  }
};
