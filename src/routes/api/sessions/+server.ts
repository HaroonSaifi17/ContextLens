import { json, type RequestHandler } from '@sveltejs/kit';
import { convexClient, convexFunctions } from '$lib/server/convex';

interface SessionRecord {
	_id: string;
	title?: string;
	filename: string;
	previewText: string;
	fullText?: string;
	createdAt: number;
}

export const config = {
	maxDuration: 60
};

export const GET: RequestHandler = async () => {
	try {
		const client = convexClient();
		const sessions = (await client.query(convexFunctions.listSessions, {})) as SessionRecord[];

		return json({
			sessions: sessions.map((session) => ({
				_id: String(session._id),
				title: session.title,
				filename: session.filename,
				previewText: session.previewText,
				createdAt: session.createdAt
			}))
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to load sessions.';
		return json({ error: message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as {
			filename?: string;
			text?: string;
		};

		const filename = body.filename?.trim();
		const text = body.text?.trim();

		if (!filename || !text) {
			return json({ error: 'filename and text are required.' }, { status: 400 });
		}

		const client = convexClient();
		const result = await client.mutation(convexFunctions.createSession, {
			filename,
			text
		});

		return json({
			session: {
				_id: String(result.sessionId),
				title: result.title,
				filename: result.filename,
				previewText: result.previewText,
				createdAt: result.createdAt
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to create session.';
		return json({ error: message }, { status: 500 });
	}
};
