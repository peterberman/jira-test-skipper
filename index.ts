import { test as base } from "@playwright/test";

// Declare your options to type-check your configuration.
export type JiraTestSkipperOptions = {
  /**
   * Jira test skipper token should be in format
   * @example
   * 'email@example.com:<api_token>'
   */
  jiraTestSkipperToken: string | null;
};

// Specify both option and fixture types.
export const test = base.extend<
  JiraTestSkipperOptions & {
    expectTestToFailIfJiraBugIsOpen: undefined;
  }
>({
  jiraTestSkipperToken: [null, { option: true }],

  expectTestToFailIfJiraBugIsOpen: [
    async ({ jiraTestSkipperToken }, use) => {
      if (jiraTestSkipperToken === null) {
        console.warn(
          "Jira test skipper token is not set. Jira statuses will not be checked."
        );
        use(undefined);
      } else {
        const bugs = (
          test
            .info()
            .annotations.filter(
              (annotation) =>
                annotation.type === "bug" &&
                annotation.description !== undefined
            ) as { type: string; description: string }[]
        ).map(
          (annotation) => annotation.description.split("/").pop() as string
        );
        if (bugs.length === 0) {
          return;
        }
        let jiraBugsStatus: { key: string; status: { name: string } }[] = [];
        try {
          const response = await fetch(
            `https://doxyme.atlassian.net/rest/api/3/issue/bulkfetch`,
            {
              method: "POST",
              headers: {
                Authorization: `Basic ${Buffer.from(
                  jiraTestSkipperToken
                ).toString("base64")}`,
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                fields: ["status"],
                issueIdsOrKeys: bugs,
              }),
            }
          );
          console.log(`Response: ${response.status} ${response.statusText}`);
          const data = await response.json();
          jiraBugsStatus = data.issues.map((issue) => ({
            key: issue.key,
            status: issue.fields.status,
          })) as {
            key: string;
            status: { name: string };
          }[];
        } catch (error) {
          console.error(error);
          throw error;
        }
        // TODO: habdle array of statuses
        if (
          jiraBugsStatus.some(
            (issue) => !issue.status.name.toLowerCase().includes("done")
          )
        ) {
          // TODO: fix error message for array of bugs
          test.fail(true, `Jira bug is open`);
        }
        await use(undefined);
      }
    },
    { auto: true },
  ],
});
