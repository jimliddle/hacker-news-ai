# Undercurrent

A Hacker News reader that tells you how a thread feels before you start reading it. It's a single HTML file that runs in your browser, and the AI part works with your own API key from Anthropic, OpenAI or Google.

<p>
  <img src="docs/feed.png" width="32%" alt="The front page, with a mood score next to each story and filters for positive, mixed, negative and neutral threads">
  <img src="docs/thread.png" width="32%" alt="A thread opening with its mood summary: verdict, score, positive and negative split, main themes and comments to read first">
  <img src="docs/ask.png" width="32%" alt="Asking the thread a question, with the answer linking to the comments it came from">
</p>

<sub>Screenshots use sample stories and comments.</sub>

## What it does

When you open a discussion, the first thing you see is a read of the comments as a whole. It tells you whether people are broadly positive, negative or split, gives a score from -100 to +100, says whether the thread is calm or heated, and lists the points people keep coming back to. It also picks out two or three comments worth reading first, and tapping one jumps straight to it.

Under that summary you can ask the thread questions, such as "what are the main objections?" or "did anyone who has used this in production comment?". Answers only draw on the comments in that thread and link to the ones they're based on.

Stories you've already analysed show their mood on the front page, so you can filter the list down to positive threads or hide the heated ones. If you switch on pre-reading, a cheaper model reads the top 5 to 30 stories in the background whenever a feed loads. You can also analyse any single story from its menu without opening it.

The rest is what you'd want from an HN reader. There are Top, New, Best, Ask, Show and Jobs feeds and search. Comment threads collapse, and you can save stories and individual comments. Stories you've read are greyed out, with a count of new comments since your last visit. You can choose between four themes, adjust the text size and install it as an app on your phone or desktop.

## Getting started

1. Put `index.html` on any host that serves over HTTPS. The quickest option is GitHub Pages: in this repo's settings, open Pages and deploy from the `main` branch.
2. Open the page and go to Settings.
3. Paste in an API key for Claude, OpenAI or Gemini. If you add more than one, choose which one to use.

To try it locally, run `python3 -m http.server` in this folder and open `http://localhost:8000`. Opening the file straight from disk is unreliable, because some browsers restrict storage and encryption on local files and none of them will install it as an app.

## Your keys and data

The app has no server and no analytics. The only requests it makes go to Hacker News (the official API plus Algolia's search) and to the AI provider you've chosen.

API keys are encrypted with AES-GCM using a key the browser generates and can't export, then stored in IndexedDB. Each key has its own Clear button in Settings. There are separate buttons for saved items, reading history and cached analyses, and one that wipes everything.

The page sets a strict Content Security Policy. The only script allowed to run is the one inside the file, pinned by its hash, and the page can only connect to the HN APIs and the three AI providers. Comment HTML goes through an allowlist before it's displayed.

Anyone who can use your browser profile can also run analyses with your saved key. On a shared machine, clear your keys when you've finished, and set a spending limit with your provider in any case.

## What it costs

Each analysis is one API call. Long threads are trimmed to about 90,000 characters of comments, which is roughly 25,000 tokens, so with the default models one analysis usually costs a few US cents. Larger models such as Opus cost more. Results are kept per thread, so opening a thread again costs nothing. Questions are cheaper still, and with Claude, follow-up questions reuse a cached copy of the thread.

The app adds up what you've spent from the token counts each provider sends back, and shows the cost of every analysis and answer. In Settings you can set a monthly limit. Once you reach it, threads stop analysing automatically and wait for you to tap Analyze. Pre-reading has its own daily budget.

Prices for each model can be edited in Settings. The built-in ones may be out of date by the time you read this, and your provider's billing page will always have the exact figure.

## Models

| Provider | Analysis and questions | Pre-reading |
| --- | --- | --- |
| Claude | `claude-sonnet-5-5` | `claude-haiku-5-5` |
| OpenAI | `gpt-5.6-luna` | `gpt-5.4-nano` |
| Gemini | `gemini-3.6-flash` | `gemini-3.6-flash` |

You can type any other model name into Settings. Claude is called straight from the browser using Anthropic's `anthropic-dangerous-direct-browser-access` header, which is what lets the app work without a server in the middle.

## Sharing links

A thread link looks like `https://your-host/#/item/45123456`. A link to a single comment adds the comment's ID: `#/item/45123456/45123999`. Opening a comment link loads the thread, expands anything collapsed above that comment and highlights it. Links to news.ycombinator.com inside comments also open in the app.

## Working on it

There's no build step and no runtime dependencies. Edit `index.html` and reload the page.

The one thing to remember is that the Content Security Policy only lets the inline script run if its SHA-256 hash matches the one in the `<meta>` tag. If you change the script, update the hash before you test, or the page will load without running anything:

```
npm run pin
```

The tests load the app in jsdom with mocked responses from Hacker News and each AI provider, then click through the main features:

```
npm install
npm test
```

`npm test` also runs the pin step first.

## Limitations

- It needs a connection. Offline reading would need a service worker, which has to be a separate file.
- It's read-only. You can't log in, vote or comment.
- It summarises the comments but not the linked article. Browsers block pages from fetching other websites, and getting round that would mean sending your reading through a proxy server.

## License

MIT
