# Frequently Asked Questions

## Getting Started

### Do I need to be technical to use Zora?

Not really. If you can open the Terminal app and paste a few commands, you can install and run Zora. The setup wizard handles all the configuration. You never need to write code, edit config files, or understand how AI models work.

That said, Zora is a command-line tool today. You type commands in a terminal window. If you've never opened Terminal before, our [Setup Guide](SETUP_GUIDE.md) walks you through it step by step.

### What computers does Zora work on?

Zora works on Mac and Linux today. Windows support is in progress. You need Node.js version 20 or higher, which is free and takes a couple of minutes to install.

### How long does setup take?

About 5 minutes. Install Node.js (if you don't have it), install Zora, run the setup wizard. You'll be giving Zora tasks within minutes.

---

## Cost & Billing

### Does Zora cost money?

Zora itself is completely free and open source. You can download it, modify it, and use it however you want.

However, Zora uses AI services (Claude or Gemini) to understand your requests and do the thinking. Those services require a subscription.

### Will I get a surprise bill?

**No.** This is a deliberate design decision. Zora authenticates through your existing Claude Code or Gemini subscription — the one you already pay a flat monthly fee for. There are no API keys, no per-token charges, and no credit card attached separately.

Some AI tools charge per-token through API keys, which can lead to unexpected bills if an automation loop runs away. Zora avoids this entirely by using your subscription-based account.

### What if I don't have a Claude or Gemini subscription?

You have a few options:

- **Get Claude Code** — Install [Claude Code](https://claude.ai/claude-code) and sign in. This is what most Zora users use.
- **Get the Gemini CLI** — Install the [Gemini CLI](https://ai.google.dev/gemini-api/docs/cli) and sign in with your Google account.
- **Use Ollama** — A free, local AI that runs entirely on your computer. It's slower and less capable, but it costs nothing and keeps all your data completely private.

### Can I use Zora completely offline?

Yes, with Ollama. Install Ollama and a local model, and Zora can run entirely on your machine with zero internet connection. It won't be as smart as Claude, but it works for simpler tasks.

---

## Safety & Privacy

### Can Zora delete my files?

Not by default. During setup, you choose a safety level. The recommended "Balanced" setting blocks destructive commands like `rm` (delete) and `sudo` (admin access). Zora can only read and write in folders you explicitly allow.

Even on the most permissive setting ("Power"), Zora still blocks `sudo` and logs every action it takes.

### Does Zora send my data to the cloud?

Zora sends task-related content to your AI provider (Claude or Gemini) for processing — the same as if you pasted text into a chat window. Your files themselves stay on your computer.

Zora doesn't have its own servers or cloud services. It doesn't collect analytics, telemetry, or usage data. It's a local program that talks to AI providers on your behalf.

### What data does Zora store on my computer?

Everything Zora stores lives in `~/.zora/` on your computer:

- **config.toml** — Your settings (which AI to use, how much autonomy Zora gets)
- **policy.toml** — Safety rules (which folders and commands are allowed)
- **memory/** — Things Zora remembers about you and your work
- **audit/** — A log of every action Zora has taken
- **workspace/** — Temporary files Zora creates while working

All of this is plain text. You can read, edit, or delete any of it at any time.

### Can I see everything Zora has done?

Yes. Run `zora-agent audit` to see the complete history of every action. Each entry includes a timestamp, what was done, and the result. The log uses cryptographic hashing so it can't be tampered with.

### What about my SSH keys, passwords, and credentials?

They're automatically blocked. The default setup marks `~/.ssh`, `~/.gnupg`, and `~/.aws` as off-limits. Zora physically cannot access these directories regardless of what task you give it.

---

## Using Zora Day-to-Day

### How do I give Zora a task?

Type a command in your terminal:

```bash
zora-agent ask "your request in plain English"
```

For example:

```bash
zora-agent ask "Find all files larger than 100MB in my home directory"
```

### Can Zora handle multi-step tasks?

Yes, this is one of its strengths. You can say something like "Find all TODO comments in my project, group them by priority, and create a summary markdown file" — and Zora will figure out the steps, execute them in order, and give you the result.

### What if Zora is doing something wrong mid-task?

You can send it a course-correction. Start the dashboard (`zora-agent start`) and type a message in the steering input — something like "Actually, skip the test files" or "Focus on the src/ directory only." Zora will adjust.

### Does Zora remember things between sessions?

Yes. Zora has a hierarchical memory system. It remembers your preferences, facts about your projects, and context from previous tasks. You can also explicitly tell it to remember something:

```bash
zora-agent ask "Remember that I prefer dark mode in all my projects"
```

### Can I set up tasks that run automatically?

Yes. Zora supports scheduled routines — recurring tasks that run on a schedule you define. "Every morning at 8am, check my email and summarize anything urgent." See the [Routines Cookbook](ROUTINES_COOKBOOK.md) for examples.

### How do I know which AI provider Zora is using?

Start the dashboard (`zora-agent start`) and look at the right panel. It shows which providers are connected, their health status, and usage stats. Zora picks the best available provider automatically, but you can override this per-task.

---

## Troubleshooting

### Zora says "No providers detected"

This means Zora can't find Claude or Gemini. Run:

```bash
zora-agent doctor
```

This checks your environment and tells you exactly what's missing. Usually it means you need to install and sign into Claude Code or the Gemini CLI first.

### Zora says "Permission denied"

The safety system blocked an action because it falls outside your allowed folders or commands. Check your policy:

```bash
zora-agent ask "show me my current security policy"
```

If you need to expand access, re-run setup with a broader preset:

```bash
zora-agent init --preset balanced --force
```

### Zora seems slow

A few things to check:

- **Network:** Zora needs internet to reach Claude or Gemini. Check your connection.
- **Provider health:** Start the dashboard and check if your provider shows healthy.
- **Task complexity:** Some tasks genuinely take time. Organizing hundreds of files or analyzing large codebases can take a minute or two.

### How do I reset everything and start fresh?

Delete the config folder and re-run setup:

```bash
rm -rf ~/.zora
zora-agent init
```

This removes all configuration, memory, and logs. Use this as a last resort.

---

*Still stuck? Open an issue on [GitHub](https://github.com/ryaker/zora/issues) — include what you were trying to do, what happened instead, and the output of `zora-agent doctor`.*
