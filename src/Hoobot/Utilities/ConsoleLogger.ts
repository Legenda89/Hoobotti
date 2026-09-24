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
import fs from 'fs';
import { logToFile } from './LogToFile';
export interface ConsoleLogger {
  push: (key: string, value: any | any[]) => ConsoleLogger;
  print: (color?: string) => void;
  writeJSONTofile: (filePath: string) => void;
  flush: () => ConsoleLogger;
}

interface consoleData {
  [key: string]: any | any[];
}


const reset = "\x1b[0m";
const red = "\x1b[31m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const blue = "\x1b[34m";
const magenta = "\x1b[35m";
const cyan = "\x1b[36m";

export const consoleLogger = (): ConsoleLogger => {
  let DisplayData: consoleData = {};
  /** Buffered DEBUG lines — one file write per print/flush instead of per push (avoids huge log I/O during simulation). */
  let debugLines: string[] = [];
  const flushDebugLinesToFile = () => {
    if (process.env.DEBUG !== "true" || debugLines.length === 0) return;
    void logToFile("./logs/debug.log", debugLines.join("\n"));
    debugLines = [];
  };
  const push = (key: string, value: any | any[]) => {
    if (process.env.DEBUG === "true") {
      if (typeof value === "object") {
        debugLines.push(`ConsoleLogger.push(${key}, ${JSON.stringify(value, null, 2)})`);
      } else {
        debugLines.push(`ConsoleLogger.push(${key}, ${value})`);
      }
    }
    // Allow overwrite so PNL% previous/unrealized etc. show latest values each print
    const updatedData = { ...DisplayData, [key]: value };
    DisplayData = createImmutableData(updatedData);
    return logger;
  };
  const print = (color?: string) => {
    flushDebugLinesToFile();
    if(color == "red") {
      console.log(`${red}${JSON.stringify(DisplayData, null, 4)}${reset}`);
    } else if(color == "green") {
      console.log(`${green}${JSON.stringify(DisplayData, null, 4)}${reset}`);
    } else if(color == "yellow") {
      console.log(`${yellow}${JSON.stringify(DisplayData, null, 4)}${reset}`);
    } else if(color == "blue") {
      console.log(`${blue}${JSON.stringify(DisplayData, null, 4)}${reset}`);
    } else if(color == "magenta") {
      console.log(`${magenta}${JSON.stringify(DisplayData, null, 4)}${reset}`);
    } else if(color == "cyan") {
      console.log(`${cyan}${JSON.stringify(DisplayData, null, 4)}${reset}`);
    } else {
      console.log(JSON.stringify(DisplayData, null, 4));
    }
  };
  const writeJSONTofile = (filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        let fileBuffer = fs.readFileSync(filePath);
        if (fileBuffer.toString() === "") {
          fileBuffer = Buffer.from("[]");
        }
        const parsedJSON = JSON.parse(fileBuffer.toString());
        parsedJSON.push(DisplayData);
        fs.writeFileSync(filePath, JSON.stringify(parsedJSON, null, 4));
      } else {
        fs.writeFileSync(filePath, JSON.stringify({}, null, 4));
      }
    } catch (error) {
      console.error(error);
    }
  };
  const flush = () => {
    flushDebugLinesToFile();
    DisplayData = {};
    return logger;
  };
  const createImmutableData = (data: consoleData) => {
    const immutableData: consoleData = {};
    for (const key in data) {
      const value = data[key];
      if (typeof value === 'object' && value !== null) {
        immutableData[key] = createImmutableData(value as consoleData);
      } else {
        immutableData[key] = value;
      }
    }
    return Object.freeze(immutableData);
  };
  const logger: ConsoleLogger = {
    push,
    print,
    writeJSONTofile,
    flush,
  };
  return logger;
};