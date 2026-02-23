import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadAndMergeConfig } from "../src/config/loader.js";

const tmpDir = path.join(os.tmpdir(), "agent-hooks-test-" + process.pid);
let globalPath: string;
let projectPath: string;

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  globalPath = path.join(tmpDir, "global.yml");
  projectPath = path.join(tmpDir, "project.yml");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeYaml(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content.trim() + "\n");
}

describe("Config merge", () => {
  it("1. loads global-only config", () => {
    writeYaml(globalPath, `
events:
  test.event:
    - name: global-listener
      type: shell
      command: /usr/bin/echo
      priority: 10
    `);
    const config = loadAndMergeConfig(globalPath, projectPath);
    expect(config.events["test.event"]).toHaveLength(1);
    expect(config.events["test.event"][0].name).toBe("global-listener");
  });

  it("2. loads project-only config", () => {
    writeYaml(projectPath, `
events:
  test.event:
    - name: project-listener
      type: shell
      command: ./run.sh
      priority: 5
    `);
    const config = loadAndMergeConfig(globalPath, projectPath);
    expect(config.events["test.event"]).toHaveLength(1);
    expect(config.events["test.event"][0].name).toBe("project-listener");
  });

  it("3. merges with no overlap — both fire", () => {
    writeYaml(globalPath, `
events:
  test.event:
    - name: global-a
      type: shell
      command: /usr/bin/echo
      priority: 10
    `);
    writeYaml(projectPath, `
events:
  test.event:
    - name: project-b
      type: shell
      command: ./run.sh
      priority: 20
    `);
    const config = loadAndMergeConfig(globalPath, projectPath);
    expect(config.events["test.event"]).toHaveLength(2);
    expect(config.events["test.event"].map((l) => l.name)).toEqual([
      "global-a",
      "project-b",
    ]);
  });

  it("4. same-name override — project wins", () => {
    writeYaml(globalPath, `
events:
  test.event:
    - name: shared-listener
      type: shell
      command: /global/cmd
      priority: 10
    `);
    writeYaml(projectPath, `
events:
  test.event:
    - name: shared-listener
      type: shell
      command: ./project/cmd
      priority: 15
    `);
    const config = loadAndMergeConfig(globalPath, projectPath);
    expect(config.events["test.event"]).toHaveLength(1);
    expect(config.events["test.event"][0].command).toBe("./project/cmd");
    expect(config.events["test.event"][0].priority).toBe(15);
  });

  it("5. auto-generates name from shell command basename", () => {
    writeYaml(globalPath, `
events:
  test.event:
    - type: shell
      command: /usr/local/bin/notify.sh
      priority: 10
    `);
    const config = loadAndMergeConfig(globalPath, projectPath);
    expect(config.events["test.event"][0].name).toBe("shell-notify.sh");
  });

  it("6. priority ordering after merge", () => {
    writeYaml(globalPath, `
events:
  test.event:
    - name: high-pri
      type: shell
      command: /usr/bin/echo
      priority: 50
    `);
    writeYaml(projectPath, `
events:
  test.event:
    - name: low-pri
      type: shell
      command: ./run.sh
      priority: 5
    `);
    const config = loadAndMergeConfig(globalPath, projectPath);
    expect(config.events["test.event"][0].name).toBe("low-pri");
    expect(config.events["test.event"][1].name).toBe("high-pri");
  });

  it("7. empty project config — global used", () => {
    writeYaml(globalPath, `
events:
  test.event:
    - name: global-only
      type: shell
      command: /usr/bin/echo
      priority: 10
    `);
    writeYaml(projectPath, "");
    const config = loadAndMergeConfig(globalPath, projectPath);
    expect(config.events["test.event"]).toHaveLength(1);
  });

  it("8. missing global config — project-only works", () => {
    // Don't create global file at all
    writeYaml(projectPath, `
events:
  test.event:
    - name: project-only
      type: shell
      command: ./run.sh
      priority: 10
    `);
    const config = loadAndMergeConfig(
      path.join(tmpDir, "nonexistent.yml"),
      projectPath
    );
    expect(config.events["test.event"]).toHaveLength(1);
    expect(config.events["test.event"][0].name).toBe("project-only");
  });

  it("9. merges events across different event names", () => {
    writeYaml(globalPath, `
events:
  event.a:
    - name: listener-a
      type: shell
      command: /usr/bin/echo
      priority: 10
    `);
    writeYaml(projectPath, `
events:
  event.b:
    - name: listener-b
      type: shell
      command: ./run.sh
      priority: 10
    `);
    const config = loadAndMergeConfig(globalPath, projectPath);
    expect(Object.keys(config.events)).toContain("event.a");
    expect(Object.keys(config.events)).toContain("event.b");
  });

  it("10. scalar settings — project overrides global", () => {
    writeYaml(globalPath, `
version: "1.0"
default_timeout: 3000
events: {}
    `);
    writeYaml(projectPath, `
default_timeout: 8000
events: {}
    `);
    const config = loadAndMergeConfig(globalPath, projectPath);
    expect(config.default_timeout).toBe(8000);
    expect(config.version).toBe("1.0");
  });

  it("11. global_env merges with project precedence", () => {
    writeYaml(globalPath, `
global_env:
  KEY_A: global_value
  KEY_B: global_b
events: {}
    `);
    writeYaml(projectPath, `
global_env:
  KEY_A: project_value
  KEY_C: project_c
events: {}
    `);
    const config = loadAndMergeConfig(globalPath, projectPath);
    expect(config.global_env?.KEY_A).toBe("project_value");
    expect(config.global_env?.KEY_B).toBe("global_b");
    expect(config.global_env?.KEY_C).toBe("project_c");
  });

  it("12. no config at all — returns empty events", () => {
    const config = loadAndMergeConfig(
      path.join(tmpDir, "none1.yml"),
      path.join(tmpDir, "none2.yml")
    );
    expect(config.events).toEqual({});
  });
});
