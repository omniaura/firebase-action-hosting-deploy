import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as execModule from "@actions/exec";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getFirebaseTools } from "../src/installFirebaseTools";

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

  it("uses preinstalled firebase on self-hosted runners without cache or install", async () => {
    process.env.RUNNER_ENVIRONMENT = "self-hosted";

    const execSpy = jest
      .spyOn(execModule, "exec")
      .mockImplementation(async (command, args, options) => {
        if (command === "firebase" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(Buffer.from("15.12.0", "utf8"));
          return 0;
        }

        throw new Error(`unexpected command: ${command} ${(args || []).join(" ")}`);
      });

    await expect(getFirebaseTools("latest")).resolves.toBe("");

    expect(execSpy).toHaveBeenCalledTimes(1);
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

  it("falls back to managed install when a pinned version differs", async () => {
    process.env.RUNNER_ENVIRONMENT = "self-hosted";

    const execSpy = jest
      .spyOn(execModule, "exec")
      .mockImplementation(async (command, args, options) => {
        if (command === "firebase" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(Buffer.from("15.12.0", "utf8"));
          return 0;
        }

        if (command === "npm" && args?.[0] === "install") {
          return 0;
        }

        throw new Error(`unexpected command: ${command} ${(args || []).join(" ")}`);
      });

    await expect(getFirebaseTools("15.13.0")).resolves.toMatch(
      /firebase-tools-15\.13\.0\/node_modules\/\.bin$/
    );

    expect(execSpy).toHaveBeenCalledTimes(2);
    expect(cache.restoreCache).toHaveBeenCalledTimes(1);
    expect(cache.saveCache).toHaveBeenCalledTimes(1);
    expect(core.addPath).toHaveBeenCalledTimes(1);
  });
});
