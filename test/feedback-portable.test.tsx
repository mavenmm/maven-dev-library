// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import {
  FeedbackProvider, FeedbackLauncher, FeedbackWidget,
  type FeedbackTransport, type TextFeedbackPayload,
} from "../src/ui/index";

// A mock transport proves the widget is fully backend-agnostic: it renders and
// operates outside ANY app, with no S3/Vimeo/Teamwork — just an injected object.
afterEach(cleanup);

// The widget renders its modal into an isolated shadow root (host CSS can't leak in),
// so modal content lives in the shadow tree — query THROUGH it, not via `screen`.
// The launcher button stays in the light DOM.
function panel() {
  const host = document.querySelector("[data-mvui-feedback-root]");
  if (!host || !host.shadowRoot) throw new Error("feedback shadow root not mounted");
  return within(host.shadowRoot as unknown as HTMLElement);
}

function mockTransport(overrides: Partial<FeedbackTransport> = {}): FeedbackTransport {
  return {
    submitText: vi.fn(async (_p: TextFeedbackPayload) => ({ ok: true, taskId: "1", url: "https://tw/app/tasks/1" })),
    uploadImage: vi.fn(async () => ({ url: "https://cdn/x.png" })),
    createVideoTarget: vi.fn(async () => ({ uploadLink: "https://tus/x", videoId: "v", videoUri: "/videos/v" })),
    submitVideo: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

function mount(transport: FeedbackTransport) {
  return render(
    <FeedbackProvider config={{ transport, enableRichText: false, enableVideo: true }}>
      <FeedbackLauncher />
      <FeedbackWidget />
    </FeedbackProvider>,
  );
}

describe("feedback widget portability (mock transport, no backend)", () => {
  it("is closed until the launcher is clicked", () => {
    mount(mockTransport());
    expect(panel().queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Feedback"));
    expect(panel().getByRole("dialog")).toBeTruthy();
  });

  it("disables Send with no subject, enables once typed", () => {
    mount(mockTransport());
    fireEvent.click(screen.getByText("Feedback"));
    const send = panel().getByRole("button", { name: "Send feedback" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(panel().getByPlaceholderText("One-line summary"), { target: { value: "Broken link" } });
    expect(send.disabled).toBe(false);
  });

  it("submits text through the injected transport and shows the task link", async () => {
    const t = mockTransport();
    mount(t);
    fireEvent.click(screen.getByText("Feedback"));
    fireEvent.click(panel().getByText("Feature request"));
    fireEvent.change(panel().getByPlaceholderText("One-line summary"), { target: { value: "Add dark mode" } });
    fireEvent.change(panel().getByPlaceholderText(/What happened/), { target: { value: "please" } });
    fireEvent.click(panel().getByRole("button", { name: "Send feedback" }));

    await waitFor(() => expect(t.submitText).toHaveBeenCalledTimes(1));
    const payload = (t.submitText as any).mock.calls[0][0] as TextFeedbackPayload;
    expect(payload.type).toBe("feature");
    expect(payload.subject).toBe("Add dark mode");
    expect(payload.bodyHtml).toContain("please");
    expect(payload.pageUrl).toBeTruthy();
    await waitFor(() => expect(panel().getByText(/your feedback was filed/i)).toBeTruthy());
    expect((panel().getByText(/View the Teamwork task/i) as HTMLAnchorElement).href).toContain("/app/tasks/1");
  });

  it("surfaces a transport error without crashing", async () => {
    const t = mockTransport({ submitText: vi.fn(async () => ({ ok: false, error: "Teamwork 403" })) });
    mount(t);
    fireEvent.click(screen.getByText("Feedback"));
    fireEvent.change(panel().getByPlaceholderText("One-line summary"), { target: { value: "x" } });
    fireEvent.click(panel().getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(panel().getByText("Teamwork 403")).toBeTruthy());
  });
});
