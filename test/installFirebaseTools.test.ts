import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as execModule from "@actions/exec";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getFirebaseTools } from "../src/installFirebaseTools";

/**
 * Writes a minimal firebase-tools package (package.json + bin script) under
 * `parentNodeModules` so the entrypoint resolver has something to find.
 * Returns the absolute path to the bin entrypoint.
 */
function writeFakeFirebaseTools(parentNodeModules: string): string {
  const pkgDir = path.join(parentNodeModules, "firebase-tools");
  const binRel = path.join("lib", "bin", "firebase.js");
  fs.mkdirSync(path.join(pkgDir, "lib", "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: "firebase-tools", bin: { firebase: binRel } })
  );
  fs.writeFileSync(path.join(pkgDir, binRel), "#!/usr/bin/env node\n");
  return path.join(pkgDir, binRel);
}

describe("getFirebaseTools", () => {
  const originalRunnerEnvironment = process.env.RUNNER_ENVIRONMENT;
  const originalRunnerTemp = process.env.RUNNER_TEMP;

  let runnerTemp: string;

  beforeEach(() => {
    runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), "firebase-tools-test-"));
    process.env.RUNNER_TEMP = runnerTemp;
    jest.spyOn(core, "info").mockImplementation(() => {});
    jest.spyOn(core, "warning").mockImplementation(() => {});
    jest.spyOn(core, "addPath").mockImplementation(() => {});
    jest.spyOn(cache, "restoreCache").mockResolvedValue(undefined);
    jest.spyOn(cache, "saveCache").mockResolvedValue(1);
  });

  afterEach(() => {
    process.env.RUNNER_ENVIRONMENT = originalRunnerEnvironment;
    process.env.RUNNER_TEMP = originalRunnerTemp;
    fs.rmSync(runnerTemp, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it("resolves the preinstalled entrypoint by following the firebase binary on PATH", async () => {
    process.env.RUNNER_ENVIRONMENT = "self-hosted";

    const globalRoot = path.join(runnerTemp, "global-node-modules");
    fs.mkdirSync(globalRoot, { recursive: true });
    const realEntrypoint = writeFakeFirebaseTools(globalRoot);
    // Simulate the global `firebase` bin being a symlink to the JS entrypoint.
    const firebaseBinLink = path.join(runnerTemp, "firebase");
    fs.symlinkSync(realEntrypoint, firebaseBinLink);

    const execSpy = jest
      .spyOn(execModule, "exec")
      .mockImplementation(async (command, args, options) => {
        if (command === "firebase" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(Buffer.from("15.12.0", "utf8"));
          return 0;
        }

        if (
          (command === "which" || command === "where") &&
          args?.[0] === "firebase"
        ) {
          options?.listeners?.stdout?.(Buffer.from(firebaseBinLink, "utf8"));
          return 0;
        }

        throw new Error(
          `unexpected command: ${command} ${(args || []).join(" ")}`
        );
      });

    await expect(getFirebaseTools("latest")).resolves.toBe(
      fs.realpathSync(realEntrypoint)
    );

    // Resolved from the PATH binary; npm root -g is never consulted.
    expect(execSpy).toHaveBeenCalledTimes(2);
    expect(cache.restoreCache).not.toHaveBeenCalled();
    expect(cache.saveCache).not.toHaveBeenCalled();
    expect(core.addPath).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      "Found preinstalled firebase-tools@15.12.0 on PATH"
    );
    expect(core.info).toHaveBeenCalledWith(
      "Using preinstalled firebase-tools@15.12.0 on self-hosted runner; skipping cache and installation"
    );
  });

  it("falls back to npm root -g when the firebase binary isn't a JS entrypoint", async () => {
    process.env.RUNNER_ENVIRONMENT = "self-hosted";

    const globalRoot = path.join(runnerTemp, "global-node-modules");
    fs.mkdirSync(globalRoot, { recursive: true });
    const expectedEntrypoint = writeFakeFirebaseTools(globalRoot);

    jest
      .spyOn(execModule, "exec")
      .mockImplementation(async (command, args, options) => {
        if (command === "firebase" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(Buffer.from("15.12.0", "utf8"));
          return 0;
        }

        // `which firebase` finds nothing resolvable to a JS file.
        if (
          (command === "which" || command === "where") &&
          args?.[0] === "firebase"
        ) {
          return 0;
        }

        if (command === "npm" && args?.[0] === "root" && args?.[1] === "-g") {
          options?.listeners?.stdout?.(Buffer.from(globalRoot, "utf8"));
          return 0;
        }

        throw new Error(
          `unexpected command: ${command} ${(args || []).join(" ")}`
        );
      });

    await expect(getFirebaseTools("latest")).resolves.toBe(expectedEntrypoint);
    expect(core.addPath).not.toHaveBeenCalled();
  });

  it("falls back to managed install when a pinned version differs and resolves its entrypoint", async () => {
    process.env.RUNNER_ENVIRONMENT = "self-hosted";

    const execSpy = jest
      .spyOn(execModule, "exec")
      .mockImplementation(async (command, args, options) => {
        if (command === "firebase" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(Buffer.from("15.12.0", "utf8"));
          return 0;
        }

        if (command === "npm" && args?.[0] === "install") {
          // Simulate npm laying down the package in the install dir.
          writeFakeFirebaseTools(
            path.join(String(options?.cwd), "node_modules")
          );
          return 0;
        }

        throw new Error(
          `unexpected command: ${command} ${(args || []).join(" ")}`
        );
      });

    await expect(getFirebaseTools("15.13.0")).resolves.toMatch(
      /firebase-tools-15\.13\.0[\\/]node_modules[\\/]firebase-tools[\\/]lib[\\/]bin[\\/]firebase\.js$/
    );

    expect(execSpy).toHaveBeenCalledTimes(2);
    expect(cache.restoreCache).toHaveBeenCalledTimes(1);
    expect(cache.saveCache).toHaveBeenCalledTimes(1);
    expect(core.addPath).toHaveBeenCalledTimes(1);
  });

  it("falls through from an unresolvable preinstall to a managed install", async () => {
    process.env.RUNNER_ENVIRONMENT = "self-hosted";

    jest
      .spyOn(execModule, "exec")
      .mockImplementation(async (command, args, options) => {
        if (command === "firebase" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(Buffer.from("15.12.0", "utf8"));
          return 0;
        }

        if (
          (command === "which" || command === "where") &&
          args?.[0] === "firebase"
        ) {
          return 0;
        }

        // Global root has no firebase-tools, so the preinstalled entrypoint
        // cannot be resolved and we must fall through to a managed install.
        if (command === "npm" && args?.[0] === "root" && args?.[1] === "-g") {
          options?.listeners?.stdout?.(Buffer.from(runnerTemp, "utf8"));
          return 0;
        }

        if (command === "npm" && args?.[0] === "view") {
          options?.listeners?.stdout?.(Buffer.from("15.12.0", "utf8"));
          return 0;
        }

        if (command === "npm" && args?.[0] === "install") {
          writeFakeFirebaseTools(
            path.join(String(options?.cwd), "node_modules")
          );
          return 0;
        }

        throw new Error(
          `unexpected command: ${command} ${(args || []).join(" ")}`
        );
      });

    await expect(getFirebaseTools("latest")).resolves.toMatch(
      /node_modules[\\/]firebase-tools[\\/]lib[\\/]bin[\\/]firebase\.js$/
    );
  });

  it("throws instead of falling back to PATH when no entrypoint can be resolved", async () => {
    process.env.RUNNER_ENVIRONMENT = "self-hosted";

    jest
      .spyOn(execModule, "exec")
      .mockImplementation(async (command, args, options) => {
        if (command === "firebase" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(Buffer.from("15.12.0", "utf8"));
          return 0;
        }

        if (
          (command === "which" || command === "where") &&
          args?.[0] === "firebase"
        ) {
          return 0;
        }

        if (command === "npm" && args?.[0] === "root" && args?.[1] === "-g") {
          options?.listeners?.stdout?.(Buffer.from(runnerTemp, "utf8"));
          return 0;
        }

        if (command === "npm" && args?.[0] === "view") {
          options?.listeners?.stdout?.(Buffer.from("15.12.0", "utf8"));
          return 0;
        }

        // npm install resolves but lays down nothing the resolver can find.
        if (command === "npm" && args?.[0] === "install") {
          return 0;
        }

        throw new Error(
          `unexpected command: ${command} ${(args || []).join(" ")}`
        );
      });

    await expect(getFirebaseTools("latest")).rejects.toThrow(
      /Could not resolve the installed firebase-tools entrypoint/
    );
  });
});
