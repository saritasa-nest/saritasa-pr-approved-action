import { readFile } from 'fs/promises';

import {
  getInput,
  info,
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

function isExistGithubEnvironmentVariables(
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

function isAcceptableAction(action: string | undefined): boolean {
  return action === 'submitted' || action === 'review_requested';
}

function getRequiredApprovesAmount(): number {
  const DEFAULT_AMOUNT = 1;
  const approvesAmountFromConfig = getInput(ActionInput.RequiredApprovesAmount);

  if (/\d{1,2}/.test(approvesAmountFromConfig)) {
    const approvesAmount = Number.parseInt(approvesAmountFromConfig, 10);
    if (approvesAmount > 0) {
      return approvesAmount;
    }
  }
  return DEFAULT_AMOUNT;
}

async function run(): Promise<void> {
  try {
    const token = process.env.GITHUB_TOKEN ?? null;
    const repositoryPath = process.env.GITHUB_REPOSITORY ?? null;
    const eventPath = process.env.GITHUB_EVENT_PATH ?? null;
    const githubEnv: GithubEnv = { token, repositoryPath, eventPath };

    if (!isExistGithubEnvironmentVariables(githubEnv)) {
      setFailed('GITHUB_TOKEN, GITHUB_REPOSITORY or GITHUB_EVENT doesn\'t set');
      return;
    }

    const octokitClient = new Octokit({ auth: `token ${githubEnv.token}` });
    const payload = await getGithubPayload(githubEnv.eventPath);
    const { action } = payload;

    if (payload.pull_request == null) {
      setFailed('This event doesn\'t contain PR');
      return;
    }

    if (isAcceptableAction(action)) {
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
      const postedReviews = await octokitClient.rest.pulls.listReviews(
        pullsRequestConfig,
      );
      const requestedReviewers =
        await octokitClient.rest.pulls.listRequestedReviewers(
          pullsRequestConfig,
        );

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
    } else {
      info(`${process.env.GITHUB_EVENT_NAME}/${action}/ isn't supported.`);
    }
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    }
  }
}

run();
