# Slack channel setup

Zora joins Slack over **Socket Mode** (outbound WebSocket: no public URL, no webhook route).
Messages go through the same ChannelManager pipeline as Signal/Telegram: identity → policy gate → CaMeL quarantine.

## Slack app (Richard / workspace admin)

1. Create an app, enable **Socket Mode**, create an app-level token with `connections:write` (`xapp-…`).
2. Bot scopes: `app_mentions:read`, `chat:write`, `im:history`, `im:read`, `im:write`.
3. Subscribe to bot events: `app_mention`, `message.im`.
4. Install to the workspace (`xoxb-…`) and invite the bot to `#zora-agents`.

Tokens are credentials: provision them through OneCLI as `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`. Never commit them.
The adapter starts only when both are set and `channel-policy.toml` exists.

## Who may talk to Zora

Unknown senders get no reply (INVARIANT-3). Add each Slack **user ID** (`U…`, from the profile's "Copy member ID") to `channel-policy.toml`, using the ID as `phone`:

```toml
[[channel_policy.users]]
phone = "U0123ABCD"
name = "Richard"
channels = ["all"]
role = "trusted_user"
```

## Behaviour

- DMs are answered; channel messages are answered only when Zora is @mentioned (reply goes in the thread).
- Bots, edits and Slack redeliveries are ignored.

## Live smoke test

`SLACK_LIVE=1 SLACK_BOT_TOKEN=… SLACK_APP_TOKEN=… SLACK_TEST_CHANNEL=C… npx vitest run tests/integration/slack-live.test.ts`
posts a message as the bot and verifies the Socket Mode connection. Skipped by default.

## Running behind OneCLI (placeholder tokens)

Zora does not need the real Slack tokens in its environment. Create a OneCLI
agent for Zora, assign it the Slack bot and app secrets (host `slack.com`,
header `Authorization`, with the Bearer prefix option on), then start the daemon
with placeholders and the proxy settings OneCLI gives that agent:

```bash
export SLACK_BOT_TOKEN=xoxb-onecli-managed
export SLACK_APP_TOKEN=xapp-onecli-managed
export HTTPS_PROXY=http://x:<agent-token>@<gateway-host>:10255
export NODE_EXTRA_CA_CERTS=<path to the OneCLI gateway CA>
zora-agent start
```

When `HTTPS_PROXY` is set the adapter routes both the Web API and the Socket
Mode WebSocket through it (`slackProxyAgent`). Verified against a real
workspace: `auth.test` and a Socket Mode connection succeed with placeholder
tokens through the gateway.
