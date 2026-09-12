// biome-ignore lint/style/noRestrictedImports: the routing test uses a temporary command definition.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CommandLibrary } from "../commands/library.js";
import type { ChatInput } from "../runtime/inference.js";
import { ArtifactStore } from "../workspace/artifacts.js";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { WorkspaceScope } from "../workspace/scope.js";
import {
  artifactExecution,
  chatResult,
  cleanServiceFixtures,
  fixture,
  terminal,
} from "./service-test-support.js";
import { AgentStore } from "./store.js";

afterEach(cleanServiceFixtures);

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one case checks the shared delegation and command boundary through reopening.
it("shares specialist routing and preserves child identity and findings", async () => {
  const requests: ChatInput[] = [];
  const description = "Inspect source structure".padEnd(1_000, ".");
  const prompt = "Inspect the selected files.".padEnd(128_000, ".");
  const assignment = `${description}\n\n${prompt}`;
  const commandDescription = description.slice(0, 256);
  const commandArguments = prompt.padEnd(256_000 - "/intake ".length, ".");
  const commandTask = `/intake ${commandArguments}`;
  let parentId = "";
  const { catalog, conversations, service } = await fixture(
    {
      async chat(request, _signal, streams) {
        requests.push(request);
        if (requests.length === 1) {
          const task = request.tools.find((tool) => tool.name === "task");
          expect(task?.params.properties).toHaveProperty(
            "subagent_type.enum",
            expect.arrayContaining(["folder-intake"]),
          );
          return chatResult("", [
            {
              id: "intake-call",
              name: "task",
              params: {
                subagent_type: "folder-intake",
                description,
                prompt,
              },
            },
          ]);
        }
        if (requests.length === 3) return chatResult("Parent findings.", []);
        expect(request.tools.some((tool) => tool.name === "task" || tool.name === "question")).toBe(
          false,
        );
        streams?.onResponseDelta?.("Partial findings.");
        const child = service.snapshot(parentId).childRuns[0];
        expect(child).toMatchObject({ agentId: "folder-intake", state: "running" });
        if (child === undefined) throw new Error("Child was not recorded.");
        expect(service.snapshot(child.id).run.response).toBe("Partial findings.");
        return chatResult("Complete findings.", []);
      },
    },
    artifactExecution,
  );
  const row = catalog.database.prepare("PRAGMA database_list").get() as { file: string };
  const root = dirname(dirname(row.file));
  const commandRoot = join(root, "test-commands");
  await mkdir(commandRoot);
  await writeFile(
    join(commandRoot, "intake.md"),
    `---\ndescription: ${commandDescription}\nagent: folder-intake\n---\n`,
  );
  const command = new CommandLibrary(commandRoot).resolve(commandTask);
  const resolveCommand = vi
    .spyOn(CommandLibrary.prototype, "resolve")
    .mockReturnValueOnce(undefined)
    .mockReturnValue(command);
  try {
    const session = conversations.createSession(null);
    parentId = service.start(session.id, "Inspect source structure.").id;
    const delegated = await terminal(service, parentId);
    expect(delegated.run).toMatchObject({ state: "succeeded", error: null });
    expect(delegated.childRuns[0]?.assignment).toHaveLength(assignment.length);
    expect(delegated.childRuns[0]).toMatchObject({
      assignment,
      parentRunId: parentId,
      parentToolCallId: "intake-call",
      response: "Complete findings.",
    });
    parentId = service.start(session.id, commandTask).id;
    const direct = await terminal(service, parentId);
    expect(direct.run).toMatchObject({ state: "succeeded", response: "Complete findings." });
    expect(direct.childRuns[0]).toMatchObject({
      assignment: `${commandDescription}\n\n${commandArguments}`,
      parentRunId: parentId,
      parentToolCallId: `command:${parentId}`,
      agentId: "folder-intake",
    });
    expect(requests).toHaveLength(4);
    expect(requests[1]?.messages.find((message) => message.role === "user")?.text).toBe(assignment);
    expect(requests[3]?.messages.find((message) => message.role === "user")?.text).toBe(
      direct.childRuns[0]?.assignment,
    );
    expect(service.listRuns(session.id).map((run) => run.id)).toEqual(
      expect.arrayContaining([delegated.run.id, direct.run.id]),
    );
    expect(service.listRuns(session.id)).toHaveLength(2);
    await service.close();
    catalog.close();
    const reopened = openWorkspaceCatalog(root);
    try {
      const store = new AgentStore(
        reopened.database,
        await ArtifactStore.create(await WorkspaceScope.create(root)),
      );
      expect(store.snapshot(parentId).childRuns).toEqual(direct.childRuns);
      expect(store.snapshot(delegated.run.id).childRuns).toEqual(delegated.childRuns);
    } finally {
      reopened.close();
    }
  } finally {
    resolveCommand.mockRestore();
    await service.close();
    catalog.close();
  }
});
