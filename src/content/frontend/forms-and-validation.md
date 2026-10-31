---
sources:
  - title: Client-side form validation
    url: https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Form_validation
    publisher: MDN
  - title: Input Validation Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
    publisher: OWASP
  - title: Form actions
    url: https://svelte.dev/docs/kit/form-actions
    publisher: SvelteKit docs
  - title: Forms tutorial
    url: https://www.w3.org/WAI/tutorials/forms/
    publisher: W3C WAI
  - title: Zod documentation
    url: https://zod.dev/
    publisher: Zod
---

## The problem: two audiences, one rule

Validation answers "is this input acceptable?" It has two completely different jobs:

- **On the client it is user experience.** It tells people early and kindly what to fix. The browser is under the user's control, so anything it does can be skipped.
- **On the server it is security and data integrity.** Anyone can send requests with `curl`, bypassing your form entirely. The server must never trust what arrives.

So you always need both. And since they enforce the _same rules_, you should write the rules once.

> Client validation is for the honest user. Server validation is for everyone else, and for your own bugs.

## One schema, used on both sides

A **schema** is a description of valid data written as code. A library like Zod (or Valibot, or ArkType) turns it into a validator and also derives the TypeScript type, so the type and the runtime check cannot disagree.

```ts good title="shared/schemas/signup.ts"
import { z } from 'zod';

export const signupSchema = z.object({
	email: z.string().email('Enter a valid email address'),
	password: z.string().min(12, 'Use at least 12 characters'),
	age: z.coerce.number().int().min(18, 'You must be 18 or older')
});

export type SignupInput = z.infer<typeof signupSchema>;
```

`z.coerce.number()` is there because form fields arrive as strings; it converts first, then checks. The same file is imported by the browser form and by the server endpoint.

```ts good title="Server: parse, never trust"
export function parseSignup(formData: FormData) {
	const result = signupSchema.safeParse(Object.fromEntries(formData));
	if (!result.success) {
		return { ok: false as const, errors: result.error.flatten().fieldErrors };
	}
	return { ok: true as const, data: result.data }; // typed and checked
}
```

Compare with the two-copies approach.

```ts bad title="Rules written twice, differing silently"
// client: if (!/^\S+@\S+$/.test(email)) ...
// server: if (!email.includes('@')) ...
```

Within months one copy is stricter. Users pass the form and are rejected by the server with an unexplained error, or worse, the server accepts values the form would have blocked. The backend side of this is covered on the [validation and errors](/backend/validation-and-errors) page.

## Use the platform first

HTML already validates: `type="email"`, `required`, `minlength`, `min`, `pattern`. These give free keyboard-accessible messages and work before JavaScript loads.

```svelte good title="Native attributes plus a progressive enhancement"
<form method="POST">
	<label for="email">Email</label>
	<input id="email" name="email" type="email" required autocomplete="email" />
	<button>Sign up</button>
</form>
```

This form works even if JavaScript fails: the browser posts it and the server validates. Frameworks like SvelteKit (form actions) and Remix build on this. Add JavaScript only to improve it, for example inline messages without a page reload. This is called **progressive enhancement**: the basic version works everywhere, the enhanced version is a bonus.

## When to show errors

```svelte bad title="Error shown while the user is still typing"
<input bind:value={email} class:error={!isValid(email)} />
```

Shouting "invalid email" after the first character is hostile. Better timing:

- Validate a field when the user **leaves** it (blur), then re-validate on each keystroke so the error disappears as soon as it is fixed.
- On submit, validate everything and move focus to the first error.
- Show the message next to the field, linked to it so screen readers announce it (see [accessibility](/frontend/accessibility)).

```svelte good title="Message tied to its field"
<input
	id="email"
	name="email"
	type="email"
	aria-invalid={error ? 'true' : undefined}
	aria-describedby={error ? 'email-err' : undefined}
/>
{#if error}<p id="email-err" role="alert">{error}</p>{/if}
```

## Server errors come back in the same shape

The server can find problems the client cannot: "that email is already registered". Return them as field errors, in the same shape the client validator uses, so the form displays them the same way. Keep the user's typed input in the form; never make them retype after an error. Do not send back passwords.

## When NOT to over-engineer

- A one-field search box needs no schema library.
- Do not duplicate every server rule on the client. Rules needing the database (uniqueness) belong on the server alone; the client can ask an endpoint, but the final check stays server-side.
- Do not rely on `maxlength` or hidden fields for security. They are suggestions to a browser.

## Checklist

- Does the server validate everything, regardless of what the form does?
- Do client and server import the same schema?
- Do forms work without JavaScript, then get enhanced?
- Are errors shown at the right time, next to the field, and announced to assistive tech?
- Do server-side errors use the same shape as client ones?
