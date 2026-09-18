# Documentation for Voice Chat Service UI

This documentation provides an overview of the project, its scripts, and configuration options for the front-end interface of the voice chat service.

![image](https://github.com/user-attachments/assets/123e7ac1-e35f-4fc0-a670-9e577831ee44)


## Project Overview

This project is the front-end interface for a voice chat service. It provides an intuitive and responsive user interface to interact with the voice chat system, manage users, and participate in real-time communications. The application is built with modern front-end technologies, ensuring a smooth and interactive user experience.

## Available Scripts

The project includes several NPM scripts to simplify development, build, and management tasks. Below is a description of each script:

- `dev`:  
  Launches the development server using Vite, enabling hot-reload and fast feedback during development.  
  Command: `bun run dev`

- `build`:  
  Compiles and bundles the application for production, followed by publishing the compiled files using the `hive publish` command.  
  Command: `bun run build`

- `preview`:  
  Serves the production build locally for testing purposes.  
  Command: `bun run preview`

- `glue-proto:windows`:  
  Generates TypeScript definitions from the `transport.proto` file for a Windows environment.  
  Command: `bun run glue-proto:windows`

- `glue-proto:linux`:  
  Generates TypeScript definitions from the `transport.proto` file for a Linux environment.  
  Command: `bun run glue-proto:linux`

## Host Repository

The repository of the host application is private and not open to public access. For local development or modifications, it is recommended to use a standard host with path overrides for distribution.

## Host Arguments

The application supports the following host arguments for runtime configuration:

- `--console`¹: Allocates a console window. 
- `--no-priority-class`¹: Disables setting the process priority class to `RealTime`.
- `--no-priority-boost`¹: Enables process priority boosting.
- `--gpu-debug`: Opens the Chrome GPU debugging page.
- `--devtools`: Enables developer tools.
- `--host-use-localhost`²: Uses `https://localhost` with port 5005 for development.
- `--bypass-security`²: Allows the use of unsigned fragments.


*1 - console, and process priority with boost only for windows          
*2 - usable for development (used only for developing and/or fixing something.)    



# Deploying the browser build

Cloudflare Pages, connected to this repository by Git. `wrangler.jsonc` carries what belongs in the
repository — the project name, the output directory, and the build variables. The build command is
the one piece Pages reads only from the project's own settings.

**The build command has to be set in Settings → Build — there is nowhere else for it:**

```
bun install --frozen-lockfile && bun run build
```

The output directory and the two build variables are in `wrangler.jsonc`. The variables are there on
the strength of one line in the build log — it reports "Build environment variables: (none found)"
right after reading the file, so it looks for them there — which Cloudflare's documentation does not
confirm. **If a build still prints "(none found)", they belong in Settings → Build instead:**

| | |
|---|---|
| `BUN_VERSION` | `1.4.1` — or whatever wrote the lockfile |
| `SKIP_DEPENDENCY_INSTALL` | `1` |

**Why the install is in the build command.** Pages picks a package manager by lockfile, and it does
not recognise `bun.lock` — the text format bun 1.2 replaced `bun.lockb` with. It falls back to npm
silently, and npm then fails on the nineteen `workspace:*` dependencies it cannot resolve:

```
Detected the following tools from environment: npm@10.9.2, nodejs@22.16.0
Installing project dependencies: npm install --progress=false
npm error Cannot read properties of null (reading 'explain')
```

`SKIP_DEPENDENCY_INSTALL` turns that step off and the build command does it properly. `BUN_VERSION`
is what puts bun in the image in the first place — without it there is no `bun` on the PATH to run.

**If bun is still missing**, the image can be told to fetch it, at the cost of a download per build:

```
curl -fsSL https://bun.sh/install | bash && export PATH="$HOME/.bun/bin:$PATH"   && bun install --frozen-lockfile && bun run build
```

**About the version.** `scripts/buildInfo.ts` derives `CommitsSinceVersionSource` from the depth of
history, the way GitVersion does with no version source — and a shallow clone counts only what it
was given. Pages clones at depth 1 and offers no setting to clone deeper, so that count would be
exactly 1 on every deploy, and the app would report `2.255.0.1` for ever.

The build handles it: on CI, a shallow clone is deepened before the count is taken.

```
[build-info] shallow CI clone; fetching the history the commit count needs
```

It fetches with `--filter=blob:none` — commits and trees, no file contents — which is under two
seconds here against nearly a minute for a plain `--unshallow`. Nothing is fetched when the clone
is already complete, and **never off CI**: a shallow clone on a developer's machine is left alone
and only warned about.

If the fetch cannot run at all — no remote, no network — the version comes out too low rather than
failing the deploy, and the log says so. `ARGON_BUILD_VERSION` overrides the whole calculation if
it ever needs pinning by hand.


# License    
    
GNU General Public License v2.0
