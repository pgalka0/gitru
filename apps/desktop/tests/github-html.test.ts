import { describe, expect, it } from "vitest";
import { parseGithubIssueUrl, sanitizeGithubHtml } from "@/lib/github-html";

const render = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = sanitizeGithubHtml(html);
  return container;
};

describe("sanitizeGithubHtml", () => {
  it("keeps ordinary GitHub markdown", () => {
    const html =
      '<h3 dir="auto">Steps</h3><p>Run <code class="notranslate">gh</code> and see <a class="issue-link js-issue-link" data-id="1" href="https://github.com/cli/cli/issues/6174">#6174</a></p><pre><span class="pl-k">echo</span></pre>';
    const out = render(html);

    expect(out.querySelector("h3")?.textContent).toBe("Steps");
    const link = out.querySelector("a");
    expect(link?.getAttribute("href")).toBe(
      "https://github.com/cli/cli/issues/6174",
    );
    expect(link?.className).toBe("issue-link");
    expect(link?.hasAttribute("data-id")).toBe(false);
    expect(out.querySelector("span")?.className).toBe("pl-k");
  });

  it("removes scripts, handlers, styles and dangerous URLs", () => {
    const out = render(
      '<p onclick="alert(1)" style="position:fixed">x</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="http://example.com">plain http</a><iframe src="https://evil.example"></iframe><form><input type="text"></form>',
    );

    expect(out.innerHTML).not.toMatch(/script|onclick|style=|iframe|form/i);
    for (const link of Array.from(out.querySelectorAll("a"))) {
      expect(link.hasAttribute("href")).toBe(false);
    }
    expect(out.querySelector("input")).toBeNull();
  });

  it("drops app utility classes and DOM-clobbering ids", () => {
    const out = render(
      '<div class="fixed inset-0 z-50 markdown-alert markdown-alert-note" id="location"><p name="body">note</p></div>',
    );
    const div = out.querySelector("div");

    expect(div?.className).toBe("markdown-alert markdown-alert-note");
    expect(div?.hasAttribute("id")).toBe(false);
    expect(out.querySelector("p")?.hasAttribute("name")).toBe(false);
  });

  it("allows images only from GitHub content hosts", () => {
    const out = render(
      '<img src="https://user-images.githubusercontent.com/1/a.png" alt="shot" style="max-width: 100%;"><img src="https://evil.example/track.png" alt="tracker"><img src="https://evil.example/x.png">',
    );
    const images = out.querySelectorAll("img");

    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe(
      "https://user-images.githubusercontent.com/1/a.png",
    );
    expect(images[0].getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(images[0].hasAttribute("style")).toBe(false);
    expect(out.textContent).toContain("[tracker]");
  });

  it("keeps task list checkboxes read-only and turns videos into links", () => {
    const out = render(
      '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked data-x="1"> done</li></ul><video src="https://github.com/user-attachments/assets/abc"></video>',
    );
    const checkbox = out.querySelector("input");

    expect(checkbox?.hasAttribute("disabled")).toBe(true);
    expect(checkbox?.hasAttribute("checked")).toBe(true);
    expect(checkbox?.hasAttribute("data-x")).toBe(false);
    expect(out.querySelector("video")).toBeNull();
    expect(out.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/user-attachments/assets/abc",
    );
  });
});

describe("parseGithubIssueUrl", () => {
  it("recognises issue links and nothing else", () => {
    expect(
      parseGithubIssueUrl(
        "https://github.com/cli/cli/issues/6174#issuecomment-1",
      ),
    ).toEqual({ owner: "cli", name: "cli", number: 6174 });
    expect(
      parseGithubIssueUrl("https://github.com/cli/cli/pull/6180"),
    ).toBeUndefined();
    expect(
      parseGithubIssueUrl("https://github.com.evil.com/cli/cli/issues/1"),
    ).toBeUndefined();
  });
});
