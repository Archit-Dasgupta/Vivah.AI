import { createSession, getSession } from "../../../lib/session";


export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionKey = body.sessionKey || `test-${Date.now()}`;
    const initialState = body.state ?? { stage: "ask_category", slots: {} };

    const created = await createSession(sessionKey, initialState);
    return new Response(JSON.stringify({ created }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), { status: 500 });
  }
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const sessionKey = url.searchParams.get("sessionKey");
    const s = await getSession(sessionKey);
    return new Response(JSON.stringify({ session: s }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
