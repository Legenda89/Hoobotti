import { resolveProjectRelativePath } from "../Hoobot/Utilities/Args";
import { applySimulateProcessNice } from "../Hoobot/Utilities/simulateProcessGuard";
import { executeSimGrid } from "../Hoobot/Simulation/runSimGridCore";

async function main(): Promise<void> {
  process.env.SIMULATE = "true";
  applySimulateProcessNice();
  const gridPath =
    process.argv[2] != null && process.argv[2].length > 0
      ? resolveProjectRelativePath(process.argv[2])
      : resolveProjectRelativePath("settings/sim-grid.example.json");

  await executeSimGrid(gridPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
