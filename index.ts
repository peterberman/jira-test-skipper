import { test as base } from "@playwright/test";
import "dotenv/config";


// Declare your options to type-check your configuration.
export type JiraTestSkipperOptions = {
  /**
   * Jira test skipper token should be in format
   * @example
   * 'email@example.com:<api_token>'
   */
  jiraTestSkipperToken: string | null;
};

// Тут я читаю из env доступные статусы
function getAllowedStatusesFromEnv(): Set<string> {
  const raw = process.env.JIRA_DONE_STATUSES ?? "done";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

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
          //console.log(`Data: ${JSON.stringify(data)}`);
          // console.log(`Data: ${JSON.stringify(data.issues)}`);
          console.log(`Data: ${JSON.stringify(data.issues[0].fields.status.name)}`);
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
        // TODO: handle array of statuses

        const allowedStatuses = getAllowedStatusesFromEnv();

        const openIssues = jiraBugsStatus.filter(
          (issue) => !allowedStatuses.has(issue.status.name?.toLowerCase())
        );

        if (openIssues.length > 0) {
          const list = openIssues
            .map((i) => `${i.key} (${i.status.name})`)
            .join(", ");
          test.fail(
            true,
            `Jira bug(s) not in allowed statuses [${[...allowedStatuses].join(
              ", "
            )}]: ${list}`
          );
        }
        await use(undefined);
      }
    },
    { auto: true },
  ],
});
