# Jira Test Skipper

Automated end‑to‑end (E2E) tests are essential for shipping software with confidence, but they can quickly become a source of noise when they fail for known issues that are still being worked on.  Instead of turning a blind eye to these failures or ignoring the tests altogether, you can use jira‑test‑skipper to keep your continuous integration pipeline green while still tracking unresolved bugs.

jira‑test‑skipper is a lightweight Playwright extension that integrates with your Jira instance.  By tagging tests with Jira bug references, the extension automatically checks the status of those issues before the test runs.  If the associated ticket is not yet in a “done” state, the test is marked as an expected failure rather than causing your suite to fail.  Once the ticket is resolved in Jira, the test will run normally again, giving you a clean signal when fixes land.

## Why use it?

- ✅ **No more noisy CI**: E2E failures caused by already‑reported issues can mask real regressions. This library makes them visible but non‑blocking by marking them as expected failures.
- 🔁 **Automatic status checks**: You don't need to manually keep track of ticket state. The extension calls Jira's REST API to determine whether linked issues are open or done.
- 🎯 **Encourage test coverage**: You don't need to remove or skip tests for known bugs. Write the test once, link it to your Jira ticket, and let the skip logic handle it until the issue is fixed.

## How it works

This library extends Playwright's test fixture and looks for any test annotations of type bug containing a Jira ticket URL. When a test starts, the extension fetches the status of the linked issues from Jira's bulk API (one request per test with annotation) and compares it to a configurable list of "done" statuses (default: `['done']`). If any issue is still open/in progress/etc - any form of not ready for testing (you select statuses), the test is marked as expected to fail using Playwright's `test.fail` (https://playwright.dev/docs/api/class-test#test-fail). The test will still execute, but its failure won't break your build. 

In case the test unexpectedly succeeds while the Jira ticket is open, Playwright reports it as an "unexpected success," prompting you to remove the annotation and update your Jira ticket.

Under the hood the extension uses basic authentication to call Jira's bulk fetch endpoint. You provide a token in the format `email@example.com:<api_token>`, and the library takes care of encoding it and making the request. 

## Installation

Install jira‑test‑skipper as a development dependency alongside Playwright:

```bash
npm install -D jira-test-skipper
```

This package declares a peer dependency on `@playwright/test` version 1.55.0 or newer.

## Configuration

In your `playwright.config.ts`, import the extended test fixture from this package and expose your Jira token and done statuses via the options. A common pattern is to read the token from an environment variable so you don't commit secrets to source control.

```typescript
// playwright.config.ts
import 'dotenv/config';
import { defineConfig } from '@playwright/test';
import { JiraTestSkipperOptions } from 'jira-test-skipper';

// Pass additional types for your config:
export default defineConfig<JiraTestSkipperOptions>({
  // ...other Playwright options...
  use: {
    jiraTestSkipperToken: process.env.JIRA_TEST_SKIPPER_TOKEN,
    jiraDoneStatuses: ['done', 'resolved', 'closed', 'ownStatus'],
  }
});
```

### Providing the Jira token

Create an API token in Jira:
The token needs `/rest/api/3/issue/bulkfetch` endpoint read permissions

Then combine it with your email in the format `email@example.com:<api_token>`.

You can set this string in an environment variable (preferable, for security), for example in a `.env` file:

```bash
# .env
JIRA_TEST_SKIPPER_TOKEN=you@example.com:your_jira_api_token
```

Without a token, the extension logs a warning and skips the status check. This can be useful for local development if you don't want to call Jira on every run.

### Customizing "done" statuses

Every team has their own definitions for when a bug is considered closed. Use the `jiraDoneStatuses` option to list all statuses that should not cause a test to be marked as failing. The comparison is case‑insensitive. For example:

| Situation | jiraDoneStatuses value |
|-----------|------------------------|
| Only mark as done when the ticket state is exactly "Done" | `['done']` (default) |
| Accept "Resolved", "Closed" and "Done" as final | `['resolved', 'closed', 'done']` |
| Use a custom workflow | `['verified', 'Deployed to QA env', 'I am teapot']` |

