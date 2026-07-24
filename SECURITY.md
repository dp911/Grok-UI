# Security policy

## Supported versions

Security fixes are applied to the latest release candidate on the default branch.

## Reporting

Do not open a public issue for a suspected vulnerability. Use GitHub’s private vulnerability reporting for this repository, or contact the maintainer privately.

Include the affected version, deployment topology, reproduction steps, and impact. Do not include real Grok credentials, prompts, source code, or session archives.

## Deployment guidance

- Keep the default loopback-only bind whenever possible.
- Use an SSH tunnel or private VPN for access from another device.
- Set a long, random `GROK_UI_TOKEN` before any non-loopback bind.
- Terminate TLS in front of the server on untrusted networks.
- Treat authenticated access as equivalent to local developer access: the UI can display conversations and source diffs and can instruct Grok to use tools.
- Run Grok UI as the same unprivileged user who owns the intended `~/.grok` directory.
- Do not expose port `4310` directly to the public internet.

## Trust boundary

The browser never receives Grok credentials. The server owns the local ACP connection and passes explicit permission decisions back to Grok. A valid Grok UI token grants access to that control surface, so it must be protected like a developer credential.
