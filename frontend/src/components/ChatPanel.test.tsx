import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/types";
import { mockFetch } from "@/test/mocks";
import { ChatPanel } from "./ChatPanel";

const restored: ChatMessage[] = [
  { id: "1", role: "user", message: "buy 1 AAPL", actions: null, created_at: "2026-09-30T10:00:00Z" },
  {
    id: "2",
    role: "assistant",
    message: "Buying 1 AAPL.",
    actions: [{ type: "trade", ticker: "AAPL", side: "buy", quantity: 1, status: "ok", price: 190.5, error: null }],
    created_at: "2026-09-30T10:00:01Z",
  },
];

const reply: ChatMessage = {
  id: "3",
  role: "assistant",
  message: "Done.",
  actions: [
    { type: "trade", ticker: "TSLA", side: "sell", quantity: 5, status: "error", price: null, error: "Insufficient shares" },
    { type: "watchlist", ticker: "PYPL", action: "add", status: "ok", error: null },
  ],
  created_at: "2026-09-30T10:01:00Z",
};

describe("ChatPanel", () => {
  it("restores history on mount through the shared message component", async () => {
    mockFetch([{ path: "/api/chat/history?limit=50", body: { messages: restored } }]);
    render(<ChatPanel onActions={vi.fn()} />);
    const messages = await screen.findAllByTestId("chat-message");
    expect(messages).toHaveLength(2);
    expect(messages[1]).toHaveTextContent("Buying 1 AAPL.");
    const action = within(messages[1]).getByTestId("chat-action");
    expect(action).toHaveAttribute("data-status", "ok");
    expect(action).toHaveTextContent("✓");
    expect(action).toHaveTextContent("Bought 1 AAPL at $190.50");
  });

  it("shows a loading indicator, then renders ✓/✗ actions and triggers a refetch", async () => {
    let resolveChat!: (r: Response) => void;
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/chat/history")) {
        return Promise.resolve(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
      }
      return new Promise<Response>((r) => (resolveChat = r));
    });
    vi.stubGlobal("fetch", fetchSpy);
    const onActions = vi.fn();
    render(<ChatPanel onActions={onActions} />);

    await userEvent.type(screen.getByTestId("chat-input"), "sell 5 TSLA and watch PYPL");
    await userEvent.click(screen.getByTestId("chat-send"));

    expect(screen.getByTestId("chat-loading")).toBeInTheDocument();
    expect(screen.getByTestId("chat-send")).toBeDisabled();
    expect(screen.getAllByTestId("chat-message")[0]).toHaveTextContent("sell 5 TSLA and watch PYPL");
    const [, init] = fetchSpy.mock.calls.find(([u]) => String(u) === "/api/chat") as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ message: "sell 5 TSLA and watch PYPL" });

    resolveChat(new Response(JSON.stringify(reply), { status: 200 }));
    await waitFor(() => expect(screen.queryByTestId("chat-loading")).not.toBeInTheDocument());

    const actions = screen.getAllByTestId("chat-action");
    expect(actions[0]).toHaveAttribute("data-status", "error");
    expect(actions[0]).toHaveTextContent("✗");
    expect(actions[0]).toHaveTextContent("Sell 5 TSLA: Insufficient shares");
    expect(actions[1]).toHaveAttribute("data-status", "ok");
    expect(actions[1]).toHaveTextContent("Added PYPL to watchlist");
    expect(onActions).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when the reply has no actions", async () => {
    mockFetch([
      { path: "/api/chat/history?limit=50", body: { messages: [] } },
      { method: "POST", path: "/api/chat", body: { ...reply, actions: [] } },
    ]);
    const onActions = vi.fn();
    render(<ChatPanel onActions={onActions} />);
    await userEvent.type(screen.getByTestId("chat-input"), "hello{Enter}");
    await screen.findByText("Done.");
    expect(onActions).not.toHaveBeenCalled();
  });

  it("reports a failed request inline", async () => {
    mockFetch([
      { path: "/api/chat/history?limit=50", body: { messages: [] } },
      { method: "POST", path: "/api/chat", status: 500, body: { detail: "Internal Server Error" } },
    ]);
    render(<ChatPanel onActions={vi.fn()} />);
    await userEvent.type(screen.getByTestId("chat-input"), "hello{Enter}");
    expect(await screen.findByText(/Message not delivered: Internal Server Error/)).toBeInTheDocument();
  });
});
