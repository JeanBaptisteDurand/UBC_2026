/** logs.ts — « archive-node logs [-f] » : les journaux du conteneur de l'enclave. */
import { spawn } from "node:child_process";
import { CONTAINER } from "./constants";
import { dockerState, inspectContainer } from "./docker";
import { CliError } from "./errors";
import { detectMode, upCommand } from "./system";

export async function logsCommand(f: { follow?: boolean; tail?: number }): Promise<number> {
  const ds = await dockerState();
  if (!ds.ok) throw new CliError(ds.detail);
  if (!(await inspectContainer())) {
    throw new CliError(`No ${CONTAINER} container on this machine: first run ${upCommand(detectMode())}.`);
  }
  const args = ["logs", "--tail", String(f.tail ?? 200), ...(f.follow ? ["--follow"] : []), CONTAINER];
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: "inherit" });
    const onSig = () => {
      /* Ctrl+C : docker le reçoit aussi et s'arrête ; on attend sa sortie */
    };
    process.on("SIGINT", onSig);
    child.once("error", (e) => {
      process.removeListener("SIGINT", onSig);
      resolve(Promise.reject(new CliError(`docker logs failed: ${e.message}`)));
    });
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", onSig);
      resolve(signal ? 0 : code ?? 1);
    });
  });
}
