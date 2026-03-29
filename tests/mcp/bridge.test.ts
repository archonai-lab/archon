import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock factories are hoisted before imports — use vi.hoisted() to declare
// variables that the factory closures can safely reference.
const mocks = vi.hoisted(() => {
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockListTools = vi.fn().mockResolvedValue({ tools: [] });
  const mockCallTool = vi.fn().mockResolvedValue({ content: [], isError: false });
  const mockClose = vi.fn().mockResolvedValue(undefined);

  const MockClient = vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    callTool: mockCallTool,
    close: mockClose,
  }));

  const MockStdioClientTransport = vi.fn().mockImplementation(() => ({}));

  return { MockClient, MockStdioClientTransport, mockConnect, mockListTools, mockCallTool, mockClose };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: mocks.MockClient,
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: mocks.MockStdioClientTransport,
}));

// Import bridge after mocks are in place
import { connect, callTool, shutdown } from "../../src/mcp/bridge.js";

// Mock McpServer — bridge calls server.tool() for each discovered tool
const mockServerTool = vi.fn();
const mockServer = { tool: mockServerTool } as any;

describe("neural memory bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockListTools.mockResolvedValue({ tools: [] });
    mocks.mockCallTool.mockResolvedValue({ content: [], isError: false });
    mocks.mockConnect.mockResolvedValue(undefined);
    mocks.mockClose.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    // Reset bridge state between tests
    await shutdown().catch(() => {});
  });

  describe("connect()", () => {
    it("spawns nmem-mcp via uvx and completes without error", async () => {
      await expect(connect(mockServer)).resolves.toBeUndefined();

      expect(mocks.MockStdioClientTransport).toHaveBeenCalledWith({
        command: "uvx",
        args: ["--from", "neural-memory", "nmem-mcp"],
        stderr: "inherit",
      });
      expect(mocks.MockClient).toHaveBeenCalledWith(
        { name: "archon-brain", version: "0.1.0" },
        { capabilities: {} },
      );
      expect(mocks.mockConnect).toHaveBeenCalledTimes(1);
      expect(mocks.mockListTools).toHaveBeenCalledTimes(1);
    });

    it("registers each discovered tool on the server", async () => {
      mocks.mockListTools.mockResolvedValue({
        tools: [
          { name: "nmem_remember", description: "Save a memory" },
          { name: "nmem_recall", description: "Retrieve memories" },
        ],
      });

      await connect(mockServer);

      expect(mockServerTool).toHaveBeenCalledTimes(2);
      expect(mockServerTool).toHaveBeenCalledWith(
        "nmem_remember",
        "Save a memory",
        expect.any(Function),
      );
      expect(mockServerTool).toHaveBeenCalledWith(
        "nmem_recall",
        "Retrieve memories",
        expect.any(Function),
      );
    });

    it("throws with 'health check failed' when listTools() rejects", async () => {
      mocks.mockListTools.mockRejectedValue(new Error("process exited"));

      await expect(connect(mockServer)).rejects.toThrow("health check failed");
    });
  });

  describe("callTool()", () => {
    it("forwards tool name and args to the underlying client and returns the result", async () => {
      const expected = {
        content: [{ type: "text", text: "saved" }],
        isError: false,
      };
      mocks.mockCallTool.mockResolvedValue(expected);

      await connect(mockServer);
      const result = await callTool("nmem_remember", { content: "hello" });

      expect(mocks.mockCallTool).toHaveBeenCalledWith({
        name: "nmem_remember",
        arguments: { content: "hello" },
      });
      expect(result).toEqual(expected);
    });
  });

  describe("shutdown()", () => {
    it("calls client.close() and makes subsequent callTool() throw 'not connected'", async () => {
      await connect(mockServer);
      await shutdown();

      expect(mocks.mockClose).toHaveBeenCalledTimes(1);
      await expect(callTool("any_tool", {})).rejects.toThrow("not connected");
    });
  });
});
