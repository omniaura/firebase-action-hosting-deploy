/**
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as os from "os";
import * as path from "path";

// The action runs firebase-tools with this pinned Node rather than whatever
// `firebase` resolves to on the runner. The runner's system Node — and the
// `firebase` binary's shebang that points at it — can be a version carrying the
// `http.Agent` keep-alive "Premature close" regression (nodejs/node#63989,
// shipped in Node >=22.23.0 / >=24.17.0 / >=26.3.1 on 2026-06-18) that breaks
// gaxios/google-auth-library and therefore the Workload Identity Federation
// token exchange firebase-tools uses to authenticate. 24.16.0 is the last
// release before the regression. Bump this once Node ships a fix.
const TOOL_NAME = "firebase-action-node";

/** Maps os.platform() to the Node.js dist platform slug. */
function nodePlatform(): "linux" | "darwin" | "win" {
  switch (os.platform()) {
    case "win32":
      return "win";
    case "darwin":
      return "darwin";
    default:
      return "linux";
  }
}

/** Maps os.arch() to the Node.js dist arch slug. */
function nodeArch(): string {
  return os.arch() === "arm64" ? "arm64" : "x64";
}

/**
 * Downloads (and caches) a pinned Node.js runtime and returns the path to its
 * `node` executable. Falls back to the action's own Node runtime
 * (process.execPath) if the download fails for any reason — the action runtime
 * is Node 20, which predates and is unaffected by the regression.
 */
export async function getPinnedNode(version: string): Promise<string> {
  const arch = nodeArch();

  let installDir = tc.find(TOOL_NAME, version, arch);
  if (installDir) {
    core.info(`Using cached pinned Node.js ${version}`);
  } else {
    try {
      const platform = nodePlatform();
      const folder = `node-v${version}-${platform}-${arch}`;
      const ext = platform === "win" ? "zip" : "tar.gz";
      const url = `https://nodejs.org/dist/v${version}/${folder}.${ext}`;

      core.info(`Downloading pinned Node.js ${version} from ${url}`);
      const downloadPath = await tc.downloadTool(url);
      const extractedPath =
        platform === "win"
          ? await tc.extractZip(downloadPath)
          : await tc.extractTar(downloadPath);

      installDir = await tc.cacheDir(
        path.join(extractedPath, folder),
        TOOL_NAME,
        version,
        arch
      );
      core.info(`Cached pinned Node.js ${version}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      core.warning(
        `Failed to set up pinned Node.js ${version} (${message}); falling back to the action runtime Node at ${process.execPath}`
      );
      return process.execPath;
    }
  }

  const nodeBin =
    nodePlatform() === "win"
      ? path.join(installDir, "node.exe")
      : path.join(installDir, "bin", "node");

  core.info(`Using Node.js interpreter for firebase-tools: ${nodeBin}`);
  return nodeBin;
}
