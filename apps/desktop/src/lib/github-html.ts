import DOMPurify, { type Config } from "dompurify";
import {
  normalizeExternalHttpsUrl,
  normalizeGithubContentImageUrl,
} from "./external-content";

/**
 * Sanitizes GitHub-rendered markdown (`bodyHTML`) before it reaches the DOM.
 *
 * GitHub already sanitizes this HTML, but it is still content written by other
 * people, so the webview treats it as hostile (the CSP blocks scripts as a
 * second layer):
 * - no scripts, styles, forms, frames, SVG/MathML or inline `style`
 * - links must be https (or in-page `#anchors`)
 * - images only from GitHub content hosts (the CSP `img-src` matches)
 * - only GitHub's own markdown classes survive, so content cannot borrow the
 *   app's utility classes (e.g. `fixed inset-0`) to cover the UI
 * - no `id`/`name`, which could clobber DOM globals
 */

const purifier = DOMPurify(window);

const ALLOWED_CLASS =
  /^(?:pl-[a-z0-9]+|markdown-alert(?:-[a-z]+)?|task-list-item(?:-checkbox)?|contains-task-list|highlight(?:-source-[a-z0-9-]+)?|user-mention|issue-link|commit-link|anchor|octicon(?:-[a-z0-9-]+)?|notranslate)$/;

const PURIFY_CONFIG: Config & { RETURN_DOM: true } = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: [
    "style",
    "form",
    "button",
    "textarea",
    "select",
    "option",
    "iframe",
    "object",
    "embed",
    "source",
    "audio",
    "track",
    "link",
    "meta",
    "base",
  ],
  FORBID_ATTR: ["style", "id", "name", "srcset", "sizes", "target", "ping"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: true,
  RETURN_DOM: true,
};

/** Links to `https://github.com/{owner}/{repo}/issues/{number}`. */
export function parseGithubIssueUrl(href: string) {
  const match = href.match(
    /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/,
  );
  if (!match) return undefined;
  return {
    owner: match[1],
    name: match[2],
    number: Number(match[3]),
  };
}

function textLink(document: Document, href: string | null, text: string) {
  const url = href ? normalizeExternalHttpsUrl(href) : null;
  if (!url) return document.createTextNode(text);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.textContent = text;
  return link;
}

function cleanTree(root: Element) {
  const document = root.ownerDocument;

  for (const element of Array.from(root.querySelectorAll("[class]"))) {
    const kept = Array.from(element.classList).filter((name) =>
      ALLOWED_CLASS.test(name),
    );
    if (kept.length > 0) element.setAttribute("class", kept.join(" "));
    else element.removeAttribute("class");
  }

  for (const link of Array.from(root.querySelectorAll("a"))) {
    const href = link.getAttribute("href");
    if (!href) continue;
    if (href.startsWith("#")) continue;
    const url = normalizeExternalHttpsUrl(href);
    if (url) link.setAttribute("href", url);
    else link.removeAttribute("href");
  }

  for (const image of Array.from(root.querySelectorAll("img"))) {
    const src = normalizeGithubContentImageUrl(
      image.getAttribute("src") ?? undefined,
    );
    if (!src) {
      const alt = image.getAttribute("alt")?.trim();
      image.replaceWith(document.createTextNode(alt ? `[${alt}]` : ""));
      continue;
    }
    image.setAttribute("src", src);
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
    image.setAttribute("referrerpolicy", "no-referrer");
  }

  // Videos would need a media-src CSP; link to them instead.
  for (const video of Array.from(root.querySelectorAll("video"))) {
    video.replaceWith(
      textLink(document, video.getAttribute("src"), "▶ Open video on GitHub"),
    );
  }

  // Task list checkboxes are display-only until editing exists.
  for (const input of Array.from(root.querySelectorAll("input"))) {
    if (input.getAttribute("type") !== "checkbox") {
      input.remove();
      continue;
    }
    for (const attribute of Array.from(input.attributes)) {
      if (!["type", "checked", "class"].includes(attribute.name)) {
        input.removeAttribute(attribute.name);
      }
    }
    input.setAttribute("disabled", "");
  }
}

export function sanitizeGithubHtml(html: string): string {
  const body = purifier.sanitize(html, PURIFY_CONFIG);
  if (!(body instanceof Element)) return "";
  cleanTree(body);
  return body.innerHTML;
}