## Annotating your tests

Specify an annotation object when defining the test:

```typescript
import { test, expect } from 'jira-test-skipper';

test(
  'should render login page',
  {
    // Attach a bug annotation with the Jira ticket URL
    annotations: [
      { type: 'bug', description: 'https://yourcompany.atlassian.net/browse/PROJ-123' },
      { type: 'bug', description: 'https://yourcompany.atlassian.net/browse/PROJ-456' },
      // Multiple tickets status checks are supported!
    ],
  },
  async ({ page }) => {
    await page.goto('/login');
    // …assertions…
  },
);
```

Annotation description must contain a full Jira ticket URL. The extension extracts the project key and issue ID from this URL and uses Jira's bulk fetch API to look up the status. All linked issues must belong to the same project (need multiple projects? Let us know with github issue or PR!).

Ticket type can be any - bug, story, epic, etc. The extension works with any Jira issue type.

**Dynamic annotations are not supported!** – and will be ignored by this extension, because Jira ticket status check is performed before test start (in fixture):

```typescript
import { test, expect } from 'jira-test-skipper';

test('should update profile', async ({ page }) => {
  // NOT SUPPORTED! Annotation created after jira-test-skipper extension completed work
  test.info().annotations.push({
    type: 'bug',
    description: 'https://yourcompany.atlassian.net/browse/PROJ-456',
  });

  await page.goto('/profile');
  // …assertions…
});
```

Overriding `jiraTestSkipperToken` and `jiraDoneStatuses` for specific tests is supported with `test.use`:

```typescript
import { test, expect } from 'jira-test-skipper';

test.use({
    // overrides statuses specified in playwright.config.ts
    jiraDoneStatuses: ['Deployed to production']
});

test(
  'should render login page',
  {
    annotations: [
      { type: 'bug', description: 'https://yourcompany.atlassian.net/browse/PROJ-123' },
    ],
  },
  async ({ page }) => {
    await page.goto('/login');
    // …assertions…
  },
);
```

## How failures are reported

When an open issue is detected, the extension calls `test.fail`. This tells Playwright that the test is expected to fail and provides a message listing the open issues. When the test actually fails, it is reported as an expected failure and does not cause the build to fail (test will be marked as "Success" in report, and when you will open it - you will see received expected error details). 

If the test unexpectedly passes while the bug is still open (self-fix? redeploy helped? magic?), Playwright considers it as an unexpected success – a signal that you should re-test the Jira issue and close the ticket.

This approach is preferable to simply skipping tests because it preserves coverage and ensures that your test will still break if a different regression occurs.

## Example workflow

1. QA engineer notices that an E2E test is failing
2. QA engineer creates a Jira issue (bug, story, tech-debt, etc.)
3. QA engineer adds annotation to the failing test, like this:
```
{ type: 'bug', description: 'https://yourproject.atlassian.net/browse/BUG-123' }
```
4. Each time the test runs, jira‑test‑skipper fetches the status of BUG-123 and marks the test as expected to fail.
5. The ticket is fixed and moved to a "done" state in Jira. The next time the test runs, the annotation no longer causes an expected failure, so the test runs normally.
6. If the test still fails, you know there is a regression. If it passes, you can remove the annotation and close the ticket, or keep the annotation for the fixed bug in order to track the history of bugs for this test.

## Known limitations

- **Single Jira account**: All linked bug annotations in a single test must come from the same Jira project. If you annotate a test with tickets from different accounts, the extension throws an error:

```typescript
import { test, expect } from 'jira-test-skipper';

test(
  'should render login page',
  {
    annotations: [
      { type: 'bug', description: 'https://microsoft.atlassian.net/browse/PROJ-123' },
      { type: 'bug', description: 'https://google.atlassian.net/browse/PROJ-456' },
      // Multiple accounts not yet supported
    ],
  },
  async ({ page }) => {
    await page.goto('/login');
    // …assertions…
  },
);
```

- **Requires Jira Cloud**: The extension uses Atlassian's REST API. It may not work with self‑hosted Jira versions that don't support the `/rest/api/3/issue/bulkfetch` endpoint.
