import { readFile } from 'fs/promises';

import {
  getInput,
  setFailed,
  setOutput,
} from '@actions/core';
import { Octokit } from 'octokit';
import { WebhookPayload } from '@actions/github/lib/interfaces';

import { NonNullableProperties } from './utils/non-nullable-propeties';

interface GithubEnv {
  readonly token: string | null;
  readonly repositoryPath: string | null;
  readonly eventPath: string | null;
}

enum ReviewState {
  Approved = 'APPROVED',
  ChangesRequested = 'CHANGES_REQUESTED',
  Pending = 'PENDING',
}

enum ActionInput {
  RequiredApprovesAmount = 'requiredApprovesAmount',
}

enum ActionOutput {
  IsApproved = 'isApproved',
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

async function getGithubPayload(path: string): Promise<WebhookPayload> {
  const raw = await readFile(path, { encoding: 'utf-8' });
  const payload = JSON.parse(raw) as WebhookPayload;
  return payload;
}

function getRequiredApprovesAmount(): number {
  const DEFAULT_AMOUNT = 1;
  const approvesAmountFromConfig = getInput(ActionInput.RequiredApprovesAmount);

  if (approvesAmountFromConfig === '') {
    return DEFAULT_AMOUNT;
  }

  const approvesAmount = Number(approvesAmountFromConfig);

  if (Number.isNaN(approvesAmount) || approvesAmount <= 0) {
    setFailed('Incorrect value of the `requiredApprovesAmount` input');
  }

  return approvesAmount;
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

    const octokitClient = new Octokit({ auth: `token ${githubEnv.token}` });
    const payload = await getGithubPayload(githubEnv.eventPath);

    if (payload.pull_request == null) {
      setFailed('This event doesn\'t contain PR');
      return;
    }

    const requiredApprovesAmount = getRequiredApprovesAmount();
    const [owner, repo] = githubEnv.repositoryPath.split('/');
    const pullsRequestConfig = {
      owner,
      repo,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      pull_number: payload.pull_request.number,
    };

    // Contains `reviewer username - review state` pairs.
    const codeReviewProgress = new Map<string, ReviewState>();
    const [postedReviews, requestedReviewers] = await Promise.all([
      octokitClient.rest.pulls.listReviews(pullsRequestConfig),
      octokitClient.rest.pulls.listRequestedReviewers(pullsRequestConfig),
    ]);

    postedReviews.data.forEach(review => {
      if (review.user?.login != null) {
        codeReviewProgress.set(review.user.login, review.state as ReviewState);
      }
    });

    // The `listRequestedReviewers` method returns only reviewers with pending review requests.
    requestedReviewers.data.users.forEach(reviewer => codeReviewProgress.set(reviewer.login, ReviewState.Pending));

    const reviewStates = Array.from(codeReviewProgress.values());
    const approvesAmount = reviewStates.filter(reviewState => reviewState === ReviewState.Approved).length;
    const changesRequestedAmount = reviewStates.filter(reviewState => reviewState === ReviewState.ChangesRequested).length;
    const isApproved = approvesAmount >= requiredApprovesAmount && changesRequestedAmount === 0;

    if (isApproved) {
      setOutput(ActionOutput.IsApproved, 'true');
    } else {
      setOutput(ActionOutput.IsApproved, 'false');
    }

    console.group();
    console.log('Code review summary:');
    console.group();
    console.log(codeReviewProgress);
    console.log('total `Approved` amount:', approvesAmount);
    console.log('total `Change Requested` amount:', changesRequestedAmount);
    console.groupEnd();
    console.log('Is pull requested approved?', isApproved);
    console.groupEnd();
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    }
  }
}

run();
