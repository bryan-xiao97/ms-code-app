/**
 * Mail helper for the local Mailpit mail catcher (port 54324).
 *
 * NOTE: Supabase local dev ships Mailpit, not Inbucket. The API differs:
 *   - List all messages: GET /api/v1/messages  (no per-mailbox route)
 *   - Fetch one message: GET /api/v1/message/{ID}
 *   - Clear all:         DELETE /api/v1/messages
 *   - Body fields:       message.Text and message.HTML  (capitalized)
 *
 * We filter by recipient address since Mailpit has no per-mailbox route.
 */

const BASE = "http://127.0.0.1:54324";

interface MailpitMessageSummary {
  ID: string;
  To: { Address: string }[];
}

interface MailpitMessageList {
  messages: MailpitMessageSummary[];
}

interface MailpitMessage {
  Text: string;
  HTML: string;
}

export async function getMagicLink(email: string): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    const list: MailpitMessageList = await fetch(`${BASE}/api/v1/messages`)
      .then((r) => (r.ok ? (r.json() as Promise<MailpitMessageList>) : { messages: [] }))
      .catch(() => ({ messages: [] }));

    const match = list.messages.find((m) =>
      m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase())
    );

    if (match) {
      const message: MailpitMessage | null = await fetch(
        `${BASE}/api/v1/message/${match.ID}`
      )
        .then((r) => (r.ok ? (r.json() as Promise<MailpitMessage>) : null))
        .catch(() => null);

      if (!message) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      const body = message.Text ?? message.HTML ?? "";
      const urlMatch = body.match(/https?:\/\/[^\s"<)]+/);
      if (urlMatch) return urlMatch[0];
    }

    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No magic link arrived for ${email} in 10s`);
}

export async function clearInbucket(): Promise<void> {
  await fetch(`${BASE}/api/v1/messages`, { method: "DELETE" }).catch(() => {});
}
