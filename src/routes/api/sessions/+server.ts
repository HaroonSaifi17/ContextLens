import { json, type RequestHandler } from '@sveltejs/kit';
import { convexClient, convexFunctions } from '$lib/server/convex';

interface SessionRecord {
	_id: string;
	filename: string;
	previewText: string;
	fullText?: string;
	createdAt: number;
}

export const GET: RequestHandler = async () => {
	try {
		const client = convexClient();
		const sessions = (await client.query(convexFunctions.listSessions, {})) as SessionRecord[];

		return json({
			sessions: sessions.map((session) => ({
				_id: String(session._id),
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
