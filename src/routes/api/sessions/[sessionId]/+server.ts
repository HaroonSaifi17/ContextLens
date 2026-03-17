import { json, type RequestHandler } from '@sveltejs/kit';
import { convexClient, convexFunctions } from '$lib/server/convex';

interface SessionRecord {
	_id: string;
	filename: string;
	previewText: string;
	createdAt: number;
}

export const GET: RequestHandler = async ({ params }) => {
	try {
		const sessionId = params.sessionId;
		if (!sessionId) {
			return json({ error: 'sessionId is required.' }, { status: 400 });
		}

		const client = convexClient();
		const session = (await client.query(convexFunctions.getSession, {
			sessionId: sessionId as never
		})) as SessionRecord | null;

		if (!session) {
			return json({ error: 'Session not found.' }, { status: 404 });
		}

		return json({
			session: {
				_id: String(session._id),
				filename: session.filename,
				previewText: session.previewText,
				createdAt: session.createdAt
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to load session.';
		return json({ error: message }, { status: 500 });
	}
};
