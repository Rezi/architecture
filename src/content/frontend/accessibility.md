---
sources:
  - title: ARIA Authoring Practices Guide - Read Me First
    url: https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/
    publisher: W3C WAI
  - title: Developing a Keyboard Interface
    url: https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
    publisher: W3C WAI
  - title: WCAG 2 Quick Reference
    url: https://www.w3.org/WAI/WCAG22/quickref/
    publisher: W3C WAI
  - title: 'HTML: a good basis for accessibility'
    url: https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility/HTML
    publisher: MDN
  - title: dialog element
    url: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
    publisher: MDN
---

## The problem: "we'll add accessibility at the end"

**Accessibility** (often shortened to a11y) means people can use your product regardless of disability or situation: someone using only a keyboard, a screen reader (software that reads the page aloud), a magnifier, or just a phone in bright sun with a broken mouse. This is a large group, and in many places a legal requirement.

It is an architectural topic because the cheap time to get it right is the beginning. Retrofitting means rewriting components, and the main cause of inaccessible UIs is choosing the wrong building block early, as below.

## Rule 1: use the right element

Browsers give native elements keyboard handling, focus, roles and screen reader announcements for free. A `div` gives none.

```svelte bad title="A div pretending to be a button"
<div class="btn" onclick={save}>Save</div>
```

What goes wrong: it cannot be reached with Tab, Enter and Space do nothing, and a screen reader announces plain text, not a button. To repair it you would add `tabindex`, `role`, and key handlers, ending up re-implementing `button` poorly.

```svelte good title="Native button"
<button class="btn" onclick={save}>Save</button>
```

A short mapping to remember: actions use `button`, navigation uses `a href`, text fields use `input` with a `label`, page regions use `header`, `nav`, `main`, and headings use `h1` to `h6` in order. In React and Vue the rule is the same; components should render these elements.

ARIA attributes (`role`, `aria-*`) add meaning _when no native element exists_. The first rule of ARIA is: do not use ARIA if a native element does the job. Wrong ARIA is worse than none.

## Rule 2: everything works with a keyboard

Unplug your mouse and try your app. You should be able to reach and use every control with Tab, Shift+Tab, Enter, Space, Escape and arrow keys, and always see where focus is.

```text bad title="Typical failures"
- outline: none; on buttons, with no replacement style
- hover-only menus that cannot be opened with the keyboard
- custom dropdowns that ignore arrow keys and Escape
```

```text good title="What to do instead"
- keep a visible focus style (use :focus-visible to show it for keyboard users)
- make every hover action available on focus and click
- follow the keyboard pattern in the ARIA Authoring Practices for custom widgets
```

## Rule 3: manage focus when the UI changes

**Focus** is the element currently receiving keyboard input. When your code changes the screen, focus must follow, otherwise keyboard and screen reader users are left on something that vanished.

```ts good title="Return focus when a dialog closes"
export function openDialog(dialog: HTMLDialogElement, trigger: HTMLElement) {
	dialog.showModal(); // native: traps focus, closes on Escape, makes the rest inert
	dialog.addEventListener('close', () => trigger.focus(), { once: true });
}
```

The native `dialog` element does most of this work for you. Custom modals made of divs must implement focus trapping, Escape handling and focus restoration themselves, which is why the native version is the better default.

Single-page apps have a particular problem: navigating to a new route changes the content without a page load, so screen readers hear nothing. After navigation, move focus to the new page heading or announce the change. Frameworks like SvelteKit do part of this automatically.

## Rule 4: tell assistive technology about changes

```ts bad title="Silent update"
statusEl.textContent = 'Saved'; // a screen reader user never hears this
```

```ts good title="A live region announces updates"
// Present in the page from the start: <p id="status" role="status"></p>
export function announce(message: string) {
	const el = document.getElementById('status');
	if (el) el.textContent = message; // polite announcement
}
```

A **live region** is an element whose text changes are read aloud automatically. Use `role="status"` for polite messages (saved, loaded) and `role="alert"` for urgent errors. The region must exist before you change its content.

## Other basics that cost almost nothing

- Every image has `alt` text (empty `alt=""` for decoration).
- Every input has a visible `label`, connected with `for` and `id`.
- Text contrast of at least 4.5:1 against its background (a WCAG requirement).
- Never convey information by colour alone; add text or an icon.
- Respect `prefers-reduced-motion` for animations.

## Make it part of the process

- **Lint**: `eslint-plugin-jsx-a11y` for React, and Svelte's built-in compiler warnings, catch many mistakes as you type.
- **Automated tests**: axe-core finds roughly a third to half of the problems (missing labels, contrast), but cannot judge whether a page makes sense.
- **Manual check**: tab through each new feature; test it once with a screen reader (VoiceOver, NVDA).
- **Design system**: fix it once in your `Button`, `Dialog` and `Input`, and every feature inherits it. See [components](/frontend/components).

## When NOT to reach for ARIA or fancy widgets

Custom comboboxes, tree views and drag and drop are expensive to make accessible. Prefer a native `select`, a list of links, or a well-tested library (Radix, Melt UI, Bits UI, React Aria) over writing your own.

> Key takeaway: use native elements, test with the keyboard, manage focus on every change, and announce updates. Starting is cheap; retrofitting is not.

## Checklist

- Are clickable things `button` or `a`, never a div with a handler?
- Can you complete every task with only the keyboard, with focus always visible?
- Does focus move sensibly after opening and closing dialogs and after navigation?
- Do inputs have labels, images have alt text, and text have enough contrast?
- Does CI run an automated accessibility check, and does someone test manually?
