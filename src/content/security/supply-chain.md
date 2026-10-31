---
sources:
  - title: NPM Security Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/NPM_Security_Cheat_Sheet.html
    publisher: OWASP
  - title: Third Party JavaScript Management Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html
    publisher: OWASP
  - title: Subresource Integrity
    url: https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity
    publisher: MDN
  - title: npm-audit
    url: https://docs.npmjs.com/cli/v10/commands/npm-audit
    publisher: npm docs
  - title: Supply-chain Levels for Software Artifacts (SLSA)
    url: https://slsa.dev/
    publisher: OpenSSF
---

## The problem: you ship other people's code

A typical SvelteKit app has a few dozen direct dependencies and well over a thousand transitive ones (dependencies of dependencies). Each is code that runs on your build machine, your server or your users' browsers, written by someone you have never met. The **software supply chain** is everything between "someone wrote this" and "it runs in production". Attacking it is attractive because one compromise reaches many victims.

Common attack shapes:

- **Compromised maintainer account:** an attacker publishes a malicious new version of a popular package.
- **Malicious install scripts:** npm packages can run code at install time (`postinstall`) on your laptop and CI, where secrets live.
- **Typosquatting:** publishing a package with a name one typo away from a popular one (`reqeusts`), hoping someone installs it by mistake.
- **Dependency confusion:** if your private package name also exists on the public registry, a misconfigured build may fetch the public, attacker-controlled one.
- **Third-party scripts in the page:** a `script` tag pointing at a CDN or analytics vendor runs with full access to your page.

## Pin what you install

```bash bad title="Floating versions, installs that ignore the lockfile"
# package.json has "some-lib": "*" or "latest"
npm install            # may resolve to a brand-new version today
```

If a maintainer account is hijacked and a bad version is published, the next build of the above picks it up automatically.

```bash good title="Commit the lockfile, install exactly what it says"
npm ci                              # fails if lockfile and package.json disagree
npm ci --ignore-scripts             # also skips install scripts (then run needed ones explicitly)
npm audit --omit=dev                # list known vulnerabilities in what you ship
```

Why it works: the **lockfile** (`package-lock.json`) records the exact version and a content hash (integrity checksum) of every package. `npm ci` installs only those, so a new malicious version cannot slip in until a human updates the lockfile and reviews the diff.

Trade-offs:

- `--ignore-scripts` breaks packages that legitimately need a build step (native modules, some tooling). Allow those deliberately.
- Pinning also pins you to known vulnerabilities, so you need a routine to update (Dependabot or Renovate pull requests, reviewed and tested by CI).
- `npm audit` reports known issues, often with noise (a vulnerable function your code never calls). Triage by reachability; do not blindly auto-fix or blindly ignore.

## Reduce what you depend on

Every dependency is attack surface. Before adding one, ask: how big is the trivial alternative, how many maintainers does it have, is it actively maintained? Prefer the platform (`fetch`, `URL`, `structuredClone`, `crypto.randomUUID()`) over a package for something tiny.

```ts bad title="A package for what the platform already does"
import leftPad from 'left-pad-ish'; // plus its own dependency tree
const id = leftPad(String(n), 8, '0');
```

```ts good title="Zero dependencies"
const id = String(n).padStart(8, '0');
```

## Third-party scripts in the browser

A script you include from a vendor runs with your page's privileges: it can read forms, steal tokens held by JavaScript and change the DOM. If the vendor, or their CDN, is compromised, so are you.

```svelte bad title="Remote script, unpinned, loaded on every page"
<script src="https://cdn.example-analytics.com/tracker.js"></script>
```

**Subresource Integrity (SRI)** lets you pin the exact file: you give the browser the file's hash and it refuses to run anything that differs.

```svelte good title="Pinned with SRI; crossorigin is required for the check"
<script
	src="https://cdn.example-analytics.com/tracker-1.4.2.js"
	integrity="sha384-REPLACE_WITH_REAL_BASE64_HASH"
	crossorigin="anonymous"
></script>
```

Limits: SRI only works for files that never change at that URL. A vendor snippet that is updated in place (most analytics) will break with SRI, which is itself the signal to either self-host a reviewed copy or accept the risk knowingly. A CSP (see [transport and headers](/security/transport-and-headers)) further restricts which hosts scripts may come from.

## Build and release integrity

The same logic applies to your own pipeline. **SLSA** (Supply-chain Levels for Software Artifacts) is a framework describing how much you can trust that an artifact was built from the source you think, by a build you control.

```yaml title=".github/workflows/ci.yml (excerpt): least privilege, pinned actions"
permissions:
  contents: read # default token cannot push or publish
jobs:
  build:
    steps:
      - uses: actions/checkout@v4 # better: pin to a full commit SHA
      - run: npm ci --ignore-scripts
      - run: npm test
```

Practical steps that matter most: enable two-factor authentication on registry and Git accounts, give CI tokens minimal permissions, require code review on dependency updates, and publish packages (if you do) with provenance. The OpenSSF Scorecard tool can grade a repository against these habits.

## Be realistic

You cannot audit every line of every dependency. The goal is to make attacks _noisier and slower_: reviewed lockfile diffs, fewer dependencies, no automatic latest versions, and the ability to find out quickly which projects use a compromised package (a lockfile and an inventory make that a search instead of a panic). See also [OWASP Top 10](/security/owasp-top-10) for how vulnerable components rank.

## Checklist

- Lockfile committed; CI uses `npm ci`.
- Dependency updates arrive as reviewed pull requests, not floating ranges.
- `npm audit` runs in CI and someone triages the result.
- Install scripts are disabled or allow-listed.
- Third-party browser scripts are pinned with SRI or self-hosted, and limited by CSP.
- Registry, Git and CI accounts use 2FA and least-privilege tokens.
