import { test as base } from "@playwright/test";

// Declare your options to type-check your configuration.
export type JiraTestSkipperOptions = {
  /**
   * Jira test skipper token should be in format
   * @example
   * 'email@example.com:<api_token>'
   */
  jiraTestSkipperToken: string | null;

  /**
   * Statuses that are considered as 'ticket closed', so test would not be skipped
   * Put your statuses as array of strings (case insensetive). Default: ['done']
   */
  jiraDoneStatuses: string[];
};

// Specify both option and fixture types.
export const test = base.extend<
  JiraTestSkipperOptions & {
    expectTestToFailIfJiraBugIsOpen: undefined;
  }
>({
  jiraTestSkipperToken: [null, { option: true }],
  jiraDoneStatuses: [["done"], { option: true }],

  expectTestToFailIfJiraBugIsOpen: [
    async (
      { jiraTestSkipperToken, jiraDoneStatuses: jiraDoneStatuses },
      use
    ) => {
      if (jiraTestSkipperToken === null) {
        console.warn(
          "Jira test skipper token is not set. Jira statuses will not be checked."
        );
        await use(undefined);
        return;
      }
      const bugs = (
        test
          .info()
          .annotations.filter(
            (annotation) =>
              annotation.type === "bug" && annotation.description !== undefined
          ) as { type: string; description: string }[]
      ).map((annotation) => {
        const jiraProject = new URL(annotation.description).hostname
          .split(".")
          .shift() as string;
        const a = {
          id: annotation.description.split("/").pop() as string,
          project: jiraProject,
        };
        return a;
      });
      if (bugs.length === 0) {
        // No tickets annotations or descriptions empty, skipping fixture
        await use(undefined);
        return;
      }

      if (!bugs.every((b) => b.project === bugs[0].project)) {
        // TODO: handle multiple projects
        throw new Error("All tickets must be from the same Jira project");
      }

      try {
        const response = await fetch(
          `https://${bugs[0].project}.atlassian.net/rest/api/3/issue/bulkfetch`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(
                jiraTestSkipperToken as string
              ).toString("base64")}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fields: ["status"],
              issueIdsOrKeys: bugs.map((b) => b.id),
            }),
          }
        );
        // console.log(`Response: ${response.status} ${response.statusText}`);
        const data: {
          issues: { key: string; fields: { status: { name: string } } }[];
        } = await response.json();
        // console.log(`Data: ${JSON.stringify(data, null, 2)}`);
        const jiraBugsStatus: { key: string; status: { name: string } }[] =
          data.issues.map((issue) => ({
            key: issue.key,
            status: issue.fields.status,
          }));

        const openIssues = jiraBugsStatus.filter(
          (issue) =>
            !jiraDoneStatuses
              .map((a) => a.toLowerCase())
              .includes(issue.status.name?.toLowerCase())
        );
        if (openIssues.length > 0) {
          test.fail(
            true,
            `Test is expected to fail, because associated jira tickets are in progress: 
          ${JSON.stringify(openIssues, null, 2)}
          `
          );
        }
      } catch (error) {
        console.error(`Error checking Jira tickets: ${error}`);
      }
      await use(undefined);
      return;
    },
    { auto: true },
  ],
});
