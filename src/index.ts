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

import {
  endGroup,
  getInput,
  setFailed,
  setOutput,
  startGroup,
} from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { existsSync } from "fs";
import { createCheck } from "./createCheck";
import { createGacFile } from "./createGACFile";
import {
  deployPreview,
  deployProductionSite,
  ErrorResult,
  interpretChannelDeployResult,
} from "./deploy";
import { getChannelId } from "./getChannelId";
import { getFirebaseTools } from "./installFirebaseTools";
import { getPinnedNode } from "./setupNode";
import {
  getURLsMarkdownFromChannelDeployResult,
  postChannelSuccessComment,
} from "./postOrUpdateComment";

// Inputs defined in action.yml
const expires = getInput("expires");
const projectId = getInput("projectId");
const googleApplicationCredentials = getInput("firebaseServiceAccount", {
  required: true,
});
const configuredChannelId = getInput("channelId");
const isProductionDeploy = configuredChannelId === "live";
const token = process.env.GITHUB_TOKEN || getInput("repoToken");
const octokit = token ? getOctokit(token) : undefined;
const entryPoint = getInput("entryPoint");
const target = getInput("target");
const firebaseToolsVersion = getInput("firebaseToolsVersion");
const disableComment = getInput("disableComment");
const force = getInput("force") === "true";
const nodeVersion = getInput("nodeVersion");

async function run() {
  const isPullRequest = !!context.payload.pull_request;

  let finish = (details: Object) => console.log(details);
  if (token && isPullRequest) {
    finish = await createCheck(octokit, context);
  }

  try {
    startGroup("Verifying firebase.json exists");

    if (entryPoint !== ".") {
      console.log(`Changing to directory: ${entryPoint}`);
      try {
        process.chdir(entryPoint);
      } catch (err) {
        throw Error(`Error changing to directory ${entryPoint}: ${err}`);
      }
    }

    if (existsSync("./firebase.json")) {
      console.log("firebase.json file found. Continuing deploy.");
    } else {
      throw Error(
        "firebase.json file not found. If your firebase.json file is not in the root of your repo, edit the entryPoint option of this GitHub action."
      );
    }
    endGroup();

    startGroup("Installing Firebase CLI");
    const firebaseBin = await getFirebaseTools(firebaseToolsVersion);
    endGroup();

    startGroup("Setting up pinned Node.js runtime");
    const nodeBin = await getPinnedNode(nodeVersion);
    endGroup();

    startGroup("Setting up CLI credentials");
    const gacFilename = await createGacFile(googleApplicationCredentials);
    console.log(
      "Created a temporary file with Application Default Credentials."
    );
    endGroup();

    if (isProductionDeploy) {
      startGroup("Deploying to production site");
      const deployment = await deployProductionSite(gacFilename, {
        projectId,
        target,
        firebaseToolsVersion,
        force,
        firebaseBin,
        nodeBin,
      });
      if (deployment.status === "error") {
        throw Error((deployment as ErrorResult).error);
      }
      endGroup();

      const hostname = target ? `${target}.web.app` : `${projectId}.web.app`;
      const url = `https://${hostname}/`;
      await finish({
        details_url: url,
        conclusion: "success",
        output: {
          title: `Production deploy succeeded`,
          summary: `[${hostname}](${url})`,
        },
      });
      return;
    }

    const channelId = getChannelId(configuredChannelId, context);

    startGroup(`Deploying to Firebase preview channel ${channelId}`);
    const deployment = await deployPreview(gacFilename, {
      projectId,
      expires,
      channelId,
      target,
      firebaseToolsVersion,
      force,
      firebaseBin,
      nodeBin,
    });

    if (deployment.status === "error") {
      throw Error((deployment as ErrorResult).error);
    }
    endGroup();

    const { expireTime, expire_time_formatted, urls } =
      interpretChannelDeployResult(deployment);

    setOutput("urls", urls);
    setOutput("expire_time", expireTime);
    setOutput("expire_time_formatted", expire_time_formatted);
    setOutput("details_url", urls[0]);

    if (disableComment === "true") {
      console.log(
        `Commenting on PR is disabled with "disableComment: ${disableComment}"`
      );
    } else if (token && isPullRequest && !!octokit) {
      const commitId = context.payload.pull_request?.head.sha.substring(0, 7);

      await postChannelSuccessComment(octokit, context, deployment, commitId);
    }

    await finish({
      details_url: urls[0],
      conclusion: "success",
      output: {
        title: `Deploy preview succeeded`,
        summary: getURLsMarkdownFromChannelDeployResult(deployment),
      },
    });
  } catch (e) {
    setFailed(e.message);

    await finish({
      conclusion: "failure",
      output: {
        title: "Deploy preview failed",
        summary: `Error: ${e.message}`,
      },
    });
  }
}

// This action's own process runs on the runner's system Node (via `using:
// node24` in action.yml) — which we can't pin, unlike the Node used to invoke
// firebase-tools. On Node versions carrying the keep-alive regression
// (nodejs/node#63989), an idle keep-alive socket left in octokit's undici
// connection pool throws ERR_STREAM_PREMATURE_CLOSE during process teardown.
// That fires *after* run()'s awaited work has already settled (deploy +
// comment + check update all succeeded), so it bypasses the try/catch above and
// crashes an otherwise-green run with exit code 1 and no captured output.
// Exit explicitly once our work has settled so a deferred socket close can't
// flip the result.
run()
  .catch((error) => {
    setFailed(error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
