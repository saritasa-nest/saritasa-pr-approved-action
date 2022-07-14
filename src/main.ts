import {
  getInput,
  setFailed,
  setOutput,
} from '@actions/core';
import { parse } from 'yaml';
import { context } from '@actions/github';
import { Octokit } from 'octokit';
import { OctokitResponse } from '@octokit/types';

import { NonNullableProperties } from './utils/non-nullable-propeties';

type OctokitResponseData<T> = T extends Promise<infer K> ? K extends OctokitResponse<infer P> ? P : never : never;
type BufferFromParameters = Parameters<BufferConstructor['from']>;
type RepoContentFile = OctokitResponseData<ReturnType<Octokit['rest']['repos']['getContent']>> & {
  readonly content: BufferFromParameters[0];
  readonly encoding: BufferFromParameters[1];
};

interface GithubEnv {
  readonly token: string | null;
  readonly repositoryPath: string | null;
  readonly eventPath: string | null;
}

function doesGithubEnvExist(
  githubEnv: GithubEnv,
): githubEnv is NonNullableProperties<
  GithubEnv,
  'token' | 'eventPath' | 'repositoryPath'
> {
  const { token, repositoryPath, eventPath } = githubEnv;
  return token !== null && repositoryPath !== null && eventPath !== null;
}

enum ActionInput {
  Config = 'config',
}

enum ActionOutput {
  AreLeadsInvited = 'areLeadReviewersInvited',
}

async function run(): Promise<void> {
  try {
    const githubEnv: GithubEnv = {
      token: process.env.GITHUB_TOKEN ?? null,
      repositoryPath: process.env.GITHUB_REPOSITORY ?? null,
      eventPath: process.env.GITHUB_EVENT_PATH ?? null,
    };

    if (!doesGithubEnvExist(githubEnv)) {
      setFailed('GITHUB_TOKEN, GITHUB_REPOSITORY or GITHUB_EVENT doesn\'t set');
      return;
    }

    const pullRequest = context.payload.pull_request ?? null;

    if (pullRequest == null) {
      setFailed('This event doesn\'t contain PR');
      return;
    }

    const octokitClient = new Octokit({ auth: `token ${githubEnv.token}` });
    const configPath = getInput(ActionInput.Config);
    const defaultRequestConfig = {
      owner: context.repo.owner,
      repo: context.repo.repo,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      pull_number: pullRequest.number,
    };

    const { data: getContentResponse } = await octokitClient.rest.repos.getContent({
      ...defaultRequestConfig,
      path: configPath,
      ref: context.ref,
    });

    if ('content' in getContentResponse === false || 'encoding' in getContentResponse === false) {
      setFailed('Can\'t process the config file');
    }

    const leadReviewersConfig = getContentResponse as RepoContentFile;
    const decodedLeadReviewersConfig = Buffer.from(leadReviewersConfig.content, leadReviewersConfig.encoding).toString();
    const leadReviewers = parse(decodedLeadReviewersConfig).reviewers.defaults as string[];

    if (leadReviewers instanceof Array === false) {
      setFailed('Could not read lead reviewers from the config');
    }

    const requestedReviewers = new Set<string>();
    const [pendingReviewers, postedReviews] = await Promise.all([
      octokitClient.rest.pulls.listRequestedReviewers(defaultRequestConfig),
      octokitClient.rest.pulls.listReviews(defaultRequestConfig),
    ]);

    postedReviews.data.forEach(review => {
      if (review.user?.login != null) {
        requestedReviewers.add(review.user.login);
      }
    });

    pendingReviewers.data.users.forEach(reviewer => requestedReviewers.add(reviewer.login));

    let areLeadReviewersInvited = true;
    for (const reviewer of leadReviewers) {
      if (Array.from(requestedReviewers).find(requestedReviewer => requestedReviewer === reviewer) == null) {
        areLeadReviewersInvited = false;
        break;
      }
    }

    if (areLeadReviewersInvited) {
      setOutput(ActionOutput.AreLeadsInvited, 'true');
    } else {
      setOutput(ActionOutput.AreLeadsInvited, 'false');
    }

    console.group('Results:');
    console.group('Lead reviewers:');
    leadReviewers.forEach(reviewer => console.log(reviewer));
    console.groupEnd();
    console.group('All requested reviewers:');
    requestedReviewers.forEach(reviewer => console.log(reviewer));
    console.groupEnd();
    console.log('Are the lead reviewers invited?', areLeadReviewersInvited);
    console.groupEnd();
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    }
  }
}

run();
