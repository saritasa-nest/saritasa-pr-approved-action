# saritasa-pr-approved-action

Github Action that checks whether lead reviewers are invited to the PR or not.

## Inputs

### `config`

File in `yml` format that contains a list of lead reviewers. Should have the same structure as [there](.github/test-config.yml).

## Outputs

### `areLeadReviewersInvited`

Equals to `true` if a PR are invited to PR, otherwise equals to `false`.

## Usage example

Check out this [file](.github/workflows/test.yml).
