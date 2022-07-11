# saritasa-pr-approved-action

Github Action that checks whether a PR has required number of unique approves and has not any requests for changes.

## Inputs

### `requiredApprovesAmount`

The minimal required amount of unique approves for a pull request.
**optional**, default value is `1`.

## Outputs

### `isApproved`

Equals to `true` if a PR is approved, otherwise equals to `false`.

## Usage example

Check out this [file](.github/workflows/test.yml).
